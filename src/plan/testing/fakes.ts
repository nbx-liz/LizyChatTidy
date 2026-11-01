// Test-only time and lock fakes for the run controller.
import type { Clock, ServiceLockManager } from "../environment";

/**
 * sleep() advances time at once; deadlines fire only when the test calls
 * expireDeadlines(), so a hanging adapter call times out on demand.
 */
export class FakeClock implements Clock {
  t = Date.UTC(2026, 10, 1, 9, 0, 0);
  readonly sleeps: number[] = [];
  private readonly deadlines = new Set<() => void>();

  now(): number {
    return this.t;
  }

  /** When set, the next sleep() waits for it (one shot). */
  private hold: Promise<void> | null = null;

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    const hold = this.hold;
    this.hold = null;
    if (hold !== null) {
      await hold;
    }
    this.t += ms;
  }

  /** Makes the next sleep() wait until the returned function is called. */
  holdNextSleep(): () => void {
    let release: () => void = () => undefined;
    this.hold = new Promise<void>((r) => {
      release = r;
    });
    return release;
  }

  deadline(_ms: number): { readonly expired: Promise<void>; cancel(): void } {
    let fire: () => void = () => undefined;
    const expired = new Promise<void>((r) => {
      fire = r;
    });
    this.deadlines.add(fire);
    return { expired, cancel: () => this.deadlines.delete(fire) };
  }

  pendingDeadlines(): number {
    return this.deadlines.size;
  }

  expireDeadlines(): void {
    for (const fire of [...this.deadlines]) {
      this.deadlines.delete(fire);
      fire();
    }
  }

  advance(ms: number): void {
    this.t += ms;
  }
}

/** Web Locks with ifAvailable only, shared between controllers like one browser profile. */
export class FakeServiceLocks implements ServiceLockManager {
  readonly held = new Set<string>();
  maxHeld = 0;

  async request<T>(
    name: string,
    _options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T> {
    if (this.held.has(name)) {
      return callback(null);
    }
    this.held.add(name);
    this.maxHeld = Math.max(this.maxHeld, this.held.size);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}
