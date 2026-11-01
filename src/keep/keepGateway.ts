// Storage and lock access for the KEEP store (P-0007 items 1, 2 and 7). The
// browser APIs are injected so the state machine can be tested in Node.
import {
  type Envelope,
  type EnvelopeProblem,
  envelopeToken,
  parseEnvelope,
  STORAGE_KEY,
} from "./envelope";

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel?: ((options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void>) | undefined;
}

export interface LockManagerLike {
  request<T>(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface TimerApi {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export const LOCK_NAME = "lizychattidy-keep";

export type Observed =
  | { readonly kind: "absent"; readonly token: null }
  | { readonly kind: "envelope"; readonly envelope: Envelope; readonly token: string }
  | { readonly kind: "malformed"; readonly problem: EnvelopeProblem; readonly token: string };

/** Reads the stored envelope. Throws when the storage call fails (the caller maps it to read-failed). */
export async function readStored(storage: StorageAreaLike): Promise<Observed> {
  const items = await storage.get(STORAGE_KEY);
  if (!Object.hasOwn(items, STORAGE_KEY) || items[STORAGE_KEY] === undefined) {
    return { kind: "absent", token: null };
  }
  const raw = items[STORAGE_KEY];
  const parsed = parseEnvelope(raw);
  if (parsed.ok) {
    return { kind: "envelope", envelope: parsed.envelope, token: envelopeToken(parsed.envelope) };
  }
  let text: string;
  try {
    text = JSON.stringify(raw) ?? String(raw);
  } catch {
    text = "(unserializable)"; // Still a token: deletion compares it, never skips the check.
  }
  return { kind: "malformed", problem: parsed.problem, token: `raw:${text}` };
}

export type LockOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "lock-timeout" };

/**
 * Runs `fn` while holding the Web Lock. The timeout applies only to waiting
 * for the lock: once granted, the timer is cleared and the lock is held
 * until `fn` (and every storage call it awaits) settles (P-0007 item 7).
 */
export async function withLock<T>(
  locks: LockManagerLike,
  timers: TimerApi,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const controller = new AbortController();
  const timer = timers.set(() => controller.abort(), timeoutMs);
  let granted = false;
  try {
    const value = await locks.request(LOCK_NAME, { signal: controller.signal }, async () => {
      granted = true;
      timers.clear(timer);
      return fn();
    });
    return { ok: true, value };
  } catch (error) {
    if (!granted && controller.signal.aborted) {
      return { ok: false, reason: "lock-timeout" };
    }
    throw error;
  } finally {
    timers.clear(timer);
  }
}
