// Regression tests for PR #10 review round 1 (each reproduced a defect first).
import { describe, expect, it } from "vitest";
import type { EvidenceKind, FeatureGate, ItemTicket } from "../adapters/contracts";
import {
  ALLOWED_GATE,
  anomaly,
  DELETE_DESCRIPTOR,
  fakeId,
  fakeRecord,
  ok,
  READ_DESCRIPTOR,
  SUBJECT_B,
  SyntheticService,
  syntheticDelete,
  syntheticRead,
} from "../adapters/testing/synthetic";
import { fingerprintOf, type PlanTarget } from "./plan";
import { flush } from "./testing/fakes";
import { approved, controllerFor, outcomes, rig, subtle } from "./testing/harness";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe("review 1 #1: ledger decrements are bound to their epoch and barrier", () => {
  it("an old reconciliation cannot clear a newer controller's barrier", async () => {
    const r = await rig();
    const idA = await approved(r, [fakeId(1)]);
    let first = true;
    r.service.override = (op, t) => {
      if (op === "reconcileOne" && first) {
        first = false;
        return anomaly((t as ItemTicket).execId, { code: "network" });
      }
      return undefined;
    };
    await r.controller.start(idA);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:network");
    await flush();

    const b = controllerFor(r.profile, r.service, r.keep);
    await b.collect();
    const seen = await b.recoveryStatus();
    expect((await b.acknowledgeRecovery(seen.kind === "pending" ? seen.token : "")).ok).toBe(true);
    await approved({ ...r, controller: b }, [fakeId(2)]).then(async (idB) => {
      r.service.commitResponse = (t) => Promise.resolve(anomaly(t.execId, { code: "timeout" }));
      await b.start(idB);
      r.service.commitResponse = null;
    });
    expect((await b.recoveryStatus()).kind).toBe("pending");
    await flush();

    await r.controller.reconcileUncertain();
    expect((await b.recoveryStatus()).kind).toBe("pending");
  });
});

describe("review 1 #2: plans, approvals and tickets cannot be mutated from outside", () => {
  it("appending a target to the exposed plan does not widen the approved run", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    const fp = await fingerprintOf(subtle, fakeRecord(2), DELETE_DESCRIPTOR.fingerprintFields);
    try {
      (r.controller.plan as unknown as { targets: PlanTarget[] }).targets.push({
        conversationId: fakeId(2),
        fingerprint: fp as string,
      });
    } catch {
      // A frozen plan refuses the push; either way the run must not widen.
    }
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([fakeId(1)]);
  });

  it("an adapter that rewrites its ticket's subject cannot move the plan's subject", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op, t) => {
      if (op === "preflight") {
        const subject = (t as ItemTicket).subject as Mutable<ItemTicket["subject"]>;
        try {
          subject.accountKey = SUBJECT_B.accountKey;
          subject.workspaceKey = SUBJECT_B.workspaceKey;
        } catch {
          // frozen
        }
        r.service.subject = { status: "verified", ...SUBJECT_B, workspaceKind: "personal" };
      }
      return undefined;
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
  });
});

describe("review 1 #3: a stop before or during start is not lost", () => {
  it("stop() after approval refuses start with the same approval", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.controller.stop();
    expect((await r.controller.start(id)).ok).toBe(false);
    expect(r.service.commits()).toEqual([]);
  });

  it("stop() while start awaits the lock and the ledger sends nothing", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    const run = r.controller.start(id);
    r.controller.stop();
    await run;
    expect(r.service.commits()).toEqual([]);
  });
});

describe("review 1 #4: a disposed controller sends nothing after a wait", () => {
  it("no preflight after the pacing wait once disposed, while another controller holds the lock", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    const release = r.profile.clock.holdNextSleep();
    void r.controller.start(id);
    await flush();
    r.controller.dispose();
    await flush();
    const other = new SyntheticService(() => r.profile.clock.now());
    const b = controllerFor(r.profile, other, r.keep);
    other.onPage = () => {
      release();
    };
    await b.collect();
    await flush();
    expect(r.service.log.filter((c) => c.op === "preflight")).toEqual([]);
  });
});

