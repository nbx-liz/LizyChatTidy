// Ownership of the service lock for one controller (P-0009 item 2): one
// controller in the profile sends requests to a service at a time, and the
// first request after taking the lock waits a full interval.
import type { Provider } from "../adapters/contracts";
import type { Pacer } from "./calls";
import { type HeldLock, type ServiceLockManager, tryAcquire } from "./environment";
import { serviceLockName } from "./types";

export type AcquireRefusal = "locks-unavailable" | "service-busy";

export class ServiceSession {
  private held: HeldLock | null = null;
  private releasing: Promise<void> = Promise.resolve();

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
    if (this.held !== null) {
      return "service-busy";
    }
    await this.releasing;
    const held = await tryAcquire(this.locks, serviceLockName(this.provider));
    if (held === null) {
      return "service-busy";
    }
    if (closed()) {
      void held.release();
      return "service-busy";
    }
    this.held = held;
    this.pacer.reset();
    return null;
  }

  release(): void {
    if (this.held !== null) {
      this.releasing = this.held.release();
      this.held = null;
    }
  }
}
