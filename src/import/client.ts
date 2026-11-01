// Management-page side of the Import Worker (P-0005 item 7). Cancellation and
// the hard time limit terminate the Worker, because JSON.parse inside it
// cannot be interrupted cooperatively.
import { terminalResult } from "./results";
import type { ImportLimits, ImportResult } from "./types";

export interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface TimerApi {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface ImportHandle {
  /** Always resolves; failures are results with status "failed". */
  readonly result: Promise<ImportResult>;
  cancel(): void;
}

export interface StartMessage {
  readonly kind: "start";
  readonly file: Blob;
  readonly limits: ImportLimits;
}

/** Slack over maxMillis before the Worker is killed; the parser checks maxMillis itself. */
const HARD_LIMIT_GRACE_MS = 5_000;
const STATUSES: ReadonlySet<unknown> = new Set(["complete", "partial", "failed", "cancelled"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The Worker runs bundled code, but its reply is still checked before use:
 * an exact envelope, a known status, and no records on a failed or cancelled
 * result (AT10).
 */
export function parseWorkerReply(data: unknown): ImportResult | null {
  if (!isObject(data) || Object.keys(data).sort().join() !== "kind,result") {
    return null;
  }
  const { kind, result } = data;
  if (kind !== "result" || !isObject(result) || !STATUSES.has(result["status"])) {
    return null;
  }
  const { records, issues, coverage, report, status } = result;
  if (
    !Array.isArray(records) ||
    !Array.isArray(issues) ||
    !isObject(coverage) ||
    !isObject(report)
  ) {
    return null;
  }
  if ((status === "failed" || status === "cancelled") && records.length > 0) {
    return null;
  }
  return result as unknown as ImportResult;
}

export function startImport(
  file: Blob,
  limits: ImportLimits,
  createWorker: () => WorkerLike,
  timers: TimerApi,
): ImportHandle {
  const worker = createWorker();
  let settle: (result: ImportResult) => void = () => undefined;
  const result = new Promise<ImportResult>((resolve) => {
    settle = resolve;
  });
  let done = false;
  const finish = (value: ImportResult) => {
    if (done) {
      return;
    }
    done = true;
    timers.clear(timer);
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    settle(value);
  };
  const timer = timers.set(
    () => finish(terminalResult("limit-time")),
    limits.maxMillis + HARD_LIMIT_GRACE_MS,
  );
  worker.onmessage = (event) =>
    finish(parseWorkerReply(event.data) ?? terminalResult("worker-error"));
  worker.onerror = () => finish(terminalResult("worker-error"));
  const message: StartMessage = { kind: "start", file, limits };
  worker.postMessage(message);
  return { result, cancel: () => finish(terminalResult("cancelled")) };
}
