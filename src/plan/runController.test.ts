import { describe, expect, it } from "vitest";
import type { ItemTicket } from "../adapters/contracts";
import {
  anomaly,
  DELETE_DESCRIPTOR,
  fakeId,
  fakeRecord,
  ok,
  SUBJECT_B,
  SyntheticService,
  syntheticDelete,
  syntheticRead,
} from "../adapters/testing/synthetic";
import type { KeepEntry } from "../keep/keepRules";
import { ledgerKey } from "./ledger";
import { flush } from "./testing/fakes";
import { approved, controllerFor, newProfile, openKeep, outcomes, rig } from "./testing/harness";

const keepOf = (n: number): KeepEntry => ({
  provider: "chatgpt",
  conversationId: fakeId(n),
  scope: null,
});

describe("PINV-1 targets are a frozen subset of the snapshot and the selection", () => {
  it("never dispatches a conversation that appeared after the snapshot (AT15)", async () => {
    const r = await rig();
    const id = await approved(r);
    r.service.add(fakeRecord(9));
    expect((await r.controller.start(id)).ok).toBe(true);
    expect(r.service.commits()).not.toContain(fakeId(9));
    expect(r.controller.phase).toBe("completed");
  });

  it("never dispatches an id outside the selection", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1), fakeId(2)]);
    await r.controller.start(id);
    expect(r.service.commits().sort()).toEqual([fakeId(1), fakeId(2)]);
  });

  it("a continuation plan never adds ids the parent plan did not have", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1), fakeId(2), fakeId(3)]);
    r.service.onDispatch = () => r.controller.stop();
    await r.controller.start(id);
    expect(r.controller.phase).toBe("paused");
    expect((await r.controller.continuation()).ok).toBe(true);
    const targets = r.controller.plan?.targets.map((t) => t.conversationId) ?? [];
    expect(targets.sort()).toEqual([fakeId(2), fakeId(3)]);
    expect(targets).not.toContain(fakeId(4));
  });
});

describe("PINV-2 plan-time exclusions", () => {
  it("an export snapshot (unverified subject) yields no plan", async () => {
    const r = await rig();
    const result = {
      status: "complete" as const,
      records: [],
      coverage: {
        status: "complete-within-declared-scope" as const,
        declaredScope: "x",
        observedCount: 0,
        reportedTotal: null,
        excludedScopes: [],
        evidenceRefs: [],
      },
      issues: [],
      report: {} as never,
    };
    expect(r.controller.loadExport(result, 1, "1").ok).toBe(true);
    expect(r.controller.phase).toBe("draft");
    expect((await r.controller.makePlan([fakeId(1)])).ok).toBe(false);
    expect(r.controller.phase).toBe("draft");
  });

  it("a plan is refused while KEEP is locked (AT13)", async () => {
    const r = await rig();
    await r.controller.collect();
    await r.keep.lock();
    const res = await r.controller.makePlan([fakeId(1)]);
    expect(res).toEqual({ ok: false, reason: "keep-unavailable" });
  });

  it("counts each exclusion reason and leaves protected ones out (AT11, AT19, AT20)", async () => {
    const r = await rig();
    r.service.add(fakeRecord(5, { activity: "running" }));
    r.service.add(fakeRecord(6, { stateToken: null }));
    await r.keep.setKeep(keepOf(1), true);
    await r.controller.collect();
    const ids = [fakeId(1), fakeId(2), fakeId(5), fakeId(6), fakeId(77), fakeId(2)];
    expect((await r.controller.makePlan(ids)).ok).toBe(true);
    const plan = r.controller.plan;
    expect(plan?.targets.map((t) => t.conversationId)).toEqual([fakeId(2)]);
    expect(plan?.excluded).toMatchObject({
      "keep-protected": 1,
      "active-or-unknown": 1,
      "state-unknown": 1,
      "not-in-inventory": 1,
      duplicate: 1,
    });
  });

  it("an organization workspace is excluded (D-0002)", async () => {
    const r = await rig();
    r.service.subject = {
      status: "verified",
      accountKey: "acct-a",
      workspaceKey: "ws-a",
      workspaceKind: "organization",
    };
    await r.controller.collect();
    expect((await r.controller.makePlan([fakeId(1)])).ok).toBe(false);
  });
});

