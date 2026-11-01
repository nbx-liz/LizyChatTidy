// The KEEP store state machine (P-0007 items 5 to 8). One instance per
// management page. Every asynchronous operation records the generation it
// started in and neither writes nor publishes once the generation changed
// (lock, reload, delete, a foreign change or a conflict all advance it).
// This class is a thin facade: the shared state lives in one KeepCore and the
// operation bodies in keepOps.ts and keepOrdered.ts.
import { KeepCore } from "./keepCore";
import * as ops from "./keepOps";
import * as ordered from "./keepOrdered";
import type { KeepEntry } from "./keepRules";
import type { KeepBinding, KeepDeps, KeepState, OpResult, OrderedKeepView } from "./keepTypes";

export type {
  KeepBinding,
  KeepDeps,
  KeepState,
  OpResult,
  OrderedKeepView,
  UnavailableReason,
} from "./keepTypes";

export class KeepStore {
  private readonly core: KeepCore;

  constructor(deps: KeepDeps) {
    this.core = new KeepCore(deps);
  }

  get current(): KeepState {
    return this.core.state;
  }

  /** True once storage access is restricted to extension contexts (KINV-8). */
  get accessRestricted(): boolean {
    return this.core.restricted;
  }

  subscribe(listener: (state: KeepState) => void): () => void {
    this.core.listeners.add(listener);
    return () => this.core.listeners.delete(listener);
  }

  /** The token of the envelope seen last; a delete must name it (P-0007 item 7). */
  observedToken(): string | null {
    return this.core.observed?.token ?? null;
  }

  async init(): Promise<void> {
    const core = this.core;
    const setAccessLevel = core.deps.storage.setAccessLevel;
    if (setAccessLevel === undefined) {
      core.fail("access-level");
      return;
    }
    try {
      await setAccessLevel.call(core.deps.storage, { accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      core.fail("access-level"); // Fail closed: no read, no write, no injection (KINV-8).
      return;
    }
    core.restricted = true;
    core.unsubscribe = core.deps.onStoredChange((value) => core.onStoredChange(value));
    await ops.load(core);
  }

  dispose(): void {
    this.core.unsubscribe?.();
    this.core.unsubscribe = null;
    this.core.advance();
  }

  async reload(): Promise<OpResult> {
    const core = this.core;
    if (!core.restricted || core.state.status === "loading") {
      return "not-allowed";
    }
    await core.queue.catch(() => undefined);
    await ops.load(core);
    return "ok";
  }

  adopt(): Promise<OpResult> {
    return ops.adopt(this.core);
  }

  create(passphrase: string, consent: boolean): Promise<OpResult> {
    return ops.create(this.core, passphrase, consent);
  }

  unlock(passphrase: string): Promise<OpResult> {
    return ops.unlock(this.core, passphrase);
  }

  lock(): Promise<OpResult> {
    return ops.lock(this.core);
  }

  setKeep(entry: KeepEntry, keep: boolean): Promise<OpResult> {
    return ops.setKeep(this.core, entry, keep);
  }

  binding(): KeepBinding | null {
    return ordered.binding(this.core);
  }

  withOrderedSnapshot<T>(fn: (view: OrderedKeepView) => T): Promise<T> {
    return ordered.withOrderedSnapshot(this.core, fn);
  }

  deleteStore(confirmedToken: string | null): Promise<OpResult> {
    return ops.deleteStore(this.core, confirmedToken);
  }
}
