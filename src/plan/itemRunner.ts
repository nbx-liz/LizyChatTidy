// The per-item protocol (P-0009 items 8 and 9): preflight, prepare, ledger
// write-ahead, the ordered KEEP section with a synchronous dispatch, the
// response, and the bound reconcile probes.
import type {
  EvidenceKind,
  InventoryRecord,
  ItemOperation,
  ItemTicket,
  SubjectEvidence,
} from "../adapters/contracts";
import {
  parseCommitValue,
  parsePreflight,
  parsePrepared,
  parseReconcile,
} from "../adapters/validate";
import { CALL_DEADLINE_MS, type CallFailure, call, settle } from "./calls";
import { updateLedger, withOneLessPending, withOneMorePending } from "./ledger";
import { fingerprintOf } from "./plan";
import { dispatchInSection, type RunContext, type Section } from "./section";
import type { Liveness, Terminal } from "./types";

export type { RunContext } from "./section";

type Step = "continue" | Terminal | "disposed";

export class ItemRunner {
  constructor(private readonly ctx: RunContext) {}

  private ticket(op: ItemOperation, id: string, probe: EvidenceKind | null): ItemTicket {
    const { plan, deps } = this.ctx;
    return {
      execId: deps.newId(),
      planId: plan.planId,
      planDigest: plan.planDigest,
      subject: plan.subject,
      documentKey: plan.documentKey,
      conversationId: id,
      operation: op,
      probe,
      expiresAt: deps.clock.now() + CALL_DEADLINE_MS,
    };
  }

  private uncertain(id: string, reason: string): "uncertain" {
    this.ctx.setItem(id, { outcome: "uncertain", reason });
    return "uncertain";
  }

  private failedCall(id: string, failure: CallFailure): "uncertain" {
    this.ctx.noteRetryAfter(failure.retryAfterSeconds);
    if (failure.code === "auth-changed") {
      this.ctx.invalidateApproval();
    }
    return this.uncertain(id, failure.code);
  }

  private boundSubject(subject: SubjectEvidence): boolean {
    const s = this.ctx.plan.subject;
    return (
      subject.status === "verified" &&
      subject.workspaceKind === "personal" &&
      subject.accountKey === s.accountKey &&
      subject.workspaceKey === s.workspaceKey
    );
  }

  /** Runs every pending target in plan order; stops at the first terminal step. */
  async runAll(): Promise<Terminal | "disposed"> {
    for (const target of this.ctx.plan.targets) {
      if (this.ctx.item(target.conversationId).outcome !== "pending") {
        continue;
      }
      const step = await this.runOne(target.conversationId, target.fingerprint);
      if (step !== "continue") {
        return step;
      }
    }
    return "completed";
  }

  private stopFor(l: Exclude<Liveness, "live">, id: string): Step {
    if (l === "disposed") {
      return "disposed";
    }
    if (l === "invalid") {
      this.ctx.setItem(id, { outcome: "failed", reason: "approval-invalid" });
      return "failed";
    }
    return "paused"; // stopped or expired: the item stays pending, nothing was sent.
  }

  private async runOne(id: string, fingerprint: string): Promise<Step> {
    const l1 = this.ctx.liveness();
    if (l1 !== "live") {
      return this.stopFor(l1, id);
    }
    const checked = await this.preflight(id, fingerprint);
    if (checked !== "commit") {
      return checked;
    }
    const l2 = this.ctx.liveness();
    if (l2 !== "live") {
      return this.stopFor(l2, id);
    }
    return this.commit(id);
  }

  private async preflight(id: string, fingerprint: string): Promise<Step | "commit"> {
    const { deps, del, pacer } = this.ctx;
    const t = this.ticket("preflight", id, null);
    await pacer.beforeRequest();
    const listed = deps.read.descriptor.listedKinds;
    const res = await call(
      deps.clock,
      t.execId,
      (s) => del.preflight(t, s),
      (v) => parsePreflight(v, deps.provider, listed),
    );
    if (!res.ok) {
      return this.failedCall(id, res.failure);
    }
    const v = res.value;
    if (!this.boundSubject(v.subject)) {
      this.ctx.invalidateApproval();
      return this.uncertain(id, "subject-changed");
    }
    if (v.documentKey !== this.ctx.plan.documentKey) {
      return this.uncertain(id, "document-changed");
    }
    if (v.item.kind === "absent") {
      if (v.item.conversationId !== id) {
        return this.uncertain(id, "invalid-output");
      }
      this.ctx.setItem(id, { outcome: "skipped", reason: "absent-before-commit" });
      return "continue";
    }
    return this.checkRecord(id, fingerprint, v.item.record);
  }

