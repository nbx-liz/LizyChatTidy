// Injected time, lock and storage surfaces for the run controller, so every
// interleaving can be driven deterministically in tests (P-0009 items 2, 3).
import type { StorageAreaLike } from "../keep/keepGateway";

export interface Clock {
  now(): number;
  /** Resolves after `ms`; used for request spacing. */
  sleep(ms: number): Promise<void>;
  /** A timer for a call deadline; cancel() when the call settles first. */
  deadline(ms: number): { readonly expired: Promise<void>; cancel(): void };
}

/** The subset of the Web Locks API used for the service lock. */
export interface ServiceLockManager {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

export type LedgerStorage = Pick<StorageAreaLike, "get" | "set">;

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  deadline: (ms) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    return { expired, cancel: () => clearTimeout(timer) };
  },
};

export interface HeldLock {
  /** Resolves once the lock manager has actually let the lock go. */
  release(): Promise<void>;
}

/**
 * Takes the lock only if it is free and holds it until release(). Returns
 * null when another context holds it.
 */
export async function tryAcquire(
  locks: ServiceLockManager,
  name: string,
): Promise<HeldLock | null> {
  let letGo: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    letGo = r;
  });
  return new Promise<HeldLock | null>((resolve, reject) => {
    let granted = false;
    const done: Promise<void> = locks
      .request(name, { ifAvailable: true }, async (lock) => {
        if (lock === null) {
          return;
        }
        granted = true;
        resolve({
          release: () => {
            letGo();
            // A rejection of the request is reported through reject() below.
            return done.catch(() => undefined);
          },
        });
        await held;
      })
      .then(() => {
        if (!granted) {
          resolve(null);
        }
      });
    done.catch(reject);
  });
}