describe("PINV-3 dispatch happens only inside the ordered KEEP section", () => {
  it("a KEEP added while prepareCommit awaits is honoured (AT12)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.onPrepare = async () => {
      await r.keep.setKeep(keepOf(1), true);
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("skipped:keep-protected");
  });

  it("a KEEP write queued but not finished before the section is honoured", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.onPrepare = async () => {
      void r.keep.setKeep(keepOf(1), true);
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
  });

  it("another tab's KEEP write before dispatch stops the run without sending", async () => {
    const r = await rig();
    const other = await openKeep(r.profile, false);
    const id = await approved(r, [fakeId(1), fakeId(2)]);
    r.service.onPrepare = async () => {
      await other.setKeep(keepOf(1), true);
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(r.controller.phase).toBe("failed");
    expect(outcomes(r.controller)[fakeId(1)]).toBe("failed:keep-unavailable");
  });

  it("a KEEP added from inside dispatch cannot undo the dispatched write (AT12 limit)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.onDispatch = () => {
      void r.keep.setKeep(keepOf(1), true);
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([fakeId(1)]);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("verified:");
  });

  it("KEEP locked before the section fails the item without sending (AT13)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.onPrepare = async () => {
      await r.keep.lock();
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(r.controller.phase).toBe("failed");
  });
});

describe("PINV-4 at most one dispatch per target, never after stop or expiry", () => {
  it("stop before the next dispatch sends nothing more (AT23)", async () => {
    const r = await rig();
    const id = await approved(r);
    r.service.onDispatch = () => r.controller.stop();
    await r.controller.start(id);
    expect(r.service.commits()).toHaveLength(1);
    expect(r.controller.phase).toBe("paused");
    expect(outcomes(r.controller)[r.service.commits()[0] as string]).toBe("verified:");
  });

  it("approval expiry during preflight prevents the dispatch", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op) => {
      if (op === "preflight") {
        r.profile.clock.advance(61 * 60_000);
      }
      return undefined;
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(r.controller.phase).toBe("paused");
  });

  it("an uncertain dispatched item is never dispatched again by a continuation", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1), fakeId(2)]);
    r.service.commitResponse = (t) => Promise.resolve(anomaly(t.execId, { code: "server-error" }));
    await r.controller.start(id);
    expect(r.controller.phase).toBe("uncertain");
    r.service.commitResponse = null;
    await r.controller.continuation();
    const targets = r.controller.plan?.targets.map((t) => t.conversationId) ?? [];
    expect(targets).not.toContain(r.service.commits()[0]);
  });
});

describe("PINV-5 approvals are single-use and bound", () => {
  it("a second start with the same approval is refused (AT21)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    await r.controller.start(id);
    expect((await r.controller.start(id)).ok).toBe(false);
    expect(r.service.commits()).toHaveLength(1);
  });

  it("an approval for another digest is refused", async () => {
    const r = await rig();
    await r.controller.collect();
    await r.controller.makePlan([fakeId(1)]);
    const plan = r.controller.plan;
    expect((await r.controller.approve(plan?.planId ?? "", "0".repeat(64))).ok).toBe(false);
    expect(r.controller.phase).toBe("ready");
  });

  it("a KEEP generation change after approval refuses start", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    await r.keep.lock();
    await r.keep.unlock("correct horse battery");
    expect((await r.controller.start(id)).ok).toBe(false);
    expect(r.service.commits()).toEqual([]);
  });

  it("a KEEP revision change alone does not invalidate the approval", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    await r.keep.setKeep(keepOf(3), true);
    expect((await r.controller.start(id)).ok).toBe(true);
    expect(r.service.commits()).toEqual([fakeId(1)]);
  });

  it("approve in approved is refused and an expired plan cannot be approved", async () => {
    const r = await rig();
    await approved(r, [fakeId(1)]);
    const plan = r.controller.plan;
    expect((await r.controller.approve(plan?.planId ?? "", plan?.planDigest ?? "")).ok).toBe(false);
    r.controller.revokeApproval();
    r.profile.clock.advance(16 * 60_000);
    expect((await r.controller.approve(plan?.planId ?? "", plan?.planDigest ?? "")).ok).toBe(false);
    expect(r.controller.phase).toBe("draft");
  });
});

