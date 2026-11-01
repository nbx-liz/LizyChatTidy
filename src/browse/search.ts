// Search and date filtering over imported conversations (P-0006). Memory only
// (INV-03): the index is rebuilt from the current import and dropped with it.
//
// Each conversation gets one of three verdicts for a text query (INV-14):
// - match:    the query occurs in the title or in imported message text;
// - unknown:  no occurrence, but part of the body was not imported, so a
//             non-match cannot be asserted;
// - no-match: no occurrence and the whole body was imported.
import type { ConversationRecord } from "../import/types";

export type SearchVerdict = "match" | "no-match" | "unknown";
export type DateField = "createdAt" | "updatedAt";

export interface SearchQuery {
  readonly text: string;
  readonly dateField: DateField;
  /** Inclusive bounds in epoch milliseconds; null leaves that side open. */
  readonly fromMs: number | null;
  readonly toMs: number | null;
  /** Show conversations whose date is unknown even when a date bound is set. */
  readonly includeUnknownDates: boolean;
}

export const EMPTY_QUERY: SearchQuery = Object.freeze({
  text: "",
  dateField: "updatedAt",
  fromMs: null,
  toMs: null,
  includeUnknownDates: false,
});

interface IndexedConversation {
  readonly record: ConversationRecord;
  readonly order: number;
  readonly title: string;
  readonly messages: ReadonlyArray<{ readonly nodeId: string; readonly text: string }>;
  readonly bodyComplete: boolean;
}

export interface SearchIndex {
  /** The ImportSession revision the index was built from. */
  readonly revision: number;
  readonly items: readonly IndexedConversation[];
}

export interface SearchHit {
  readonly record: ConversationRecord;
  readonly verdict: SearchVerdict;
  readonly titleMatch: boolean;
  /** Nodes whose imported text contains the query; empty without a text query. */
  readonly matchedNodeIds: readonly string[];
  /** True when the date is unknown and the hit is shown only because of includeUnknownDates. */
  readonly dateUnknown: boolean;
}

export interface SearchOutcome {
  readonly revision: number;
  readonly total: number;
  /** Each bucket is ordered by the date field, newest first; unknown dates last. */
  readonly matches: readonly SearchHit[];
  readonly unknown: readonly SearchHit[];
  readonly noMatch: readonly SearchHit[];
  /** Conversations left out of a date condition because their date is unknown. */
  readonly dateUnknownExcluded: number;
  /** Conversations whose known date lies outside the bounds. */
  readonly dateOutOfRange: number;
}

/** NFKC plus lower case, so full-width and half-width forms and letter case compare equal. */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

export function buildIndex(records: readonly ConversationRecord[], revision: number): SearchIndex {
  return {
    revision,
    items: records.map((record, order) => ({
      record,
      order,
      title: record.title === null ? "" : normalizeForSearch(record.title),
      messages: record.nodes.flatMap((node) =>
        node.message === null || node.message.text === ""
          ? []
          : [{ nodeId: node.id, text: normalizeForSearch(node.message.text) }],
      ),
      bodyComplete: record.observation.contentCoverage === "complete",
    })),
  };
}

function dateOf(record: ConversationRecord, field: DateField): number | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

type DateCheck = "in" | "out" | "unknown-excluded" | "unknown-included";

function checkDate(item: IndexedConversation, query: SearchQuery): DateCheck {
  if (query.fromMs === null && query.toMs === null) {
    return "in";
  }
  const ms = dateOf(item.record, query.dateField);
  if (ms === null) {
    return query.includeUnknownDates ? "unknown-included" : "unknown-excluded";
  }
  if ((query.fromMs !== null && ms < query.fromMs) || (query.toMs !== null && ms > query.toMs)) {
    return "out";
  }
  return "in";
}

function judge(item: IndexedConversation, needle: string): Omit<SearchHit, "dateUnknown"> {
  if (needle === "") {
    return { record: item.record, verdict: "match", titleMatch: false, matchedNodeIds: [] };
  }
  const titleMatch = item.title.includes(needle);
  const matchedNodeIds = item.messages.filter((m) => m.text.includes(needle)).map((m) => m.nodeId);
  const verdict: SearchVerdict =
    titleMatch || matchedNodeIds.length > 0 ? "match" : item.bodyComplete ? "no-match" : "unknown";
  return { record: item.record, verdict, titleMatch, matchedNodeIds };
}

function newestFirst(field: DateField) {
  return (a: { item: IndexedConversation }, b: { item: IndexedConversation }): number => {
    const da = dateOf(a.item.record, field);
    const db = dateOf(b.item.record, field);
    if (da !== db) {
      if (da === null) {
        return 1;
      }
      if (db === null) {
        return -1;
      }
      return db - da;
    }
    return a.item.order - b.item.order;
  };
}

export function search(index: SearchIndex, query: SearchQuery): SearchOutcome {
  const needle = normalizeForSearch(query.text.trim());
  const shown: Array<{ item: IndexedConversation; hit: SearchHit }> = [];
  let dateUnknownExcluded = 0;
  let dateOutOfRange = 0;
  for (const item of index.items) {
    const date = checkDate(item, query);
    if (date === "unknown-excluded") {
      dateUnknownExcluded++;
      continue;
    }
    if (date === "out") {
      dateOutOfRange++;
      continue;
    }
    shown.push({ item, hit: { ...judge(item, needle), dateUnknown: date === "unknown-included" } });
  }
  shown.sort(newestFirst(query.dateField));
  return {
    revision: index.revision,
    total: index.items.length,
    matches: shown.filter((s) => s.hit.verdict === "match").map((s) => s.hit),
    unknown: shown.filter((s) => s.hit.verdict === "unknown").map((s) => s.hit),
    noMatch: shown.filter((s) => s.hit.verdict === "no-match").map((s) => s.hit),
    dateUnknownExcluded,
    dateOutOfRange,
  };
}

/** Keeps one index per import revision, so a re-import never searches stale records. */
export function createIndexCache(): (
  records: readonly ConversationRecord[],
  revision: number,
) => SearchIndex {
  let cached: SearchIndex | null = null;
  return (records, revision) => {
    if (cached === null || cached.revision !== revision) {
      cached = buildIndex(records, revision);
    }
    return cached;
  };
}
