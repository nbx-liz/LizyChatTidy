// The ordered KEEP section (P-0009 item 8): the final KEEP read and the
// synchronous dispatch happen inside one KeepStore queue slot and KEEP Web
// Lock, so no KEEP write of any tab lands between them.
import type {
  DeleteAdapter,
  DeleteDescriptor,
  PreparedCommit,
  ReadDescriptor,
} from "../adapters/contracts";
import { parseDispatched } from "../adapters/validate";
import { isProtected } from "../keep/keepRules";
import type { Pacer } from "./calls";
import type { LedgerClaim } from "./ledger";
import type { DeletePlan } from "./plan";
import type { ItemResult, Liveness, RunDeps } from "./types";

/** Whether a Delete call may be made right now (review 1 #4, #7). */
export type Callable = "ok" | "disposed" | "delete-unavailable";

/** What the item runner needs from its controller. */
export interface RunContext {
  readonly deps: RunDeps;
  readonly del: DeleteAdapter;
  /** Validated frozen copies; the adapter's live objects are never read (review 1 #6). */
  readonly readDescriptor: ReadDescriptor;
  readonly delDescriptor: DeleteDescriptor;
  readonly plan: DeletePlan;
  readonly keepGeneration: number;
  readonly pacer: Pacer;
  liveness(): Liveness;
  /** Checked after every wait and right before every Delete call. */
  callable(): Callable;
  invalidateApproval(): void;
  item(id: string): ItemResult;
  setItem(id: string, patch: Partial<ItemResult>): void;
  setClaim(id: string, claim: LedgerClaim): void;
  claimOf(id: string): LedgerClaim | undefined;
  /** A ledger read-modify-write inside the service-lock tenure (review 2 #1). */
  ledgerTx<T>(fn: (open: () => boolean) => Promise<T>): Promise<T | "not-held">;
  noteRetryAfter(seconds: number | null): void;
}

export type Section =
  | { readonly kind: "dispatched"; readonly response: PromiseLike<unknown> }
  | {
      readonly kind:
        | "dispatch-failed"
        | "keep-unavailable"
        | "keep-protected"
        | "delete-unavailable";
    }
  | { readonly kind: Exclude<Liveness, "live"> };

export async function dispatchInSection(
  ctx: RunContext,
  id: string,
  prepared: PreparedCommit,
): Promise<Section> {
  const { deps, plan, keepGeneration, pacer } = ctx;
  try {
    return await deps.keep.withOrderedSnapshot((view): Section => {
      if (
        view.status !== "available" ||
        view.storeId !== plan.keep.storeId ||
        view.generation !== keepGeneration
      ) {
        return { kind: "keep-unavailable" };
      }
      const query = { provider: plan.provider, conversationId: id, scope: plan.subject };
      if (isProtected(view.entries, query)) {
        return { kind: "keep-protected" };
      }
      // Stop, expiry, invalidation, page close, the lock and the gate are checked at the boundary itself.
      const l = ctx.liveness();
      if (l !== "live") {
        return { kind: l };
      }
      const c = ctx.callable();
      if (c !== "ok") {
        return { kind: c === "disposed" ? "disposed" : "delete-unavailable" };
      }
      pacer.mark();
      let out: unknown;
      try {
        out = prepared.dispatch();
      } catch {
        return { kind: "dispatch-failed" };
      }
      const d = parseDispatched(out);
      return d === null
        ? { kind: "dispatch-failed" }
        : { kind: "dispatched", response: d.response };
    });
  } catch {
    // Whether fn ran is unknown here, so the write may have been sent.
    return { kind: "dispatch-failed" };
  }
}
