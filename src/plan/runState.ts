// The mutable state of one run controller and the helpers every stage uses
// (P-0009 items 5 to 9). Stages live in planning.ts and execution.ts.
import type { DeleteAdapter } from "../adapters/contracts";
import { MIN_INTERVAL_FLOOR_MS } from "../adapters/descriptor";
import { AdapterBinding } from "./adapterBinding";
import { ApprovalBook } from "./approval";
import { Pacer } from "./calls";
import type { InventorySnapshot } from "./inventory";
import type { LedgerClaim } from "./ledger";
import type { DeletePlan } from "./plan";
import type { Callable, RunContext } from "./section";
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
  /** The ledger barrier each dispatched item was counted in (review 1 #1). */
  readonly claims = new Map<string, LedgerClaim>();
  stopRequested = false;
  cancelRequested = false;
  disposed = false;
  retryAfter: number | null = null;
  readonly pacer: Pacer;
  readonly session: ServiceSession;
  readonly adapters: AdapterBinding;

  constructor(readonly deps: RunDeps) {
    this.adapters = new AdapterBinding(deps.read, deps.del, deps.build);
    const interval = this.adapters.read?.minIntervalMs ?? MIN_INTERVAL_FLOOR_MS;
    this.pacer = new Pacer(deps.clock, Math.max(interval, MIN_INTERVAL_FLOOR_MS));
    this.session = new ServiceSession(deps.locks, deps.provider, this.pacer);
  }

  items(): ItemResult[] {
    return [...this.results.values()];
  }

  readEnabled(): boolean {
    return this.adapters.readEnabled();
  }

  deleteEnabled(): boolean {
    return this.adapters.deleteEnabled();
  }

  /** May this controller send a read now: not closed, lock held, read still enabled. */
  mayRead(): boolean {
    return !this.disposed && this.session.holds() && this.readEnabled();
  }

  callable(): Callable {
    if (this.disposed || !this.session.holds()) {
      return "disposed";
    }
    return this.deleteEnabled() ? "ok" : "delete-unavailable";
  }

  /** KEEP binding, adapter identity and delete capability for `plan`; null when all hold. */
  preconditions(plan: DeletePlan): string | null {
    const keep = this.deps.keep.binding();
    if (
      keep === null ||
      keep.storeId !== plan.keep.storeId ||
      keep.generation !== this.keepGeneration
    ) {
      return "keep-changed";
    }
    if (!this.deleteEnabled()) {
      return "delete-unavailable";
    }
    return this.adapters.sameIdentity(plan.adapter) ? null : "adapter-changed";
  }

  setItem(id: string, patch: Partial<ItemResult>): void {
    const current = this.results.get(id);
    if (current !== undefined) {
      this.results.set(id, Object.freeze({ ...current, ...patch }));
    }
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

  context(del: DeleteAdapter, plan: DeletePlan): RunContext | null {
    const readDescriptor = this.adapters.read;
    const delDescriptor = this.adapters.del;
    if (readDescriptor === null || delDescriptor === null) {
      return null;
    }
    return {
      deps: this.deps,
      del,
      readDescriptor,
      delDescriptor,
      plan,
      keepGeneration: this.keepGeneration,
      pacer: this.pacer,
      liveness: () =>
        this.approvals.liveness(this.deps.clock.now(), this.disposed, this.stopRequested),
      callable: () => this.callable(),
      invalidateApproval: () => this.approvals.invalidate(),
      item: (id) => this.results.get(id) as ItemResult,
      setItem: (id, patch) => this.setItem(id, patch),
      setClaim: (id, claim) => {
        this.claims.set(id, claim);
      },
      claimOf: (id) => this.claims.get(id),
      noteRetryAfter: (s) => {
        this.retryAfter = s ?? this.retryAfter;
      },
    };
  }
}
