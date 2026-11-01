// Inventory snapshots (P-0009 item 4; BLUEPRINT §5 "内部 API による一覧取得").
// The Controller drives the page loop; completeness is decided here, never
// taken from the adapter.
import type {
  InventoryRecord,
  PageValue,
  ReadAdapter,
  ReadDescriptor,
  SubjectEvidence,
  SubjectKeys,
} from "../adapters/contracts";
import { parsePage, parseScope } from "../adapters/validate";
import { canPlanDeletionFrom } from "../import/results";
import type { ImportResult } from "../import/types";
import { CALL_DEADLINE_MS, type CallFailure, type CallResult, call, type Pacer } from "./calls";
import type { Clock } from "./environment";

export type Completeness = "complete" | "partial" | "unknown";

export type ScanIssue =
  | "duplicate-id"
  | "invalid-record"
  | "cursor-repeat"
  | "order-reversal"
  | "total-changed"
  | "total-mismatch"
  | "limit";

export interface InventorySnapshot {
  readonly snapshotId: string;
  readonly source: "web-api" | "official-export";
  readonly provider: "chatgpt" | "claude-code";
  readonly adapter: { readonly adapterId: string; readonly version: string };
  readonly importVersion: number | null;
  readonly subject: SubjectEvidence;
  readonly documentKey: string | null;
  readonly ledgerEpoch: number | null;
  /** Valid records whose id appeared once; duplicates are dropped from here. */
  readonly records: ReadonlyMap<string, InventoryRecord>;
  readonly duplicateIds: ReadonlySet<string>;
  readonly invalidCount: number;
  readonly issues: ReadonlySet<ScanIssue>;
  readonly completeness: Completeness;
  readonly capturedAt: number;
}

export const MAX_PAGES = 10_000;
export const MAX_RECORDS = 100_000;

export type ScanFailure =
  | { readonly reason: "call"; readonly failure: CallFailure }
  | {
      readonly reason: "subject-unverified" | "subject-changed" | "document-changed" | "cancelled";
    };

export type ScanResult =
  | { readonly ok: true; readonly snapshot: InventorySnapshot }
  | { readonly ok: false; readonly failure: ScanFailure };

export interface ScanDeps {
  readonly read: ReadAdapter;
  /** The validated copy, never the adapter's live object (review 1 #5, #6). */
  readonly descriptor: ReadDescriptor;
  readonly clock: Clock;
  readonly pacer: Pacer;
  readonly newId: () => string;
  readonly ledgerEpoch: number | null;
  readonly cancelled: () => boolean;
  /** Re-checked after every wait and right before every call: lock held, read still enabled. */
  readonly mayCall: () => boolean;
}

function sameSubject(
  a: SubjectEvidence,
  expected: SubjectEvidence & { status: "verified" },
): boolean {
  return (
    a.status === "verified" &&
    a.accountKey === expected.accountKey &&
    a.workspaceKey === expected.workspaceKey &&
    a.workspaceKind === expected.workspaceKind
  );
}

/**
 * Counts every occurrence of an id, valid or not, across all pages; an id
 * seen more than once is a duplicate and is never planned (P-0009 item 4).
 */
class Collector {
  readonly valid = new Map<string, InventoryRecord>();
  readonly occurrences = new Map<string, number>();
  readonly issues = new Set<ScanIssue>();
  readonly cursors = new Set<string>();
  invalid = 0;
  private listed = 0;
  total: number | null | undefined = undefined;
  lastUpdated: string | null | undefined = undefined;

  constructor(private readonly ordered: boolean) {}

  private occur(id: string): void {
    const n = (this.occurrences.get(id) ?? 0) + 1;
    this.occurrences.set(id, n);
    if (n > 1) {
      this.issues.add("duplicate-id");
    }
  }

  add(page: PageValue): void {
    if (page.invalidRecords > 0) {
      this.invalid += page.invalidRecords;
      this.issues.add("invalid-record");
    }
    if (this.total !== undefined && this.total !== page.reportedTotal) {
      this.issues.add("total-changed");
    }
    this.total = page.reportedTotal;
    this.listed += page.records.length + page.invalidRecords;
    for (const id of page.invalidIds) {
      this.occur(id);
    }
    for (const r of page.records) {
      this.checkOrder(r);
      this.occur(r.conversationId);
      this.valid.set(r.conversationId, r);
    }
    if (this.count() > MAX_RECORDS) {
      this.issues.add("limit");
    }
  }

  duplicates(): Set<string> {
    return new Set([...this.occurrences].filter(([, n]) => n > 1).map(([id]) => id));
  }

  /** Valid records whose id occurred exactly once. */
  records(): Map<string, InventoryRecord> {
    return new Map([...this.valid].filter(([id]) => this.occurrences.get(id) === 1));
  }

  private checkOrder(r: InventoryRecord): void {
    if (!this.ordered) {
      return;
    }
    // A null timestamp in a listing declared as ordered cannot be checked.
    if (r.updatedAt === null || this.lastUpdated === null) {
      this.issues.add("order-reversal");
    } else if (
      this.lastUpdated !== undefined &&
      Date.parse(r.updatedAt) > Date.parse(this.lastUpdated)
    ) {
      this.issues.add("order-reversal");
    }
    this.lastUpdated = r.updatedAt;
  }