describe("review 1 #5: an adapter identity change invalidates the approval", () => {
  it("a version change after approval refuses start", async () => {
    const r = await rig();
    const read = syntheticRead(r.service, { ...READ_DESCRIPTOR });
    const del = syntheticDelete(r.service, { ...DELETE_DESCRIPTOR });
    const c = controllerFor(r.profile, r.service, r.keep, { read, del });
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    (read.descriptor as Mutable<typeof read.descriptor>).version = "2";
    (del.descriptor as Mutable<typeof del.descriptor>).version = "2";
    expect((await c.start(id)).ok).toBe(false);
    expect(r.service.commits()).toEqual([]);
  });
});

describe("review 1 #6: the verification rule is the validated copy", () => {
  it("emptying the rule during dispatch cannot produce verified without probes", async () => {
    const r = await rig();
    const descriptor = {
      ...DELETE_DESCRIPTOR,
      verificationRule: [...DELETE_DESCRIPTOR.verificationRule],
    };
    const del = syntheticDelete(r.service, descriptor);
    const c = controllerFor(r.profile, r.service, r.keep, { del });
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    r.service.onDispatch = () => {
      (descriptor.verificationRule as EvidenceKind[]).length = 0;
    };
    await c.start(id);
    const reconciles = r.service.log.filter((l) => l.op === "reconcileOne");
    expect(outcomes(c)[fakeId(1)] === "verified:" && reconciles.length === 0).toBe(false);
    expect(outcomes(c)[fakeId(1)]).not.toBe("verified:");
  });
});

describe("review 1 #7: manual reconciliation honours the Delete gate", () => {
  it("reconcileUncertain is refused once the gate is no longer allowed", async () => {
    const r = await rig();
    const gate: FeatureGate = { ...ALLOWED_GATE };
    const del = syntheticDelete(r.service, DELETE_DESCRIPTOR, gate);
    const c = controllerFor(r.profile, r.service, r.keep, { del });
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    let first = true;
    r.service.override = (op, t) => {
      if (op === "reconcileOne" && first) {
        first = false;
        return anomaly((t as ItemTicket).execId, { code: "network" });
      }
      return undefined;
    };
    await c.start(id);
    (gate as Mutable<FeatureGate>).safety = "unreviewed";
    expect(c.deleteEnabled()).toBe(false);
    const before = r.service.log.length;
    expect((await c.reconcileUncertain()).ok).toBe(false);
    expect(r.service.log.length).toBe(before);
    expect(outcomes(c)[fakeId(1)]).toBe("uncertain:network");
  });
});

describe("review 1 #8: an invalid record with a valid id still counts as a duplicate", () => {
  it("excludes both occurrences", async () => {
    const r = await rig();
    r.service.override = (op, t) =>
      op === "listPage"
        ? ok((t as { execId: string }).execId, {
            subject: r.service.subject,
            documentKey: "doc-1",
            records: [fakeRecord(1), { ...fakeRecord(1), activity: "busy" }, fakeRecord(2)],
            next: { kind: "end" },
            reportedTotal: null,
          })
        : undefined;
    await r.controller.collect();
    expect(r.controller.snapshot?.duplicateIds.has(fakeId(1))).toBe(true);
    await r.controller.makePlan([fakeId(1), fakeId(2)]);
    expect(r.controller.plan?.targets.map((x) => x.conversationId)).toEqual([fakeId(2)]);
  });

  it("detects the duplicate across pages", async () => {
    const r = await rig();
    let page = 0;
    r.service.override = (op, t) => {
      if (op !== "listPage") {
        return undefined;
      }
      const records = page === 0 ? [{ ...fakeRecord(1), activity: "busy" }] : [fakeRecord(1)];
      const next = page === 0 ? { kind: "cursor", cursor: "p1" } : { kind: "end" };
      page++;
      return ok((t as { execId: string }).execId, {
        subject: r.service.subject,
        documentKey: "doc-1",
        records,
        next,
        reportedTotal: null,
      });
    };
    await r.controller.collect();
    expect(r.controller.snapshot?.duplicateIds.has(fakeId(1))).toBe(true);
  });
});

describe("review 1 #9: request spacing across a lock handover", () => {
  it("an idle second controller waits a full interval after the first releases the lock", async () => {
    const r = await rig();
    const b = controllerFor(r.profile, r.service, r.keep);
    await r.controller.collect();
    const lastA = Math.max(...r.service.log.map((l) => l.at));
    await flush();
    const from = r.service.log.length;
    await b.collect();
    const firstB = r.service.log[from]?.at ?? 0;
    expect(firstB - lastA).toBeGreaterThanOrEqual(READ_DESCRIPTOR.minIntervalMs);
  });
});