describe("PINV-6 verified needs an accepted write and every bound probe", () => {
  it("a write that only hid the conversation is not verified (AT26)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.hideInsteadOfDelete = true;
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:reconcile-unsatisfied");
  });

  it("a reconcile answer for another probe is not counted", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op, t) => {
      const ticket = t as ItemTicket;
      return op === "reconcileOne"
        ? ok(ticket.execId, {
            subject: r.service.subject,
            documentKey: r.service.documentKey,
            conversationId: ticket.conversationId,
            probe: ticket.probe === "list-absent" ? "item-not-found" : ticket.probe,
            satisfied: true,
          })
        : undefined;
    };
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toMatch(/^uncertain:/);
  });

  it("a reconcile answer under another subject is not counted", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op, t) => {
      const ticket = t as ItemTicket;
      return op === "reconcileOne"
        ? ok(ticket.execId, {
            subject: { status: "verified", ...SUBJECT_B, workspaceKind: "personal" },
            documentKey: r.service.documentKey,
            conversationId: ticket.conversationId,
            probe: ticket.probe,
            satisfied: true,
          })
        : undefined;
    };
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toMatch(/^uncertain:/);
  });

  it("a later reconcile cannot verify a write whose response timed out", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.commitResponse = () => new Promise(() => undefined);
    const run = r.controller.start(id);
    await flush();
    r.profile.clock.expireDeadlines();
    await run;
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:timeout");
    await r.controller.reconcileUncertain();
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:timeout");
  });

  it("a reconcile after an accepted write and a failed probe can verify it", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    let first = true;
    r.service.override = (op, t) => {
      if (op === "reconcileOne" && first) {
        first = false;
        return anomaly((t as ItemTicket).execId, { code: "network" });
      }
      return undefined;
    };
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:network");
    await r.controller.reconcileUncertain();
    expect(outcomes(r.controller)[fakeId(1)]).toBe("verified:");
  });
});

describe("PINV-7 an uncertain item stops every later dispatch", () => {
  it("a 429 on commit stops the run and only displays Retry-After (AT25)", async () => {
    const r = await rig();
    const id = await approved(r);
    r.service.commitResponse = (t) =>
      Promise.resolve(anomaly(t.execId, { code: "rate-limited", retryAfterSeconds: 120 }));
    await r.controller.start(id);
    expect(r.service.commits()).toHaveLength(1);
    expect(r.controller.phase).toBe("uncertain");
    expect(r.controller.retryAfterSeconds).toBe(120);
    r.profile.clock.advance(10 * 60_000);
    await flush();
    expect(r.service.commits()).toHaveLength(1);
  });

  for (const code of [
    "server-error",
    "redirect",
    "unexpected-schema",
    "network",
    "auth-changed",
  ] as const) {
    it(`a ${code} on preflight stops before any dispatch`, async () => {
      const r = await rig();
      const id = await approved(r);
      r.service.override = (op, t) =>
        op === "preflight" ? anomaly((t as ItemTicket).execId, { code }) : undefined;
      await r.controller.start(id);
      expect(r.service.commits()).toEqual([]);
      expect(r.controller.phase).toBe("uncertain");
    });
  }

  it("a subject switch at preflight stops even with the same display label (AT16)", async () => {
    const r = await rig();
    const id = await approved(r);
    r.service.subject = { status: "verified", ...SUBJECT_B, workspaceKind: "personal" };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(r.controller.phase).toBe("uncertain");
    expect(r.controller.approval).toBeNull();
  });

  it("a changed fingerprint or activity skips that item and continues (AT19, AT20)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1), fakeId(2), fakeId(3)]);
    r.service.add(fakeRecord(1, { stateToken: "rev-1-2" }));
    r.service.add(fakeRecord(2, { activity: "unknown" }));
    await r.controller.start(id);
    expect(outcomes(r.controller)).toMatchObject({
      [fakeId(1)]: "skipped:state-changed",
      [fakeId(2)]: "skipped:active-or-unknown",
      [fakeId(3)]: "verified:",
    });
    expect(r.controller.phase).toBe("completed");
  });
});

