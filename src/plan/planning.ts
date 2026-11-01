// Stages before a run: inventory, plan, approval and recovery (P-0009
// items 3 to 7). Each function checks the phase it is allowed from.
import type { ImportResult } from "../import/types";
import { type InventorySnapshot, scanInventory, snapshotFromExport } from "./inventory";
import { readLedger } from "./ledger";
import { buildPlan } from "./plan";
import { clearRecovery } from "./recovery";
import { no, OK, type RunState } from "./runState";
import type { OpOutcome, Phase } from "./types";

const COLLECT_FROM: ReadonlySet<Phase> = new Set([
  "idle",
  "draft",
  "paused",
  "failed",
  "completed",
  "uncertain",
]);

export async function collect(s: RunState): Promise<OpOutcome> {
  if (s.disposed || !COLLECT_FROM.has(s.phase)) {
    return no("not-allowed");
  }
  if (!s.readEnabled()) {
    return no("read-unavailable");
  }
  const descriptor = s.adapters.read;
  if (descriptor === null) {
    return no("read-unavailable");
  }
  const refused = await s.acquire();
  if (refused !== null) {
    return no(refused);
  }
  s.phase = "inventory";
  s.clearPlan();
  s.snap = null;
  s.results.clear();
  s.retryAfter = null;
  s.cancelRequested = false;
  try {
    const ledger = await readLedger(s.deps.ledger, s.deps.provider);
    const result = await scanInventory({
      read: s.deps.read,
      descriptor,
      clock: s.deps.clock,
      pacer: s.pacer,
      newId: s.deps.newId,
      ledgerEpoch: ledger.kind === "ok" ? ledger.ledger.epoch : null,
      cancelled: () => s.cancelRequested || s.disposed,
      mayCall: () => s.mayRead(),
    });
    if (result.ok) {
      s.snap = result.snapshot;
      s.phase = "draft";
      return OK;
    }
    const f = result.failure;
    s.phase = f.reason === "cancelled" ? "idle" : "failed";
    if (f.reason === "call") {
      s.retryAfter = f.failure.retryAfterSeconds;
      return no(f.failure.code);
    }
    return no(f.reason);
  } finally {
    s.session.release();
  }
}

export function loadExport(
  s: RunState,
  result: ImportResult,
  importVersion: number,
  importerVersion: string,
): OpOutcome {
  if (s.disposed || s.phase !== "idle") {
    return no("not-allowed");
  }
  const { newId, clock } = s.deps;
  const snap = snapshotFromExport(result, importVersion, importerVersion, newId, clock.now());
  if (snap === null) {
    return no("import-not-plannable");
  }
  s.snap = snap;
  s.phase = "draft";
  return OK;
}

/** Builds a plan from `snap` (from draft, or a continuation from paused/uncertain). */
export async function planFrom(
  s: RunState,
  snap: InventorySnapshot,
  ids: readonly string[],
  parent: string | null,
): Promise<OpOutcome> {
  const del = s.adapters.del;
  if (del === null || !s.deleteEnabled()) {
    return no("delete-unavailable");
  }
  // A web snapshot taken by another adapter identity is never planned from (review 1 #5).
  if (snap.source === "web-api" && !s.adapters.sameIdentity(snap.adapter)) {
    return no("adapter-changed");
  }
  const keep = s.deps.keep.binding();
  if (keep === null) {
    return no("keep-unavailable");
  }
  const from = s.phase;
  const { clock, newId, subtle } = s.deps;
  const result = await buildPlan({
    snapshot: snap,
    ids,
    keep,
    del,
    parentPlanId: parent,
    now: clock.now(),
    newId,
    subtle,
  });
  if (s.disposed || s.phase !== from || s.snap !== snap) {
    return no("superseded");
  }
  if (!result.ok) {
    return no(result.reason);
  }
  s.clearPlan();
  s.plan = result.plan;
  s.keepGeneration = keep.generation;
  s.phase = "ready";
  return OK;
}

export async function approve(s: RunState, planId: string, planDigest: string): Promise<OpOutcome> {
  const plan = s.plan;
  if (s.disposed || s.phase !== "ready" || plan === null) {
    return no("not-allowed");
  }
  if (plan.planId !== planId || plan.planDigest !== planDigest) {
    return no("plan-mismatch");
  }
  if (s.deps.clock.now() >= plan.approvableUntil) {
    s.clearPlan();
    s.phase = "draft";
    return no("plan-expired");
  }
  const refusal = s.preconditions(plan);
  if (refusal !== null) {
    return no(refusal);
  }
  const ledger = await readLedger(s.deps.ledger, s.deps.provider);
  if (s.plan !== plan || s.phase !== "ready") {
    return no("superseded");
  }
  const l = ledger.kind === "ok" ? ledger.ledger : null;
  if (l === null || l.pending !== null || l.epoch !== plan.snapshot.ledgerEpoch) {
    return no("recovery-required");
  }
  const fields = { approvalId: s.deps.newId(), planId, planDigest, ledgerEpoch: l.epoch };
  s.approvals.issue(fields, s.deps.clock.now());
  s.stopRequested = false; // a stop applies to the approval it hit, not to a new one
  s.phase = "approved";
  return OK;
}

/** The person confirmed the unresolved writes on the service (P-0009 item 3). */
export async function acknowledgeRecovery(s: RunState, seenToken: string): Promise<OpOutcome> {
  const snap = s.snap;
  if (s.disposed || s.phase !== "draft" || snap === null || snap.source !== "web-api") {
    return no("not-allowed");
  }
  const busy = await s.acquire();
  if (busy !== null) {
    return no(busy);
  }
  try {
    const result = await s.session.transaction((open) =>
      clearRecovery(s.deps, snap, seenToken, open),
    );
    const cleared =
      result === "not-held" ? ({ ok: false, reason: "not-allowed" } as const) : result;
    if (!cleared.ok) {
      return no(cleared.reason);
    }
    if (cleared.epoch !== null && s.snap === snap) {
      s.snap = { ...snap, ledgerEpoch: cleared.epoch };
      s.clearPlan();
    }
    return OK;
  } finally {
    s.session.release();
  }
}
