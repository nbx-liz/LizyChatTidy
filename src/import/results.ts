import { newCounter } from "./counter";
import type { Coverage, FatalCode, ImportResult, ImportStatus, StructureReport } from "./types";

export const DECLARED_SCOPE = "chatgpt-export:conversations.json";

/** P-0001: only a complete import with no listed issue may feed a delete plan. */
export function canPlanDeletionFrom(result: ImportResult): boolean {
  return result.status === "complete" && result.issues.length === 0;
}

export function coverageFor(status: ImportStatus, records: number, excluded: string[]): Coverage {
  return {
    status:
      status === "complete"
        ? "complete-within-declared-scope"
        : status === "partial"
          ? "partial"
          : "unknown",
    declaredScope: DECLARED_SCOPE,
    observedCount: records,
    reportedTotal: null,
    excludedScopes: excluded,
    evidenceRefs: [],
  };
}

export function emptyReport(): StructureReport {
  return {
    entryCount: 0,
    entries: {},
    unknownExtensions: {},
    conversationsUncompressedBytes: null,
    conversationCount: 0,
    conversationKeys: newCounter(),
    messageKeys: newCounter(),
    contentTypes: newCounter(),
    roles: newCounter(),
    nodeCount: 0,
    leafCount: 0,
    maxTreeDepth: 0,
  };
}

/** A failed or cancelled result: never carries records (AT10). */
export function terminalResult(
  code: FatalCode | "cancelled",
  report: StructureReport = emptyReport(),
  entry: string | null = null,
): ImportResult {
  const status = code === "cancelled" ? "cancelled" : "failed";
  return {
    status,
    records: [],
    coverage: coverageFor(status, 0, []),
    issues: [{ code, entry }],
    report,
  };
}
