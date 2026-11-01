// The mutable state of one run controller and the helpers every stage uses
// (P-0009 items 5 to 9). Stages live in planning.ts and execution.ts.
import type { DeleteAdapter } from "../adapters/contracts";
import { validDeleteDescriptor, validReadDescriptor } from "../adapters/descriptor";
import { capabilityEnabled } from "../adapters/gate";
import { ApprovalBook } from "./approval";
import { Pacer } from "./calls";
import type { InventorySnapshot } from "./inventory";
import type { DeletePlan } from "./plan";
import type { RunContext } from "./section";
import { ServiceSession } from "./serviceSession";
import type { ItemResult, OpOutcome, Phase, RunDeps } from "./types";

export const OK: OpOutcome = { ok: true };
export const no = (reason: string): OpOutcome => ({ ok: false, reason });

export class RunState {
  phase: Phase = "idle";
  snap: InventorySnapshot | null = null;
  plan: DeletePlan | null = null;
  keepGeneration = -1;
  readonly approvals = new ApprovalBook();
  readonly results = new Map<string, ItemResult>();
  stopRequested = false;
  cancelRequested = false;
  disposed = false;
  retryAfter: number | null = null;
  readonly pacer: Pacer;
  readonly session: ServiceSession;

  constructor(readonly deps: RunDeps) {
    this.pacer = new Pacer(deps.clock, deps.read.descriptor.minIntervalMs);
    this.session = new ServiceSession(deps.locks, deps.provider, this.pacer);
  }

  items(): ItemResult[] {
    return [...this.results.values()];
  }

  readEnabled(): boolean {
    const r = this.deps.read;
    return validReadDescriptor(r.descriptor) && capabilityEnabled(r.gate, this.deps.build);
  }

  deleteEnabled(): boolean {
    const d = this.deps.del;
    return (
      d !== null &&
      this.readEnabled() &&
      validDeleteDescriptor(d.descriptor, this.deps.read.descriptor) &&
      capabilityEnabled(d.gate, this.deps.build)
    );
  }

  /** KEEP binding and delete capability for `plan`; null when both hold. */
  preconditions(plan: DeletePlan): string | null {
    const keep = this.deps.keep.binding();
    if (
      keep === null ||
      keep.storeId !== plan.keep.storeId ||
      keep.generation !== this.keepGeneration
    ) {
      return "keep-changed";
    }
    return this.deleteEnabled() ? null : "delete-unavailable";
  }

  clearPlan(): void {
    this.plan = null;
    this.approvals.clear();
  }

  backToReady(reason: string): OpOutcome {
    this.approvals.clear();
    this.phase = "ready";
    return no(reason);
  }

  acquire(): ReturnType<ServiceSession["acquire"]> {
    return this.session.acquire(() => this.disposed);
  }

  context(del: DeleteAdapter, plan: DeletePlan): RunContext {
    return {
      deps: this.deps,
      del,
      plan,
      keepGeneration: this.keepGeneration,
      pacer: this.pacer,
      liveness: () =>
        this.approvals.liveness(this.deps.clock.now(), this.disposed, this.stopRequested),
      invalidateApproval: () => this.approvals.invalidate(),
      item: (id) => this.results.get(id) as ItemResult,
      setItem: (id, patch) => {
        const current = this.results.get(id);
        if (current !== undefined) {
          this.results.set(id, { ...current, ...patch });
        }
      },
      noteRetryAfter: (s) => {
        this.retryAfter = s ?? this.retryAfter;
      },
    };
  }
}
