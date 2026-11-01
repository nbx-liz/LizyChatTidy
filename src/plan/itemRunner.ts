// The per-item protocol (P-0009 items 8 and 9): preflight, prepare, ledger
// write-ahead, the ordered KEEP section with a synchronous dispatch, the
// response, and the bound reconcile probes. After every await and right
// before every adapter call the runner re-checks that this controller may
// still call (not closed, service lock held, Delete still enabled) (review 1
// #4, #7).
import type { InventoryRecord, ItemTicket } from "../adapters/contracts";
import { parseCommitValue, parsePreflight, parsePrepared } from "../adapters/validate";
import { call, settle } from "./calls";
import { claimPending, releaseClaim } from "./ledger";
import { fingerprintOf } from "./plan";
import {
  beforeSend,
  boundSubject,
  failedCall,
  markUncertain,
  type Step,
  stopFor,
  ticketFor,
} from "./runnerSupport";
import { dispatchInSection, type RunContext, type Section } from "./section";
import type { Terminal } from "./types";
import { verifyItem } from "./verify";

export type { RunContext } from "./section";

export class ItemRunner {
  constructor(private readonly ctx: RunContext) {}

  /** Runs every pending target in plan order; stops at the first terminal step. */
  async runAll(): Promise<Terminal | "disposed"> {
    for (const target of this.ctx.plan.targets) {
      if (this.ctx.item(target.conversationId).outcome !== "pending") {
        continue;
      }
      const checked = await this.preflight(target.conversationId, target.fingerprint);
      const step = checked === "commit" ? await this.commit(target.conversationId) : checked;
      if (step !== "continue") {
        return step;
      }
    }
    return "completed";
  }

  verify(id: string): Promise<Step> {
    return verifyItem(this.ctx, id);
  }

  private async preflight(id: string, fingerprint: string): Promise<Step | "commit"> {
    const ctx = this.ctx;
    const { deps, del, pacer, readDescriptor } = ctx;
    const early = beforeSend(ctx, id);
    if (early !== null) {
      return early;
    }
    await pacer.wait();
    const stop = beforeSend(ctx, id);
    if (stop !== null) {
      return stop;
    }
    pacer.mark();
    const t = ticketFor(ctx, "preflight", id, null);
    const listed = readDescriptor.listedKinds;
    const res = await call(
      deps.clock,
      t.execId,
      (s) => del.preflight(t, s),
      (v) => parsePreflight(v, deps.provider, listed),
    );
    if (!res.ok) {
      return failedCall(ctx, id, res.failure);
    }
    const v = res.value;
    if (!boundSubject(ctx, v.subject)) {
      ctx.invalidateApproval();
      return markUncertain(ctx, id, "subject-changed");
    }
    if (v.documentKey !== ctx.plan.documentKey) {
      return markUncertain(ctx, id, "document-changed");
    }
    if (v.item.kind === "absent") {
      if (v.item.conversationId !== id) {
        return markUncertain(ctx, id, "invalid-output");
      }
      ctx.setItem(id, { outcome: "skipped", reason: "absent-before-commit" });
      return "continue";
    }
    return this.checkRecord(id, fingerprint, v.item.record);
  }

  private async checkRecord(
    id: string,
    fingerprint: string,
    record: InventoryRecord,
  ): Promise<Step | "commit"> {
    const ctx = this.ctx;
    if (record.conversationId !== id) {
      return markUncertain(ctx, id, "invalid-output");
    }
    if (record.activity !== "idle") {
      ctx.setItem(id, { outcome: "skipped", reason: "active-or-unknown" });
      return "continue";
    }
    const now = await fingerprintOf(ctx.deps.subtle, record, ctx.delDescriptor.fingerprintFields);
    if (now !== fingerprint) {
      ctx.setItem(id, { outcome: "skipped", reason: "state-changed" });
      return "continue";
    }
    return "commit";
  }

  private async commit(id: string): Promise<Step> {
    const ctx = this.ctx;
    const { deps, del, pacer, plan } = ctx;
    const early = beforeSend(ctx, id);
    if (early !== null) {
      return early;
    }
    const t = ticketFor(ctx, "commit", id, null);
    const prep = await call(deps.clock, t.execId, (s) => del.prepareCommit(t, s), parsePrepared);
    if (!prep.ok) {
      return failedCall(ctx, id, prep.failure);
    }
    if (prep.value.documentKey !== plan.documentKey) {
      return markUncertain(ctx, id, "document-changed");
    }
    await pacer.wait();
    const stop = beforeSend(ctx, id);
    if (stop !== null) {
      return stop;
    }
    const epoch = plan.snapshot.ledgerEpoch;
    const now = deps.clock.now();
    const claim = await claimPending(deps.ledger, deps.provider, epoch, now, deps.newId);
    if (claim === null) {
      ctx.setItem(id, { outcome: "failed", reason: "ledger-write-failed" });
      return "failed";
    }
    ctx.setClaim(id, claim);
    const section = await dispatchInSection(ctx, id, prep.value);
    if (section.kind === "dispatched") {
      ctx.setItem(id, { dispatched: true });
      return this.afterDispatch(id, t, section.response);
    }
    if (section.kind === "dispatch-failed") {
      ctx.setItem(id, { dispatched: true });
      return markUncertain(ctx, id, "adapter-error");
    }
    // Not dispatched: take the write-ahead back from its own barrier.
    const released = await releaseClaim(deps.ledger, deps.provider, claim);
    const step = this.notDispatched(id, section.kind);
    if (released || step === "disposed") {
      return step;
    }
    if (ctx.item(id).outcome === "pending") {
      ctx.setItem(id, { outcome: "failed", reason: "ledger-write-failed" });
    }
    return "failed";
  }

  private notDispatched(
    id: string,
    kind: Exclude<Section["kind"], "dispatched" | "dispatch-failed">,
  ): Step {
    if (kind === "keep-protected") {
      this.ctx.setItem(id, { outcome: "skipped", reason: "keep-protected" });
      return "continue";
    }
    if (kind === "keep-unavailable" || kind === "delete-unavailable") {
      this.ctx.setItem(id, { outcome: "failed", reason: kind });
      return "failed";
    }
    return stopFor(this.ctx, kind, id);
  }

  private async afterDispatch(
    id: string,
    t: ItemTicket,
    response: PromiseLike<unknown>,
  ): Promise<Step> {
    const ctx = this.ctx;
    const provider = ctx.deps.provider;
    const res = await settle(ctx.deps.clock, response, t.execId, (v) =>
      parseCommitValue(v, provider),
    );
    if (ctx.callable() === "disposed") {
      return "disposed";
    }
    if (!res.ok) {
      return failedCall(ctx, id, res.failure);
    }
    if (res.value.conversationId !== id) {
      return markUncertain(ctx, id, "invalid-output");
    }
    ctx.setItem(id, { writeAccepted: true });
    return verifyItem(ctx, id);
  }
}
