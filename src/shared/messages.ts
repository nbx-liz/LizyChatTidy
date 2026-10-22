// Messages between the extension Controller and the content script.
// TypeScript types are not a security boundary (BLUEPRINT §9): every message
// is validated at runtime with exact key sets before use.

export const PROTOCOL_VERSION = 1;

export interface PingRequest {
  readonly v: typeof PROTOCOL_VERSION;
  readonly kind: "ping";
  readonly execId: string;
  readonly expiresAt: number;
}

export interface PongResponse {
  readonly v: typeof PROTOCOL_VERSION;
  readonly kind: "pong";
  readonly execId: string;
  readonly origin: string;
}

export type ErrorCode = "bad-sender" | "bad-message" | "expired" | "replayed" | "wrong-origin";

export interface ErrorResponse {
  readonly v: typeof PROTOCOL_VERSION;
  readonly kind: "error";
  readonly execId: string | null;
  readonly code: ErrorCode;
}

export type ContentResponse = PongResponse | ErrorResponse;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "bad-sender",
  "bad-message",
  "expired",
  "replayed",
  "wrong-origin",
]);

const EXEC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isExecId(value: unknown): value is string {
  return typeof value === "string" && EXEC_ID_PATTERN.test(value);
}

export function parsePingRequest(value: unknown): PingRequest | null {
  if (!hasExactKeys(value, ["v", "kind", "execId", "expiresAt"])) {
    return null;
  }
  const { v, kind, execId, expiresAt } = value;
  if (v !== PROTOCOL_VERSION || kind !== "ping" || !isExecId(execId)) {
    return null;
  }
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) {
    return null;
  }
  return { v, kind, execId, expiresAt };
}

export function parseContentResponse(value: unknown): ContentResponse | null {
  if (hasExactKeys(value, ["v", "kind", "execId", "origin"])) {
    const { v, kind, execId, origin } = value;
    if (
      v === PROTOCOL_VERSION &&
      kind === "pong" &&
      isExecId(execId) &&
      typeof origin === "string"
    ) {
      return { v, kind, execId, origin };
    }
    return null;
  }
  if (hasExactKeys(value, ["v", "kind", "execId", "code"])) {
    const { v, kind, execId, code } = value;
    const execIdOk = execId === null || isExecId(execId);
    if (
      v === PROTOCOL_VERSION &&
      kind === "error" &&
      execIdOk &&
      typeof code === "string" &&
      ERROR_CODES.has(code)
    ) {
      return { v, kind, execId, code: code as ErrorCode };
    }
  }
  return null;
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