  /** Every listed entry, valid or not, duplicates included. */
  count(): number {
    return this.listed;
  }
}

/** Runs the scan: inspectScope, then listPage until the end, bound to one subject and document. */
export async function scanInventory(deps: ScanDeps): Promise<ScanResult> {
  const { read, clock, pacer } = deps;
  const d = deps.descriptor;
  const scopeExec = deps.newId();
  await pacer.wait();
  if (deps.cancelled() || !deps.mayCall()) {
    return { ok: false, failure: { reason: "cancelled" } };
  }
  pacer.mark();
  const scopeCtx = Object.freeze({ execId: scopeExec, expiresAt: clock.now() + CALL_DEADLINE_MS });
  const scope = await call(
    clock,
    scopeExec,
    (signal) => read.inspectScope(scopeCtx, signal),
    parseScope,
  );
  if (!scope.ok) {
    return { ok: false, failure: { reason: "call", failure: scope.failure } };
  }
  const subject = scope.value.subject;
  if (subject.status !== "verified") {
    return { ok: false, failure: { reason: "subject-unverified" } };
  }
  const documentKey = scope.value.documentKey;
  const keys = (): SubjectKeys =>
    Object.freeze({ accountKey: subject.accountKey, workspaceKey: subject.workspaceKey });
  const collector = new Collector(d.listing.order === "updatedAt-desc");
  let cursor: string | null = null;
  for (let pageNo = 0; ; pageNo++) {
    if (pageNo >= MAX_PAGES) {
      collector.issues.add("limit");
      break;
    }
    const execId = deps.newId();
    await pacer.wait();
    if (deps.cancelled() || !deps.mayCall()) {
      return { ok: false, failure: { reason: "cancelled" } };
    }
    pacer.mark();
    // A fresh frozen context per call, so an adapter cannot change what later pages are bound to.
    const ctx = Object.freeze({
      execId,
      expiresAt: clock.now() + CALL_DEADLINE_MS,
      subject: keys(),
      documentKey,
    });
    const at: string | null = cursor;
    const page: CallResult<PageValue> = await call(
      clock,
      execId,
      (signal) => read.listPage(ctx, at, signal),
      (v) => parsePage(v, d.provider, d.listedKinds),
    );
    if (!page.ok) {
      return { ok: false, failure: { reason: "call", failure: page.failure } };
    }
    if (!sameSubject(page.value.subject, subject)) {
      return { ok: false, failure: { reason: "subject-changed" } };
    }
    if (page.value.documentKey !== documentKey) {
      return { ok: false, failure: { reason: "document-changed" } };
    }
    collector.add(page.value);
    if (collector.issues.has("limit")) {
      break;
    }
    const next: PageValue["next"] = page.value.next;
    if (next.kind === "end") {
      break;
    }
    if (collector.cursors.has(next.cursor)) {
      collector.issues.add("cursor-repeat");
      break;
    }
    collector.cursors.add(next.cursor);
    cursor = next.cursor;
  }
  if (typeof collector.total === "number" && collector.total !== collector.count()) {
    collector.issues.add("total-mismatch");
  }
  const completeness: Completeness =
    collector.issues.size > 0 ? "partial" : d.listing.stableSnapshot ? "complete" : "unknown";
  return {
    ok: true,
    snapshot: {
      snapshotId: deps.newId(),
      source: "web-api",
      provider: d.provider,
      adapter: { adapterId: d.adapterId, version: d.version },
      importVersion: null,
      subject,
      documentKey,
      ledgerEpoch: deps.ledgerEpoch,
      records: collector.records(),
      duplicateIds: collector.duplicates(),
      invalidCount: collector.invalid,
      issues: collector.issues,
      completeness,
      capturedAt: clock.now(),
    },
  };
}

export const EXPORT_ADAPTER_ID = "chatgpt-official-export";

/**
 * Maps a complete official-export import to a snapshot (P-0001: only a
 * complete import with no issues). Its subject is always unverified, so no
 * record of it can become a delete target (INV-06). Returns null otherwise.
 */
export function snapshotFromExport(
  result: ImportResult,
  importVersion: number,
  importerVersion: string,
  newId: () => string,
  now: number,
): InventorySnapshot | null {
  if (!canPlanDeletionFrom(result)) {
    return null;
  }
  const records = new Map<string, InventoryRecord>();
  for (const r of result.records) {
    records.set(
      r.conversationId,
      Object.freeze({
        conversationId: r.conversationId,
        kind: "official-export",
        title: r.title,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        archived: r.archived,
        activity: "unknown",
        stateToken: null,
      }),
    );
  }
  return {
    snapshotId: newId(),
    source: "official-export",
    provider: "chatgpt",
    adapter: { adapterId: EXPORT_ADAPTER_ID, version: importerVersion },
    importVersion,
    subject: { status: "unverified" },
    documentKey: null,
    ledgerEpoch: null,
    records,
    duplicateIds: new Set(),
    invalidCount: 0,
    issues: new Set(),
    completeness: "unknown",
    capturedAt: now,
  };
}
