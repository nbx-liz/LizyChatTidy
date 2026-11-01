// Adapter call plumbing: request spacing, call deadlines, exception capture
// and outcome parsing (P-0009 items 1 and 2). Every failure becomes a typed
// CallFailure; nothing is skipped silently (DC1).
import type { AnomalyCode } from "../adapters/contracts";
import { type Parsed, parseOutcome } from "../adapters/validate";
import type { Clock } from "./environment";

/** Provisional per-call deadline (P-0009 item 1). */
export const CALL_DEADLINE_MS = 30_000;

export type FailureCode = AnomalyCode | "invalid-output" | "adapter-error";

export interface CallFailure {
  readonly code: FailureCode;
  readonly retryAfterSeconds: number | null;
}

export type CallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CallFailure };

const fail = (code: FailureCode, retryAfterSeconds: number | null = null) =>
  ({ ok: false, failure: { code, retryAfterSeconds } }) as const;

export function fromParsed<T>(parsed: Parsed<T>): CallResult<T> {
  if (parsed.kind === "ok") {
    return { ok: true, value: parsed.value };
  }
  if (parsed.kind === "invalid") {
    return fail("invalid-output");
  }
  const a = parsed.anomaly;
  return fail(a.code, a.code === "rate-limited" ? a.retryAfterSeconds : null);
}

/**
 * Awaits `pending` against the call deadline. A rejection is an adapter
 * error, a missed deadline a timeout; the late value is ignored.
 */
export async function settle<T>(
  clock: Clock,
  pending: PromiseLike<unknown>,
  execId: string,
  parseValue: (value: unknown) => T | null,
  abort?: AbortController,
): Promise<CallResult<T>> {
  const deadline = clock.deadline(CALL_DEADLINE_MS);
  type Race =
    | { readonly kind: "value"; readonly raw: unknown }
    | { readonly kind: "error" }
    | { readonly kind: "deadline" };
  const settled: Promise<Race> = Promise.resolve(pending).then(
    (raw) => ({ kind: "value", raw }),
    () => ({ kind: "error" }),
  );
  const race = await Promise.race([
    settled,
    deadline.expired.then((): Race => ({ kind: "deadline" })),
  ]);
  deadline.cancel();
  if (race.kind === "deadline") {
    abort?.abort();
    return fail("timeout");
  }
  if (race.kind === "error") {
    return fail("adapter-error");
  }
  return fromParsed(parseOutcome(race.raw, execId, parseValue));
}

/** Calls `invoke` and settles it; a synchronous throw is an adapter error. */
export async function call<T>(
  clock: Clock,
  execId: string,
  invoke: (signal: AbortSignal) => Promise<unknown>,
  parseValue: (value: unknown) => T | null,
): Promise<CallResult<T>> {
  const abort = new AbortController();
  let pending: Promise<unknown>;
  try {
    pending = invoke(abort.signal);
  } catch {
    return fail("adapter-error");
  }
  return settle(clock, pending, execId, parseValue, abort);
}

/**
 * Request spacing for the holder of the service lock (P-0009 item 2). The
 * first request after taking the lock waits a full interval too, because the
 * previous holder's last request time is unknown.
 */
export class Pacer {
  private last: number;

  constructor(
    private readonly clock: Clock,
    private readonly intervalMs: number,
  ) {
    this.last = clock.now();
  }

  /** Call right after the service lock is taken. */
  reset(): void {
    this.last = this.clock.now();
  }

  async wait(): Promise<void> {
    const due = this.last + this.intervalMs;
    const now = this.clock.now();
    if (now < due) {
      await this.clock.sleep(due - now);
    }
  }

  /** Records that a request starts now. */
  mark(): void {
    this.last = this.clock.now();
  }

  /** wait() then mark(), for calls whose request starts at the call. */
  async beforeRequest(): Promise<void> {
    await this.wait();
    this.mark();
  }
}
