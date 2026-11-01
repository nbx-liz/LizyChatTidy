// Ownership of the service lock for one controller (P-0009 item 2): one
// controller in the profile sends requests to a service at a time, and the
// first request after taking the lock waits a full interval. Ledger
// read-modify-writes run as transactions of the lock tenure: release()
// fences them, so a transaction still reading never writes, and keeps the
// lock only for a write already started, so no write lands under another
// controller's tenure and a stalled read never pins the lock (review 2 #1,
// review 3).
import type { Provider } from "../adapters/contracts";
import type { Pacer } from "./calls";
import { type HeldLock, type ServiceLockManager, tryAcquire } from "./environment";
import { serviceLockName } from "./types";

export type AcquireRefusal = "locks-unavailable" | "service-busy";

/** Called synchronously right before a write: true when the write may start (and is then tracked). */
export type Fence = () => boolean;

export class ServiceSession {
  private held: HeldLock | null = null;
  private closing = false;
  private releasing: Promise<void> = Promise.resolve();
  /** Transactions past their fence check, i.e. inside their write. */
  private readonly writing = new Set<Promise<void>>();

  constructor(
    private readonly locks: ServiceLockManager | null,
    private readonly provider: Provider,
    private readonly pacer: Pacer,
  ) {}

  /** Takes the lock if free; `closed` is re-checked after the wait. */
  async acquire(closed: () => boolean): Promise<AcquireRefusal | null> {
    if (this.locks === null) {
      return "locks-unavailable";
    }
    if (this.held !== null && !this.closing) {
      return "service-busy";
    }
    await this.releasing;
    if (this.held !== null) {
      return "service-busy";
    }
    const held = await tryAcquire(this.locks, serviceLockName(this.provider));
    if (held === null) {
      return "service-busy";
    }
    if (closed() || this.held !== null) {
      void held.release();
      return "service-busy";
    }
    this.held = held;
    this.closing = false;
    this.pacer.reset();
    return null;
  }

  /** True while this controller holds the service lock and is not releasing it. */
  holds(): boolean {
    return this.held !== null && !this.closing;
  }

  /**
   * Runs a ledger read-modify-write inside this tenure. `fn` receives the
   * fence and must call it synchronously right before it starts its write
   * (no await between the call and storage.set). A true answer moves the
   * transaction into its write phase. Refused when the lock is not held.
   */
  async transaction<T>(fn: (beginWrite: Fence) => Promise<T>): Promise<T | "not-held"> {
    if (!this.holds()) {
      return "not-held";
    }
    let settle: () => void = () => undefined;
    const done = new Promise<void>((r) => {
      settle = r;
    });
    const beginWrite = (): boolean => {
      if (!this.holds()) {
        return false;
      }
      this.writing.add(done);
      return true;
    };
    try {
      return await fn(beginWrite);
    } finally {
      this.writing.delete(done);
      settle();
    }
  }

  /**
   * Closes the fence and lets the lock go (review 3). A transaction still in
   * its read phase is not waited for: once fenced it can no longer write. A
   * transaction already writing is awaited, because its write landing after
   * the release could overwrite another controller's newer ledger; if that
   * write never settles the lock stays held (fail closed; closing the page
   * releases Web Locks).
   */
  release(): void {
    const held = this.held;
    if (held === null || this.closing) {
      return;
    }
    this.closing = true;
    const writes = [...this.writing];
    this.releasing = Promise.allSettled(writes)
      .then(() => held.release())
      .finally(() => {
        if (this.held === held) {
          this.held = null;
          this.closing = false;
        }
      });
  }
}
