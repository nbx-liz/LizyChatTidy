// The read side callers bind to (P-0009 item 8): binding() and
// withOrderedSnapshot(), both over the store's single KeepCore.
import { envelopeToken } from "./envelope";
import type { KeepCore } from "./keepCore";
import { frozenEntries, type KeepBinding, type OrderedKeepView } from "./keepTypes";

/**
 * The authenticated session's KEEP state, read together; null unless the
 * store is available with a session (lock() drops the session before it
 * publishes locked, so this is null in that window) (P-0009 item 8).
 */
export function binding(core: KeepCore): KeepBinding | null {
  const s = core.session;
  if (core.state.status !== "available" || s === null) {
    return null;
  }
  return {
    entries: frozenEntries(s.entries),
    revision: s.envelope.revision,
    storeId: s.envelope.storeId,
    generation: core.generation,
  };
}

/**
 * Runs the synchronous `fn` inside this store's serial queue and the KEEP
 * Web Lock, after re-reading the stored envelope and confirming it is the
 * authenticated one and the generation is unchanged, so no KEEP write of
 * this tab or another one lands between this read and what `fn` does.
 * `fn` must not await: the queue and the lock are released when it returns
 * (P-0009 item 8). It is called exactly once.
 */
export async function withOrderedSnapshot<T>(
  core: KeepCore,
  fn: (view: OrderedKeepView) => T,
): Promise<T> {
  return core.serial(async () => {
    const gen = core.generation;
    const s = core.session;
    if (core.state.status !== "available" || s === null) {
      return fn({ status: "not-available", reason: "state" });
    }
    const expected = envelopeToken(s.envelope);
    let ran: { value: T } | null = null;
    const outcome = await core.underLock(gen, async (now) => {
      if (now.kind !== "envelope" || now.token !== expected) {
        return "conflict" as const;
      }
      ran = {
        value: fn({
          status: "available",
          entries: frozenEntries(s.entries),
          revision: s.envelope.revision,
          storeId: s.envelope.storeId,
          generation: gen,
        }),
      };
      return "ok" as const;
    });
    if (ran !== null) {
      return (ran as { value: T }).value;
    }
    if (outcome === "conflict" || outcome === "read-failed" || outcome === "lock-unavailable") {
      core.failIf(gen, outcome);
    }
    // A lock timeout leaves the store as it is (P-0009 item 8).
    const reason = outcome === "ok" ? "superseded" : outcome;
    return fn({ status: "not-available", reason });
  });
}
