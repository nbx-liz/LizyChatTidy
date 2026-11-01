// Runtime validation of everything an adapter returns (P-0009 item 1,
// INV-16). Exact key sets, plain objects and closed enumerations only;
// anything else is rejected, never skipped.
import { isCanonicalId } from "../keep/keepRules";
import type {
  Anomaly,
  AnomalyCode,
  CommitValue,
  EvidenceKind,
  InventoryRecord,
  PageValue,
  PreflightValue,
  PreparedCommit,
  Provider,
  ReconcileValue,
  ScopeValue,
  SubjectEvidence,
} from "./contracts";

export type Plain = Record<string, unknown>;

export function isPlain(value: unknown): value is Plain {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasExactKeys(value: unknown, keys: readonly string[]): value is Plain {
  if (!isPlain(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

const TOKEN = /^[\x21-\x7e]{1,256}$/;

/** 1 to 256 printable ASCII characters (keys, cursors, tokens, references). */
export function isToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const MIN_TIME = Date.UTC(2015, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

export function isIsoUtc(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC.test(value)) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= MIN_TIME && t <= MAX_TIME;
}

const MAX_TITLE = 2000;

const ANOMALY_CODES: ReadonlySet<string> = new Set<AnomalyCode>([
  "rate-limited",
  "server-error",
  "timeout",
  "network",
  "unexpected-status",
  "unexpected-schema",
  "redirect",
  "auth-changed",
  "tab-lost",
  "permission-lost",
  "document-changed",
]);

const EVIDENCE_KINDS: ReadonlySet<string> = new Set<EvidenceKind>([
  "item-deleted-marker",
  "item-not-found",
  "list-absent",
]);

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === "string" && EVIDENCE_KINDS.has(value);
}

function parseAnomaly(value: unknown): Anomaly | null {
  if (hasExactKeys(value, ["code", "retryAfterSeconds"])) {
    const r = value["retryAfterSeconds"];
    const retryOk =
      r === null || (typeof r === "number" && Number.isSafeInteger(r) && r >= 0 && r <= 86_400);
    if (value["code"] === "rate-limited" && retryOk) {
      return { code: "rate-limited", retryAfterSeconds: r as number | null };
    }
    return null;
  }
  if (hasExactKeys(value, ["code"])) {
    const code = value["code"];
    if (typeof code === "string" && ANOMALY_CODES.has(code) && code !== "rate-limited") {
      return { code: code as Exclude<AnomalyCode, "rate-limited"> };
    }
  }
  return null;
}

export type Parsed<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "anomaly"; readonly anomaly: Anomaly }
  | { readonly kind: "invalid" };

const INVALID = { kind: "invalid" } as const;

/** Parses the Outcome envelope; the value parser runs only for ok outcomes. */
export function parseOutcome<T>(
  raw: unknown,
  execId: string,
  parseValue: (value: unknown) => T | null,
): Parsed<T> {
  if (hasExactKeys(raw, ["execId", "ok", "value"]) && raw["ok"] === true) {
    if (raw["execId"] !== execId) {
      return INVALID;
    }
    const value = parseValue(raw["value"]);
    return value === null ? INVALID : { kind: "ok", value };
  }
  if (hasExactKeys(raw, ["execId", "ok", "anomaly"]) && raw["ok"] === false) {
    if (raw["execId"] !== execId) {
      return INVALID;
    }
    const anomaly = parseAnomaly(raw["anomaly"]);
    return anomaly === null ? INVALID : { kind: "anomaly", anomaly };
  }
  return INVALID;
}

export function parseSubject(value: unknown): SubjectEvidence | null {
  if (hasExactKeys(value, ["status"]) && value["status"] === "unverified") {
    return { status: "unverified" };
  }
  if (!hasExactKeys(value, ["status", "accountKey", "workspaceKey", "workspaceKind"])) {
    return null;
  }
  const { status, accountKey, workspaceKey, workspaceKind } = value;
  if (status !== "verified" || !isToken(accountKey) || !isToken(workspaceKey)) {
    return null;
  }
  if (
    workspaceKind !== "personal" &&
    workspaceKind !== "organization" &&
    workspaceKind !== "unknown"
  ) {
    return null;
  }
  return { status, accountKey, workspaceKey, workspaceKind };
}

const RECORD_KEYS = [
  "conversationId",
  "kind",
  "title",
  "createdAt",
  "updatedAt",
  "archived",
  "activity",
  "stateToken",
] as const;

export function parseRecord(
  value: unknown,
  provider: Provider,
  listedKinds: readonly string[],
): InventoryRecord | null {
  if (!hasExactKeys(value, RECORD_KEYS)) {
    return null;
  }
  const v = value;
  const id = v["conversationId"];
  if (typeof id !== "string" || !isCanonicalId(provider, id)) {
    return null;
  }
  const kind = v["kind"];
  if (typeof kind !== "string" || !listedKinds.includes(kind)) {
    return null;
  }
  const title = v["title"];
  if (title !== null && (typeof title !== "string" || title.length > MAX_TITLE)) {
    return null;
  }
  const createdAt = v["createdAt"];
  const updatedAt = v["updatedAt"];
  if (
    (createdAt !== null && !isIsoUtc(createdAt)) ||
    (updatedAt !== null && !isIsoUtc(updatedAt))
  ) {
    return null;
  }
  const archived = v["archived"];
  if (archived !== null && typeof archived !== "boolean") {
    return null;
  }
  const activity = v["activity"];
  if (activity !== "idle" && activity !== "running" && activity !== "unknown") {
    return null;
  }
  const stateToken = v["stateToken"];
  if (stateToken !== null && !isToken(stateToken)) {
    return null;
  }
  return {
    conversationId: id,
    kind,
    title: title as string | null,
    createdAt: createdAt as string | null,
    updatedAt: updatedAt as string | null,
    archived: archived as boolean | null,
    activity,
    stateToken: stateToken as string | null,
  };
}

export function parseScope(value: unknown): ScopeValue | null {
  if (!hasExactKeys(value, ["subject", "documentKey"]) || !isToken(value["documentKey"])) {
    return null;
  }
  const subject = parseSubject(value["subject"]);
  return subject === null ? null : { subject, documentKey: value["documentKey"] };
}

const PAGE_KEYS = ["subject", "documentKey", "records", "next", "reportedTotal"] as const;
export const MAX_PAGE_RECORDS = 10_000;

function parseNext(value: unknown): PageValue["next"] | null {
  if (hasExactKeys(value, ["kind"]) && value["kind"] === "end") {
    return { kind: "end" };
  }
  if (
    hasExactKeys(value, ["kind", "cursor"]) &&
    value["kind"] === "cursor" &&
    isToken(value["cursor"])
  ) {
    return { kind: "cursor", cursor: value["cursor"] };
  }
  return null;
}

/**
 * A page is invalid as a whole when its envelope is malformed; single
 * records that fail validation are counted (listed) and never planned.
 */
export function parsePage(
  value: unknown,
  provider: Provider,
  listedKinds: readonly string[],
): PageValue | null {
  if (!hasExactKeys(value, PAGE_KEYS) || !isToken(value["documentKey"])) {
    return null;
  }
  const subject = parseSubject(value["subject"]);
  const next = parseNext(value["next"]);
  const rawRecords = value["records"];
  const total = value["reportedTotal"];
  const totalOk =
    total === null || (typeof total === "number" && Number.isSafeInteger(total) && total >= 0);
  if (subject === null || next === null || !Array.isArray(rawRecords) || !totalOk) {
    return null;
  }
  if (rawRecords.length > MAX_PAGE_RECORDS) {
    return null;
  }
  const records: InventoryRecord[] = [];
  let invalidRecords = 0;
  for (const raw of rawRecords) {
    const record = parseRecord(raw, provider, listedKinds);
    if (record === null) {
      invalidRecords++;
    } else {
      records.push(record);
    }
  }
  return {
    subject,
    documentKey: value["documentKey"],
    records,
    invalidRecords,
    next,
    reportedTotal: total as number | null,
  };
}

export function parsePreflight(
  value: unknown,
  provider: Provider,
  listedKinds: readonly string[],
): PreflightValue | null {
  if (!hasExactKeys(value, ["subject", "documentKey", "item"]) || !isToken(value["documentKey"])) {
    return null;
  }
  const subject = parseSubject(value["subject"]);
  const item = value["item"];
  if (subject === null) {
    return null;
  }
  const documentKey = value["documentKey"];
  if (hasExactKeys(item, ["kind", "record"]) && item["kind"] === "present") {
    const record = parseRecord(item["record"], provider, listedKinds);
    return record === null ? null : { subject, documentKey, item: { kind: "present", record } };
  }
  if (hasExactKeys(item, ["kind", "conversationId"]) && item["kind"] === "absent") {
    const id = item["conversationId"];
    if (typeof id === "string" && isCanonicalId(provider, id)) {
      return { subject, documentKey, item: { kind: "absent", conversationId: id } };
    }
  }
  return null;
}

export function parsePrepared(value: unknown): PreparedCommit | null {
  if (!hasExactKeys(value, ["documentKey", "dispatch"]) || !isToken(value["documentKey"])) {
    return null;
  }
  const dispatch = value["dispatch"];
  return typeof dispatch === "function"
    ? { documentKey: value["documentKey"], dispatch: dispatch as () => unknown }
    : null;
}

/** dispatch() must return { response: thenable } synchronously. */
export function parseDispatched(value: unknown): { response: PromiseLike<unknown> } | null {
  if (!hasExactKeys(value, ["response"])) {
    return null;
  }
  const response = value["response"];
  const thenable =
    typeof response === "object" &&
    response !== null &&
    typeof (response as { then?: unknown }).then === "function";
  return thenable ? { response: response as PromiseLike<unknown> } : null;
}

export function parseCommitValue(value: unknown, provider: Provider): CommitValue | null {
  if (!hasExactKeys(value, ["conversationId", "accepted"]) || value["accepted"] !== true) {
    return null;
  }
  const id = value["conversationId"];
  return typeof id === "string" && isCanonicalId(provider, id)
    ? { conversationId: id, accepted: true }
    : null;
}

export function parseReconcile(value: unknown, provider: Provider): ReconcileValue | null {
  const keys = ["subject", "documentKey", "conversationId", "probe", "satisfied"];
  if (!hasExactKeys(value, keys) || !isToken(value["documentKey"])) {
    return null;
  }
  const subject = parseSubject(value["subject"]);
  const id = value["conversationId"];
  const probe = value["probe"];
  const satisfied = value["satisfied"];
  if (
    subject === null ||
    typeof id !== "string" ||
    !isCanonicalId(provider, id) ||
    !isEvidenceKind(probe) ||
    typeof satisfied !== "boolean"
  ) {
    return null;
  }
  return { subject, documentKey: value["documentKey"], conversationId: id, probe, satisfied };
}
