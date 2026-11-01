// Test-only fakes for the KEEP store: a shared storage area with change
// notifications (like chrome.storage.local seen by several tabs) and a Web
// Locks manager that honours AbortSignal only while waiting.
import { webcrypto } from "node:crypto";
import type { LockManagerLike, StorageAreaLike, TimerApi } from "../keepGateway";
import type { KeepDeps } from "../keepStore";

export class FakeArea {
  readonly data = new Map<string, unknown>();
  readonly listeners = new Set<(key: string, newValue: unknown) => void>();
  notify = true;
  failGet = false;
  failSet = false;
  failRemove = false;
  /** When set, set() waits for this promise before writing. */
  setGate: Promise<void> | null = null;
  setCalls = 0;
  getCalls = 0;

  view(accessLevel: "ok" | "missing" | "reject" = "ok"): StorageAreaLike {
    const area: StorageAreaLike = {
      get: async (key) => {
        this.getCalls++;
        if (this.failGet) {
          throw new Error("get failed");
        }
        return this.data.has(key) ? { [key]: structuredClone(this.data.get(key)) } : {};
      },
      set: async (items) => {
        this.setCalls++;
        if (this.setGate !== null) {
          await this.setGate;
        }
        if (this.failSet) {
          throw new Error("quota");
        }
        for (const [k, v] of Object.entries(items)) {
          this.data.set(k, structuredClone(v));
          this.emit(k, v);
        }
      },
      remove: async (key) => {
        if (this.failRemove) {
          throw new Error("remove failed");
        }
        this.data.delete(key);
        this.emit(key, undefined);
      },
    };
    if (accessLevel === "ok") {
      area.setAccessLevel = async () => undefined;
    } else if (accessLevel === "reject") {
      area.setAccessLevel = async () => {
        throw new Error("not supported");
      };
    }
    return area;
  }

  private emit(key: string, value: unknown): void {
    if (!this.notify) {
      return;
    }
    const copy = value === undefined ? undefined : structuredClone(value);
    queueMicrotask(() => {
      for (const l of this.listeners) {
        l(key, copy);
      }
    });
  }

  subscribe(key: string) {
    return (listener: (newValue: unknown) => void) => {
      const wrapped = (k: string, v: unknown) => {
        if (k === key) {
          listener(v);
        }
      };
      this.listeners.add(wrapped);
      return () => {
        this.listeners.delete(wrapped);
      };
    };
  }
}

/** One lock name; FIFO; a waiting request rejects with AbortError when its signal aborts. */
export class FakeLocks implements LockManagerLike {
  private tail: Promise<void> = Promise.resolve();
  held = 0;
  maxHeld = 0;

  request<T>(
    _name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T> {
    let release: () => void = () => undefined;
    const previous = this.tail;
    this.tail = new Promise<void>((r) => {
      release = r;
    });
    return new Promise<T>((resolve, reject) => {
      let granted = false;
      const onAbort = () => {
        if (!granted) {
          reject(new DOMException("aborted", "AbortError"));
        }
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      previous.then(async () => {
        if (options.signal.aborted) {
          release();
          return;
        }
        granted = true;
        this.held++;
        this.maxHeld = Math.max(this.maxHeld, this.held);
        try {
          resolve(await callback());
        } catch (error) {
          reject(error);
        } finally {
          this.held--;
          release();
        }
      });
    });
  }
}

export const realTimers: TimerApi = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
};

let seed = 1;
/** Deterministic but distinct bytes per call. */
export function counterRandom(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    out[i] = (seed * 31 + i * 7) & 0xff;
  }
  seed++;
  return out;
}

export function deps(
  area: FakeArea,
  extra: Partial<KeepDeps> = {},
  locks = new FakeLocks(),
): KeepDeps {
  return {
    storage: area.view(),
    locks,
    subtle: webcrypto.subtle as unknown as SubtleCrypto,
    random: (n) => webcrypto.getRandomValues(new Uint8Array(n)),
    timers: realTimers,
    onStoredChange: area.subscribe("lizychattidy.keep"),
    iterations: 100_000,
    ...extra,
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}