describe("PINV-8 one controller per service in the profile", () => {
  it("overlapping inventories: the second is refused", async () => {
    const r = await rig();
    const b = controllerFor(r.profile, r.service, r.keep);
    let second: Promise<unknown> | null = null;
    r.service.onPage = () => {
      second ??= b.collect();
    };
    expect((await r.controller.collect()).ok).toBe(true);
    expect(await second).toEqual({ ok: false, reason: "service-busy" });
  });

  it("an inventory during another controller's run is refused", async () => {
    const r = await rig();
    const b = controllerFor(r.profile, r.service, r.keep);
    const id = await approved(r, [fakeId(1)]);
    let seen: unknown = null;
    r.service.onPrepare = async () => {
      seen = await b.collect();
    };
    await r.controller.start(id);
    expect(seen).toEqual({ ok: false, reason: "service-busy" });
  });

  it("two simultaneous starts: only one runs (AT22)", async () => {
    const r = await rig();
    const b = controllerFor(r.profile, r.service, r.keep);
    const idA = await approved(r, [fakeId(1)]);
    const idB = await approved({ ...r, controller: b }, [fakeId(2)]);
    const [ra, rb] = await Promise.all([r.controller.start(idA), b.start(idB)]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect(r.service.commits()).toHaveLength(1);
  });

  it("without Web Locks nothing is sent", async () => {
    const r = await rig({ locks: null });
    expect(await r.controller.collect()).toEqual({ ok: false, reason: "locks-unavailable" });
    expect(r.service.log).toEqual([]);
  });
});

describe("PINV-9 invalid adapter output is an anomaly, never a pass", () => {
  it("an extra key in a preflight answer makes the item uncertain", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op, t) => {
      const ticket = t as ItemTicket;
      return op === "preflight"
        ? {
            ...ok(ticket.execId, {
              subject: r.service.subject,
              documentKey: "doc-1",
              item: { kind: "absent", conversationId: fakeId(1) },
            }),
            extra: 1,
          }
        : undefined;
    };
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:invalid-output");
  });

  it("an echoed execId that differs makes the item uncertain", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.commitResponse = () =>
      Promise.resolve(
        ok("00000000-0000-4000-8000-000000000000", { conversationId: fakeId(1), accepted: true }),
      );
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:invalid-output");
  });

  it("a throwing adapter makes the item uncertain", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op) => {
      if (op === "preflight") {
        throw new Error("boom");
      }
      return undefined;
    };
    await r.controller.start(id);
    expect(outcomes(r.controller)[fakeId(1)]).toBe("uncertain:adapter-error");
  });

  it("a dispatch that throws counts as dispatched and uncertain", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.override = (op, t) =>
      op === "prepareCommit"
        ? ok((t as ItemTicket).execId, {
            documentKey: "doc-1",
            dispatch: () => {
              throw new Error("send failed");
            },
          })
        : undefined;
    await r.controller.start(id);
    const item = r.controller.items().find((i) => i.conversationId === fakeId(1));
    expect(item).toMatchObject({ outcome: "uncertain", dispatched: true, writeAccepted: false });
  });
});

describe("PINV-10 request spacing", () => {
  it("every request start, including the first after taking the lock, is spaced", async () => {
    const r = await rig();
    const id = await approved(r);
    await r.controller.start(id);
    const requests = r.service.log.filter((c) => c.op !== "prepareCommit");
    for (let i = 1; i < requests.length; i++) {
      const gap = (requests[i]?.at ?? 0) - (requests[i - 1]?.at ?? 0);
      expect(gap).toBeGreaterThanOrEqual(1_000);
    }
    expect(r.profile.clock.sleeps.length).toBeGreaterThan(0);
  });
});

describe("PINV-11 gates and descriptors", () => {
  it("ownerAcceptedRisk does not enable delete in a distribution build", async () => {
    const profile = newProfile();
    const service = new SyntheticService(() => profile.clock.now());
    const keep = await openKeep(profile, true);
    const gate = {
      technical: "allowed",
      termsAndPermission: "ownerAcceptedRisk",
      storePolicy: "notApplicable",
      safety: "allowed",
      evidenceRefs: ["HISTORY.md#P-0003"],
    } as const;
    const c = controllerFor(profile, service, keep, {
      del: syntheticDelete(service, DELETE_DESCRIPTOR, gate),
    });
    expect(c.deleteEnabled()).toBe(false);
    expect((await c.collect()).ok).toBe(true);
    expect(await c.makePlan([fakeId(1)])).toEqual({ ok: false, reason: "delete-unavailable" });
    const personal = controllerFor(profile, service, keep, {
      del: syntheticDelete(service, DELETE_DESCRIPTOR, gate),
      build: "personal",
    });
    expect(personal.deleteEnabled()).toBe(true);
  });

  it("an unverified updatedAt as the update detector disables delete but not read", async () => {
    const profile = newProfile();
    const service = new SyntheticService(() => profile.clock.now());
    const keep = await openKeep(profile, true);
    const read = syntheticRead(service, {
      ...syntheticRead(service).descriptor,
      timeFields: { createdAt: true, updatedAt: false },
    });
    const del = syntheticDelete(service, {
      ...DELETE_DESCRIPTOR,
      fingerprintFields: ["updatedAt"],
      updateDetector: { field: "updatedAt", evidenceRef: "TEST:x" },
    });
    const c = controllerFor(profile, service, keep, { read, del });
    expect(c.readEnabled()).toBe(true);
    expect(c.deleteEnabled()).toBe(false);
  });

  it("a rule of two negative observations disables delete", async () => {
    const profile = newProfile();
    const service = new SyntheticService(() => profile.clock.now());
    const keep = await openKeep(profile, true);
    const del = syntheticDelete(service, {
      ...DELETE_DESCRIPTOR,
      verificationRule: ["item-not-found", "list-absent"],
    });
    expect(controllerFor(profile, service, keep, { del }).deleteEnabled()).toBe(false);
  });

  it("reads work without any delete adapter", async () => {
    const r = await rig({ del: null });
    expect((await r.controller.collect()).ok).toBe(true);
    expect(await r.controller.makePlan([fakeId(1)])).toEqual({
      ok: false,
      reason: "delete-unavailable",
    });
  });
});

