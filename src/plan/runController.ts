// The run controller: the public face of inventory, plan, one-time approval,
// sequential run, stop, continuation and recovery (P-0009 items 2 to 9). One
// instance per management page and service. Plans, approvals and results live
// only in memory; only the ID-free run ledger is persisted (P-0009 item 3).
import type { ImportResult } from "../import/types";
import * as execution from "./execution";
import type { InventorySnapshot } from "./inventory";
import type { DeletePlan } from "./plan";
import * as planning from "./planning";
import { recoveryStatusOf } from "./recovery";
import { no, OK, RunState } from "./runState";
import type { Approval, ItemResult, OpOutcome, Phase, RecoveryStatus, RunDeps } from "./types";

const DISCARD_FROM: ReadonlySet<Phase> = new Set([
  "draft",
  "ready",
  "approved",
  "completed",
  "paused",
  "failed",
  "uncertain",
]);

export class RunController {
  private readonly s: RunState;

  constructor(deps: RunDeps) {
    this.s = new RunState(deps);
  }

  get phase(): Phase {
    return this.s.phase;
  }
  /** A frozen copy: the snapshot plans are built from never leaves the controller. */
  get snapshot(): InventorySnapshot | null {
    const snap = this.s.snap;
    if (snap === null) {
      return null;
    }
    return Object.freeze({
      ...snap,
      adapter: Object.freeze({ ...snap.adapter }),
      subject: Object.freeze({ ...snap.subject }),
      records: new Map(snap.records),
      duplicateIds: new Set(snap.duplicateIds),
      issues: new Set(snap.issues),
    });
  }
  get plan(): DeletePlan | null {
    return this.s.plan;
  }
  get approval(): Approval | null {
    return this.s.approvals.current;
  }
  /** Display only: the earliest time a person may resume by hand (INV-19). */
  get retryAfterSeconds(): number | null {
    return this.s.retryAfter;
  }
  items(): readonly ItemResult[] {
    return this.s.items();
  }
  readEnabled(): boolean {
    return this.s.readEnabled();
  }
  deleteEnabled(): boolean {
    return this.s.deleteEnabled();
  }

  collect(): Promise<OpOutcome> {
    return planning.collect(this.s);
  }

  cancelCollect(): void {
    this.s.cancelRequested = true;
  }

  loadExport(result: ImportResult, importVersion: number, importerVersion: string): OpOutcome {
    return planning.loadExport(this.s, result, importVersion, importerVersion);
  }

  async makePlan(ids: readonly string[]): Promise<OpOutcome> {
    const s = this.s;
    if (s.disposed || s.phase !== "draft" || s.snap === null) {
      return no("not-allowed");
    }
    return planning.planFrom(s, s.snap, ids, null);
  }

  discardPlan(): OpOutcome {
    if (this.s.phase !== "ready" && this.s.phase !== "approved") {
      return no("not-allowed");
    }
    this.s.clearPlan();
    this.s.phase = "draft";
    return OK;
  }

  approve(planId: string, planDigest: string): Promise<OpOutcome> {
    return planning.approve(this.s, planId, planDigest);
  }

  revokeApproval(): OpOutcome {
    if (this.s.phase !== "approved") {
      return no("not-allowed");
    }
    this.s.approvals.clear();
    this.s.phase = "ready";
    return OK;
  }

  start(approvalId: string): Promise<OpOutcome> {
    return execution.start(this.s, approvalId);
  }

  /** No further dispatch; a write already sent is awaited and reconciled (AT23). */
  stop(): void {
    const s = this.s;
    s.stopRequested = true;
    // An approval a stop hit is gone, also while start() is still awaiting (review 1 #3).
    if (s.phase === "approved") {
      s.approvals.clear();
      s.phase = "ready";
    }
  }

  reconcileUncertain(): Promise<OpOutcome> {
    return execution.reconcileUncertain(this.s);
  }

  continuation(): Promise<OpOutcome> {
    return execution.continuation(this.s);
  }

  recoveryStatus(): Promise<RecoveryStatus> {
    return recoveryStatusOf(this.s.deps);
  }

  acknowledgeRecovery(seenToken: string): Promise<OpOutcome> {
    return planning.acknowledgeRecovery(this.s, seenToken);
  }

  discard(): OpOutcome {
    if (!DISCARD_FROM.has(this.s.phase)) {
      return no("not-allowed");
    }
    this.s.clearPlan();
    this.s.snap = null;
    this.s.results.clear();
    this.s.phase = "idle";
    return OK;
  }

  /** The page is going away: nothing more is sent and the approval is gone (INV-08). */
  dispose(): void {
    const s = this.s;
    s.disposed = true;
    s.stopRequested = true;
    s.cancelRequested = true;
    s.approvals.clear();
    s.session.release();
  }
}
