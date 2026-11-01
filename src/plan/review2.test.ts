// Regression tests for PR #10 review round 2 (each reproduced a defect first).
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DeleteAdapter, ItemTicket } from "../adapters/contracts";
import {
  ALLOWED_GATE,
  anomaly,
  DELETE_DESCRIPTOR,
  fakeId,
  SyntheticService,
  syntheticDelete,
  syntheticRead,
} from "../adapters/testing/synthetic";
import type { StorageAreaLike } from "../keep/keepGateway";
import type { KeepEntry } from "../keep/keepRules";
import { ledgerKey } from "./ledger";
import { RunController } from "./runController";
import { flush } from "./testing/fakes";
import { approved, controllerFor, outcomes, type Rig, rig, subtle } from "./testing/harness";
import type { KeepPort, RunDeps } from "./types";

/** A ledger storage whose next get() returns its value only when released (read taken, write pending). */
function holdableStorage(inner: StorageAreaLike) {
  let hold: Promise<void> | null = null;
  let release: () => void = () => undefined;
  const storage: StorageAreaLike = {
    get: async (key) => {
      const value = await inner.get(key);
      const h = hold;
      hold = null;
      if (h !== null) {
        await h;
      }
      return value;
    },
    set: async (items) => {
      const h = setHold;
      setHold = null;
      if (h !== null) {
        await h; // the write has started but has not landed yet
      }
      return inner.set(items);
    },
    remove: (key) => inner.remove(key),
  };
  let setHold: Promise<void> | null = null;
  let releaseSet: () => void = () => undefined;
  return {
    storage,
    holdNext: () => {
      hold = new Promise<void>((r) => {
        release = r;
      });
      return () => release();
    },
    holdNextSet: () => {
      setHold = new Promise<void>((r) => {
        releaseSet = r;
      });
      return () => releaseSet();
    },
  };
}

function depsFor(
  r: Rig,
  del: DeleteAdapter,
  extra: Partial<Omit<RunDeps, "del" | "keep">> = {},
): RunDeps & { del: DeleteAdapter; keep: KeepPort } {
  return {
    provider: "chatgpt",
    read: syntheticRead(r.service),
    del,
    build: "distribution",
    keep: r.keep,
    ledger: r.profile.area.view(),
    locks: r.profile.serviceLocks,
    clock: r.profile.clock,
    newId: () => webcrypto.randomUUID(),
    subtle,
    ...extra,
  };
}

/** A runs one item and holds its releaseClaim ledger read (or write) when verification ends. */
async function stalledRelease(r: Rig, phase: "read" | "write") {
  const held = holdableStorage(r.profile.area.view());
  const a = controllerFor(r.profile, r.service, r.keep, { ledger: held.storage });
  const id = await approved({ ...r, controller: a }, [fakeId(1)]);
  let release: () => void = () => undefined;
  r.service.override = (op, t) => {
    if (op === "reconcileOne" && (t as ItemTicket).probe === "list-absent") {
      // The next ledger get (or set) is releaseClaim's.
      release = phase === "read" ? held.holdNext() : held.holdNextSet();
    }
    return undefined;
  };
  void a.start(id);
  await flush();
  r.service.override = null;
  return { a, release: () => release() };
}

describe("review 2 #1 / review 3: ledger transactions and the lock tenure", () => {
  it("a fenced read does not hold the lock, and its late result does not overwrite a newer barrier", async () => {
    const r = await rig();
    const { a, release } = await stalledRelease(r, "read");
    a.dispose();
    await flush();

    const b = controllerFor(r.profile, r.service, r.keep);
    expect((await b.collect()).ok).toBe(true); // the stalled read no longer holds the lock
    const seen = await b.recoveryStatus();
    expect((await b.acknowledgeRecovery(seen.kind === "pending" ? seen.token : "")).ok).toBe(true);
    const idB = await approved({ ...r, controller: b }, [fakeId(2)]);
    r.service.commitResponse = (t) => Promise.resolve(anomaly(t.execId, { code: "timeout" }));
    await b.start(idB);
    await flush();
    expect(await b.recoveryStatus()).toMatchObject({ kind: "pending", count: 1 });

    release(); // A's read settles now, after B's barrier exists
    await flush();
    const stored = r.profile.area.data.get(ledgerKey("chatgpt")) as {
      epoch: number;
      pending: { count: number } | null;
    };
    expect(stored.epoch).toBe(1);
    expect(stored.pending?.count).toBe(1);
  });

  it("a write already started keeps the lock until it lands (fail closed)", async () => {
    const r = await rig();
    const { a, release } = await stalledRelease(r, "write");
    a.dispose();
    await flush();
    const b = controllerFor(r.profile, r.service, r.keep);
    expect(await b.collect()).toEqual({ ok: false, reason: "service-busy" });
    release();
    await flush();
    expect((await b.collect()).ok).toBe(true);
  });
});

describe("review 2 #2: calls go to the exact instances that were validated", () => {
  it("replacing deps.del after approval does not reach the replacement", async () => {
    const r = await rig();
    const other = new SyntheticService(() => r.profile.clock.now());
    const replacement = syntheticDelete(
      other,
      { ...DELETE_DESCRIPTOR, version: "9" },
      { ...ALLOWED_GATE, safety: "blocked" },
    );
    const deps = depsFor(r, syntheticDelete(r.service));
    const c = new RunController(deps);
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    deps.del = replacement;
    await c.start(id);
    expect(other.log).toEqual([]);
    expect(r.service.commits()).toEqual([fakeId(1)]);
  });

  it("swapping a method on the validated adapter does not reach the swapped method", async () => {
    const r = await rig();
    const other = new SyntheticService(() => r.profile.clock.now());
    const original = syntheticDelete(r.service) as {
      -readonly [K in keyof DeleteAdapter]: DeleteAdapter[K];
    };
    const c = new RunController(depsFor(r, original));
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    const swapped = syntheticDelete(other);
    original.preflight = swapped.preflight;
    original.prepareCommit = swapped.prepareCommit;
    await c.start(id);
    expect(other.log).toEqual([]);
  });

  it("replacing deps.keep after approval cannot hide a KEEP", async () => {
    const r = await rig();
    const deps = depsFor(r, syntheticDelete(r.service));
    const c = new RunController(deps);
    const id = await approved({ ...r, controller: c }, [fakeId(1)]);
    const keepEntry: KeepEntry = { provider: "chatgpt", conversationId: fakeId(1), scope: null };
    await r.keep.setKeep(keepEntry, true);
    const real = r.keep;
    deps.keep = {
      binding: () => {
        const b = real.binding();
        return b === null ? null : { ...b, entries: [] };
      },
      withOrderedSnapshot: (fn) =>
        real.withOrderedSnapshot((v) => fn(v.status === "available" ? { ...v, entries: [] } : v)),
    };
    await c.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(outcomes(c)[fakeId(1)]).toBe("skipped:keep-protected");
  });
});
