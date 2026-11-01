// Ownership of the service lock for one controller (P-0009 item 2): one
// controller in the profile sends requests to a service at a time, and the
// first request after taking the lock waits a full interval. Ledger
// read-modify-writes run as transactions of the lock tenure: release()
// fences them (their write is skipped) and keeps the lock until they have
// settled, so no write lands under another controller's tenure (review 2 #1).
import type { Provider } from "../adapters/contracts";
import type { Pacer } from "./calls";
import { type HeldLock, type ServiceLockManager, tryAcquire } from "./environment";
import { serviceLockName } from "./types";

export type AcquireRefusal = "locks-unavailable" | "service-busy";

/** True while the transaction may still write: the tenure is open and not closing. */
export type Fence = () => boolean;

export class ServiceSession {
  private held: HeldLock | null = null;
  private closing = false;
  private releasing: Promise<void> = Promise.resolve();
  private readonly transactions = new Set<Promise<unknown>>();

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
   * Runs a ledger read-modify-write inside this tenure. `fn` must check the
   * fence between its read and its write. Refused when the lock is not held.
   */
  async transaction<T>(fn: (open: Fence) => Promise<T>): Promise<T | "not-held"> {
    if (!this.holds()) {
      return "not-held";
    }
    const run = fn(() => this.holds());
    this.transactions.add(run);
    try {
      return await run;
    } finally {
      this.transactions.delete(run);
    }
  }

  /** Fences open transactions, waits for them, then lets the lock go. */
  release(): void {
    const held = this.held;
    if (held === null || this.closing) {
      return;
    }
    this.closing = true;
    const open = [...this.transactions];
    this.releasing = Promise.allSettled(open)
      .then(() => held.release())
      .finally(() => {
        if (this.held === held) {
          this.held = null;
          this.closing = false;
        }
      });
  }
}
