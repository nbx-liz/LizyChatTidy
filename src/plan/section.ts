// The ordered KEEP section (P-0009 item 8): the final KEEP read and the
// synchronous dispatch happen inside one KeepStore queue slot and KEEP Web
// Lock, so no KEEP write of any tab lands between them.
import type { DeleteAdapter, PreparedCommit } from "../adapters/contracts";
import { parseDispatched } from "../adapters/validate";
import { isProtected } from "../keep/keepRules";
import type { Pacer } from "./calls";
import type { DeletePlan } from "./plan";
import type { ItemResult, Liveness, RunDeps } from "./types";

/** What the item runner needs from its controller. */
export interface RunContext {
  readonly deps: RunDeps;
  readonly del: DeleteAdapter;
  readonly plan: DeletePlan;
  readonly keepGeneration: number;
  readonly pacer: Pacer;
  liveness(): Liveness;
  invalidateApproval(): void;
  item(id: string): ItemResult;
  setItem(id: string, patch: Partial<ItemResult>): void;
  noteRetryAfter(seconds: number | null): void;
}

export type Section =
  | { readonly kind: "dispatched"; readonly response: PromiseLike<unknown> }
  | { readonly kind: "dispatch-failed" | "keep-unavailable" | "keep-protected" }
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
      // Stop, expiry, invalidation and page close are checked at the boundary itself.
      const l = ctx.liveness();
      if (l !== "live") {
        return { kind: l };
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
