// Verification of one dispatched write (P-0009 items 9 and 10): every probe
// of the validated rule copy, bound to the requested probe, target, document
// and planned subject, after an accepted write response.
import type { EvidenceKind, ReconcileValue } from "../adapters/contracts";
import { parseReconcile } from "../adapters/validate";
import { type CallResult, call } from "./calls";
import { releaseClaim } from "./ledger";
import {
  afterSend,
  boundSubject,
  failedCall,
  markUncertain,
  type Step,
  ticketFor,
} from "./runnerSupport";
import type { RunContext } from "./section";

function checkProbe(
  ctx: RunContext,
  id: string,
  probe: EvidenceKind,
  res: CallResult<ReconcileValue>,
): Step | null {
  if (!res.ok) {
    return failedCall(ctx, id, res.failure);
  }
  const v = res.value;
  if (!boundSubject(ctx, v.subject)) {
    return markUncertain(ctx, id, "subject-changed");
  }
  if (v.probe !== probe || v.conversationId !== id || v.documentKey !== ctx.plan.documentKey) {
    return markUncertain(ctx, id, "invalid-output");
  }
  return v.satisfied ? null : markUncertain(ctx, id, "reconcile-unsatisfied");
}

/**
 * Verified only with an accepted write, every bound probe satisfied, and the
 * adapter's declarations still equal to the validated copy (review 1 #6, #7).
 */
export async function verifyItem(ctx: RunContext, id: string): Promise<Step> {
  const { deps, del, pacer, delDescriptor } = ctx;
  if (!ctx.item(id).writeAccepted) {
    return "uncertain";
  }
  for (const probe of delDescriptor.verificationRule) {
    const early = afterSend(ctx, id);
    if (early !== null) {
      return early;
    }
    await pacer.wait();
    const blocked = afterSend(ctx, id);
    if (blocked !== null) {
      return blocked;
    }
    pacer.mark();
    const t = ticketFor(ctx, "reconcile", id, probe);
    const res = await call(
      deps.clock,
      t.execId,
      (s) => del.reconcileOne(t, s),
      (v) => parseReconcile(v, deps.provider),
    );
    const bad = checkProbe(ctx, id, probe, res);
    if (bad !== null) {
      return bad;
    }
  }
  const last = afterSend(ctx, id);
  if (last !== null) {
    return last;
  }
  ctx.setItem(id, { outcome: "verified", reason: null });
  const claim = ctx.claimOf(id);
  // Without its claim the count cannot be attributed, so it stays (fail closed).
  if (claim === undefined) {
    return "continue";
  }
  return (await releaseClaim(deps.ledger, deps.provider, claim)) ? "continue" : "failed";
}