  private async checkRecord(
    id: string,
    fingerprint: string,
    record: InventoryRecord,
  ): Promise<Step | "commit"> {
    if (record.conversationId !== id) {
      return this.uncertain(id, "invalid-output");
    }
    if (record.activity !== "idle") {
      this.ctx.setItem(id, { outcome: "skipped", reason: "active-or-unknown" });
      return "continue";
    }
    const now = await fingerprintOf(
      this.ctx.deps.subtle,
      record,
      this.ctx.del.descriptor.fingerprintFields,
    );
    if (now !== fingerprint) {
      this.ctx.setItem(id, { outcome: "skipped", reason: "state-changed" });
      return "continue";
    }
    return "commit";
  }

  private async commit(id: string): Promise<Step> {
    const { deps, del, pacer } = this.ctx;
    const t = this.ticket("commit", id, null);
    const prep = await call(deps.clock, t.execId, (s) => del.prepareCommit(t, s), parsePrepared);
    if (!prep.ok) {
      return this.failedCall(id, prep.failure);
    }
    if (prep.value.documentKey !== this.ctx.plan.documentKey) {
      return this.uncertain(id, "document-changed");
    }
    await pacer.wait();
    if (
      !(await updateLedger(this.ctx.deps.ledger, this.ctx.deps.provider, (l) =>
        withOneMorePending(l, deps.clock.now(), deps.newId),
      ))
    ) {
      this.ctx.setItem(id, { outcome: "failed", reason: "ledger-write-failed" });
      return "failed";
    }
    const section = await dispatchInSection(this.ctx, id, prep.value);
    if (section.kind === "dispatched") {
      this.ctx.setItem(id, { dispatched: true });
      return this.afterDispatch(id, t, section.response);
    }
    if (section.kind === "dispatch-failed") {
      this.ctx.setItem(id, { dispatched: true });
      return this.uncertain(id, "adapter-error");
    }
    // Not dispatched: take the write-ahead back.
    const released = await updateLedger(
      this.ctx.deps.ledger,
      this.ctx.deps.provider,
      withOneLessPending,
    );
    const step = this.notDispatched(id, section.kind);
    return released || step === "disposed" ? step : this.ledgerFailure(id);
  }

  private notDispatched(
    id: string,
    kind: Exclude<Section["kind"], "dispatched" | "dispatch-failed">,
  ): Step {
    if (kind === "keep-protected") {
      this.ctx.setItem(id, { outcome: "skipped", reason: "keep-protected" });
      return "continue";
    }
    if (kind === "keep-unavailable") {
      this.ctx.setItem(id, { outcome: "failed", reason: "keep-unavailable" });
      return "failed";
    }
    return this.stopFor(kind, id);
  }

  private ledgerFailure(id: string): "failed" {
    const current = this.ctx.item(id);
    if (current.outcome === "pending") {
      this.ctx.setItem(id, { outcome: "failed", reason: "ledger-write-failed" });
    }
    return "failed";
  }

  private async afterDispatch(
    id: string,
    t: ItemTicket,
    response: PromiseLike<unknown>,
  ): Promise<Step> {
    const { deps } = this.ctx;
    const res = await settle(deps.clock, response, t.execId, (v) =>
      parseCommitValue(v, deps.provider),
    );
    if (this.ctx.liveness() === "disposed") {
      return "disposed";
    }
    if (!res.ok) {
      return this.failedCall(id, res.failure);
    }
    if (res.value.conversationId !== id) {
      return this.uncertain(id, "invalid-output");
    }
    this.ctx.setItem(id, { writeAccepted: true });
    return this.verify(id);
  }

  /** Runs every probe of the rule; verified only with an accepted write and all bound probes. */
  async verify(id: string): Promise<Step> {
    const { deps, del, pacer } = this.ctx;
    if (!this.ctx.item(id).writeAccepted) {
      return "uncertain";
    }
    for (const probe of del.descriptor.verificationRule) {
      if (this.ctx.liveness() === "disposed") {
        return "disposed";
      }
      const t = this.ticket("reconcile", id, probe);
      await pacer.beforeRequest();
      const res = await call(
        deps.clock,
        t.execId,
        (s) => del.reconcileOne(t, s),
        (v) => parseReconcile(v, deps.provider),
      );
      if (!res.ok) {
        return this.failedCall(id, res.failure);
      }
      const v = res.value;
      if (!this.boundSubject(v.subject)) {
        return this.uncertain(id, "subject-changed");
      }
      if (
        v.probe !== probe ||
        v.conversationId !== id ||
        v.documentKey !== this.ctx.plan.documentKey
      ) {
        return this.uncertain(id, "invalid-output");
      }
      if (!v.satisfied) {
        return this.uncertain(id, "reconcile-unsatisfied");
      }
    }
    this.ctx.setItem(id, { outcome: "verified", reason: null });
    return (await updateLedger(this.ctx.deps.ledger, this.ctx.deps.provider, withOneLessPending))
      ? "continue"
      : "failed";
  }
}