describe("PINV-12 unresolved writes survive the controller", () => {
  it("closing mid-flight leaves the ledger; another controller cannot start until recovery (AT24)", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.commitResponse = () => new Promise(() => undefined);
    void r.controller.start(id);
    await flush();
    expect(r.service.commits()).toEqual([fakeId(1)]);
    r.controller.dispose();
    r.profile.clock.expireDeadlines();
    await flush();
    const stored = JSON.stringify(r.profile.area.data.get(ledgerKey("chatgpt")));
    expect(stored).toContain('"count":1');
    expect(stored).not.toContain(fakeId(1));
    expect(stored).not.toContain("Synthetic conversation");

    r.service.commitResponse = null;
    const b = controllerFor(r.profile, r.service, r.keep);
    await b.collect();
    await b.makePlan([fakeId(2)]);
    const plan = b.plan;
    expect(await b.approve(plan?.planId ?? "", plan?.planDigest ?? "")).toEqual({
      ok: false,
      reason: "recovery-required",
    });

    const status = await b.recoveryStatus();
    expect(status.kind).toBe("pending");
    b.discardPlan();
    expect((await b.acknowledgeRecovery(status.kind === "pending" ? status.token : "")).ok).toBe(
      true,
    );
    await b.makePlan([fakeId(2)]);
    const fresh = b.plan;
    expect((await b.approve(fresh?.planId ?? "", fresh?.planDigest ?? "")).ok).toBe(true);
    expect((await b.start(b.approval?.approvalId ?? "")).ok).toBe(true);
    expect(r.service.commits()).toEqual([fakeId(1), fakeId(2)]);
  });

  it("an approval issued before the recovery is refused afterwards", async () => {
    const r = await rig();
    const b = controllerFor(r.profile, r.service, r.keep);
    const idB = await approved({ ...r, controller: b }, [fakeId(2)]);
    const idA = await approved(r, [fakeId(1)]);
    r.service.commitResponse = (t) => Promise.resolve(anomaly(t.execId, { code: "timeout" }));
    await r.controller.start(idA);
    r.service.commitResponse = null;
    await flush(); // another tab sees the lock only after the manager released it
    expect(await b.start(idB)).toEqual({ ok: false, reason: "recovery-required" });
    await flush(); // b's lock is let go asynchronously, after its open ledger transactions
    expect((await r.controller.collect()).ok).toBe(true);
    const status = await r.controller.recoveryStatus();
    expect(
      (await r.controller.acknowledgeRecovery(status.kind === "pending" ? status.token : "")).ok,
    ).toBe(true);
    expect((await b.start(idB)).ok).toBe(false);
    expect(r.service.commits()).toEqual([fakeId(1)]);
  });

  it("a malformed ledger refuses start", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.profile.area.data.set(ledgerKey("chatgpt"), { format: "nope" });
    expect((await r.controller.start(id)).ok).toBe(false);
    expect(r.service.commits()).toEqual([]);
  });

  it("recovery needs a snapshot taken after the last dispatch", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.service.commitResponse = (t) => Promise.resolve(anomaly(t.execId, { code: "timeout" }));
    await r.controller.start(id);
    const status = await r.controller.recoveryStatus();
    expect(
      await r.controller.acknowledgeRecovery(status.kind === "pending" ? status.token : ""),
    ).toEqual({
      ok: false,
      reason: "not-allowed",
    });
  });
});

