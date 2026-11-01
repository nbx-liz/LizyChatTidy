// Stages of and after a run: start, reconcile and continuation (P-0009
// items 7 and 9).
import type { DeleteAdapter } from "../adapters/contracts";
import { ItemRunner } from "./itemRunner";
import { readLedger } from "./ledger";
import { type DeletePlan, digestOf } from "./plan";
import { planFrom } from "./planning";
import { no, OK, type RunState } from "./runState";
import type { OpOutcome, Phase } from "./types";

const AFTER_STOP: ReadonlySet<Phase> = new Set(["paused", "uncertain"]);

function beginRun(s: RunState, plan: DeletePlan): void {
  s.retryAfter = null;
  s.results.clear();
  for (const t of plan.targets) {
    s.results.set(
      t.conversationId,
      Object.freeze({
        conversationId: t.conversationId,
        outcome: "pending",
        reason: null,
        dispatched: false,
        writeAccepted: false,
      }),
    );
  }
  s.phase = "running";
}

/** The plan still hashes to the digest the approval was issued for (review 1 #2). */
async function intactPlan(s: RunState, plan: DeletePlan, digest: string): Promise<boolean> {
  const { planDigest: _stored, ...body } = plan;
  try {
    return (await digestOf(s.deps.subtle, body)) === digest;
  } catch {
    return false;
  }
}

/** A stop, a close or a replaced approval since `approvalId` was checked (review 1 #3). */
function superseded(s: RunState, approvalId: string): string | null {
  if (s.disposed) {
    return "not-allowed";
  }
  if (s.stopRequested) {
    return "stopped";
  }
  return s.phase === "approved" && s.approvals.current?.approvalId === approvalId
    ? null
    : "superseded";
}

export async function start(s: RunState, approvalId: string): Promise<OpOutcome> {
  const plan = s.plan;
  const approval = s.approvals.current;
  if (s.disposed || s.phase !== "approved" || plan === null || approval === null) {
    return no("not-allowed");
  }
  if (s.stopRequested || !s.approvals.usable(approvalId, plan.planId, plan.planDigest)) {
    return no("approval-invalid");
  }
  const expired = s.deps.clock.now() >= approval.expiresAt;
  const refusal = expired ? "approval-expired" : s.preconditions(plan);
  if (refusal !== null) {
    return s.backToReady(refusal);
  }
  const intact = await intactPlan(s, plan, approval.planDigest);
  const afterDigest = superseded(s, approvalId);
  if (afterDigest !== null) {
    return no(afterDigest);
  }
  if (!intact) {
    return s.backToReady("plan-mismatch");
  }
  const busy = await s.acquire();
  if (busy !== null) {
    return no(busy);
  }
  const read = await readLedger(s.deps.ledger, s.deps.provider);
  const l = read.kind === "ok" ? read.ledger : null;
  const blocked = l === null || l.pending !== null || l.epoch !== approval.ledgerEpoch;
  const late = superseded(s, approvalId) ?? s.preconditions(plan);
  const ctx = s.context(s.deps.del as DeleteAdapter, plan);
  if (blocked || late !== null || ctx === null) {
    s.session.release();
    if (s.disposed || s.stopRequested) {
      return no(late ?? "stopped");
    }
    return s.backToReady(blocked ? "recovery-required" : (late ?? "delete-unavailable"));
  }
  s.approvals.consume();
  beginRun(s, plan);
  try {
    const end = await new ItemRunner(ctx).runAll();
    if (end !== "disposed" && !s.disposed) {
      s.phase = s.items().some((i) => i.outcome === "uncertain") ? "uncertain" : end;
    }
  } finally {
    s.session.release();
  }
  return OK;
}

/** Reconciles uncertain items whose write response was accepted (P-0009 item 9). */
export async function reconcileUncertain(s: RunState): Promise<OpOutcome> {
  const plan = s.plan;
  const del = s.deps.del;
  if (s.disposed || !AFTER_STOP.has(s.phase) || plan === null || del === null) {
    return no("not-allowed");
  }
  // Every Delete method needs the gate and the unchanged declarations (PINV-11, review 1 #7).
  if (!s.deleteEnabled() || !s.adapters.sameIdentity(plan.adapter)) {
    return no("delete-unavailable");
  }
  const busy = await s.acquire();
  if (busy !== null) {
    return no(busy);
  }
  try {
    const ctx = s.context(del, plan);
    if (ctx === null) {
      return no("delete-unavailable");
    }
    const runner = new ItemRunner(ctx);
    for (const item of s.items()) {
      if (item.outcome === "uncertain" && item.dispatched && item.writeAccepted) {
        const step = await runner.verify(item.conversationId);
        if (step === "disposed") {
          break;
        }
      }
    }
    if (!s.disposed && !s.items().some((i) => i.outcome === "uncertain")) {
      s.phase = "paused";
    }
    return OK;
  } finally {
    s.session.release();
  }
}

/** A subset plan of what was never sent (P-0009 item 9); it needs a new approval. */
export async function continuation(s: RunState): Promise<OpOutcome> {
  const plan = s.plan;
  const snap = s.snap;
  if (s.disposed || !AFTER_STOP.has(s.phase) || plan === null || snap === null) {
    return no("not-allowed");
  }
  const ids = s
    .items()
    .filter((i) => i.outcome === "pending" || (i.outcome === "uncertain" && !i.dispatched))
    .map((i) => i.conversationId);
  return ids.length === 0 ? no("no-targets") : planFrom(s, snap, ids, plan.planId);
}
