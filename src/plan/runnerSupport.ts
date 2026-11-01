// Shared steps of the per-item protocol (P-0009 item 9): tickets, item
// outcomes and the checks made after every wait and before every call.
import type {
  EvidenceKind,
  ItemOperation,
  ItemTicket,
  SubjectEvidence,
} from "../adapters/contracts";
import { CALL_DEADLINE_MS, type CallFailure } from "./calls";
import type { RunContext } from "./section";
import type { Liveness, Terminal } from "./types";

export type Step = "continue" | Terminal | "disposed";

/** A frozen ticket with its own copy of the subject: an adapter cannot reach the plan. */
export function ticketFor(
  ctx: RunContext,
  op: ItemOperation,
  id: string,
  probe: EvidenceKind | null,
): ItemTicket {
  const { plan, deps } = ctx;
  return Object.freeze({
    execId: deps.newId(),
    planId: plan.planId,
    planDigest: plan.planDigest,
    subject: Object.freeze({
      accountKey: plan.subject.accountKey,
      workspaceKey: plan.subject.workspaceKey,
    }),
    documentKey: plan.documentKey,
    conversationId: id,
    operation: op,
    probe,
    expiresAt: deps.clock.now() + CALL_DEADLINE_MS,
  });
}

export function markUncertain(ctx: RunContext, id: string, reason: string): "uncertain" {
  ctx.setItem(id, { outcome: "uncertain", reason });
  return "uncertain";
}

export function failedCall(ctx: RunContext, id: string, failure: CallFailure): "uncertain" {
  ctx.noteRetryAfter(failure.retryAfterSeconds);
  if (failure.code === "auth-changed") {
    ctx.invalidateApproval();
  }
  return markUncertain(ctx, id, failure.code);
}

export function boundSubject(ctx: RunContext, subject: SubjectEvidence): boolean {
  const s = ctx.plan.subject;
  return (
    subject.status === "verified" &&
    subject.workspaceKind === "personal" &&
    subject.accountKey === s.accountKey &&
    subject.workspaceKey === s.workspaceKey
  );
}

export function stopFor(ctx: RunContext, l: Exclude<Liveness, "live">, id: string): Step {
  if (l === "disposed") {
    return "disposed";
  }
  if (l === "invalid") {
    ctx.setItem(id, { outcome: "failed", reason: "approval-invalid" });
    return "failed";
  }
  return "paused"; // stopped or expired: the item stays pending, nothing was sent.
}

/** Before anything was sent for this item: null to go on, or the step to stop with. */
export function beforeSend(ctx: RunContext, id: string): Step | null {
  const l = ctx.liveness();
  if (l !== "live") {
    return stopFor(ctx, l, id);
  }
  const c = ctx.callable();
  if (c === "disposed") {
    return "disposed";
  }
  if (c === "delete-unavailable") {
    ctx.setItem(id, { outcome: "failed", reason: "delete-unavailable" });
    return "failed";
  }
  return null;
}

/** After the write was sent: reads stay allowed after a stop, never after close or a gate change. */
export function afterSend(ctx: RunContext, id: string): Step | null {
  const c = ctx.callable();
  if (c === "disposed") {
    return "disposed";
  }
  return c === "delete-unavailable" ? markUncertain(ctx, id, "delete-unavailable") : null;
}
