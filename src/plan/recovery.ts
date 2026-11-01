// Recovery from unresolved writes (P-0009 item 3): reading the barrier and
// clearing it after the person confirmed the service state by hand.
import type { InventorySnapshot } from "./inventory";
import { LEDGER_FORMAT, readLedger, writeLedger } from "./ledger";
import type { RecoveryStatus, RunDeps } from "./types";

export async function recoveryStatusOf(deps: RunDeps): Promise<RecoveryStatus> {
  const read = await readLedger(deps.ledger, deps.provider);
  if (read.kind === "read-failed") {
    return { kind: "read-failed" };
  }
  if (read.kind === "malformed") {
    return { kind: "malformed", token: read.token };
  }
  const p = read.ledger.pending;
  return p === null
    ? { kind: "clear" }
    : { kind: "pending", count: p.count, lastDispatchedAt: p.lastDispatchedAt, token: read.token };
}

export type Cleared =
  | { readonly ok: true; readonly epoch: number | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Must run under the service lock. Clears the barrier only if it is still
 * the one the person saw and the snapshot was taken after the last dispatch;
 * the epoch advances so every older plan and approval stops passing.
 * Returns epoch null when there was nothing to clear.
 */
export async function clearRecovery(
  deps: RunDeps,
  snap: InventorySnapshot,
  seenToken: string,
): Promise<Cleared> {
  const read = await readLedger(deps.ledger, deps.provider);
  if (read.kind === "read-failed") {
    return { ok: false, reason: "ledger-read-failed" };
  }
  if (read.token !== seenToken) {
    return { ok: false, reason: "changed" };
  }
  if (read.kind === "ok" && read.ledger.pending === null) {
    return { ok: true, epoch: null };
  }
  if (read.kind === "ok" && snap.capturedAt <= (read.ledger.pending?.lastDispatchedAt ?? 0)) {
    return { ok: false, reason: "not-allowed" };
  }
  // A malformed ledger has no usable epoch; a time-based one cannot collide with a counter.
  const epoch = read.kind === "ok" ? read.ledger.epoch + 1 : Math.max(deps.clock.now(), 1);
  const written = await writeLedger(deps.ledger, {
    format: LEDGER_FORMAT,
    schemaVersion: 1,
    provider: deps.provider,
    epoch,
    pending: null,
  });
  return written ? { ok: true, epoch } : { ok: false, reason: "ledger-write-failed" };
}