describe("PINV-13 inventory completeness and provenance", () => {
  it("a stable listing without issues is complete; without the contract it is unknown", async () => {
    const r = await rig();
    await r.controller.collect();
    expect(r.controller.snapshot?.completeness).toBe("complete");
    const s2 = new SyntheticService(() => r.profile.clock.now());
    const read = syntheticRead(s2, {
      ...syntheticRead(s2).descriptor,
      listing: { stableSnapshot: false, evidenceRef: null, order: "none" },
    });
    const c2 = controllerFor(newProfile(), s2, r.keep, { read });
    await c2.collect();
    expect(c2.snapshot?.completeness).toBe("unknown");
  });

  it("a short end against the reported total is partial", async () => {
    const r = await rig();
    r.service.reportedTotal = 9;
    await r.controller.collect();
    expect(r.controller.snapshot?.completeness).toBe("partial");
  });

  it("a duplicate across pages is partial and never planned", async () => {
    const r = await rig();
    r.service.onPage = (n) => {
      if (n === 1) {
        r.service.add(fakeRecord(1, { updatedAt: "2026-02-01T09:00:00Z" }));
      }
    };
    await r.controller.collect();
    expect(r.controller.snapshot?.completeness).toBe("partial");
    await r.controller.makePlan([fakeId(1), fakeId(2)]);
    expect(r.controller.plan?.targets.map((t) => t.conversationId)).not.toContain(fakeId(1));
  });

  it("an A to B to A switch mid-scan fails the inventory", async () => {
    const r = await rig(undefined, 6);
    const a = r.service.subject;
    r.service.onPage = (n) => {
      r.service.subject =
        n === 1 ? { status: "verified", ...SUBJECT_B, workspaceKind: "personal" } : a;
    };
    expect(await r.controller.collect()).toEqual({ ok: false, reason: "subject-changed" });
    expect(r.controller.phase).toBe("failed");
  });

  it("a document change mid-scan fails the inventory", async () => {
    const r = await rig();
    r.service.onPage = (n) => {
      if (n === 1) {
        r.service.documentKey = "doc-2";
      }
    };
    expect(await r.controller.collect()).toEqual({ ok: false, reason: "document-changed" });
  });

  it("a 429 during the scan fails it and keeps Retry-After for display", async () => {
    const r = await rig();
    r.service.override = (op, t) =>
      op === "listPage"
        ? anomaly((t as { execId: string }).execId, { code: "rate-limited", retryAfterSeconds: 30 })
        : undefined;
    expect((await r.controller.collect()).ok).toBe(false);
    expect(r.controller.retryAfterSeconds).toBe(30);
  });
});

describe("PINV-14 removing a KEEP during a run adds no target", () => {
  it("a conversation un-KEEPed mid-run is not dispatched", async () => {
    const r = await rig();
    await r.keep.setKeep(keepOf(4), true);
    const id = await approved(r);
    r.service.onDispatch = () => {
      void r.keep.setKeep(keepOf(4), false);
    };
    await r.controller.start(id);
    expect(r.service.commits()).not.toContain(fakeId(4));
  });
});

describe("state machine", () => {
  it("rejects illegal transitions without changing state", async () => {
    const r = await rig();
    const c = r.controller;
    expect((await c.makePlan([fakeId(1)])).ok).toBe(false);
    expect((await c.start("x")).ok).toBe(false);
    expect(c.phase).toBe("idle");
    await c.collect();
    expect((await c.start("x")).ok).toBe(false);
    expect(c.phase).toBe("draft");
    await c.makePlan([fakeId(1)]);
    expect((await c.start("x")).ok).toBe(false);
    expect(c.phase).toBe("ready");
    expect((await c.continuation()).ok).toBe(false);
    expect(c.revokeApproval().ok).toBe(false);
    expect(c.phase).toBe("ready");
  });

  it("refuses inventory and planning while running", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    let during: unknown[] = [];
    r.service.onPrepare = async () => {
      during = [
        await r.controller.collect(),
        await r.controller.makePlan([fakeId(2)]),
        r.controller.discard(),
      ];
    };
    await r.controller.start(id);
    expect(during.every((d) => (d as { ok: boolean }).ok === false)).toBe(true);
  });

  it("discard returns to idle and drops the approval", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    expect(r.controller.discard().ok).toBe(true);
    expect(r.controller.phase).toBe("idle");
    expect((await r.controller.start(id)).ok).toBe(false);
  });

  it("a disposed controller sends nothing and accepts no approval", async () => {
    const r = await rig();
    const id = await approved(r, [fakeId(1)]);
    r.controller.dispose();
    expect((await r.controller.start(id)).ok).toBe(false);
    expect(r.service.commits()).toEqual([]);
  });
});
