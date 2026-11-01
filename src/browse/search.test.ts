import { describe, expect, it } from "vitest";
import { buildIndex, createIndexCache, EMPTY_QUERY, normalizeForSearch, search } from "./search";
import { record } from "./testing/records";

const DAY = 86_400_000;

function query(text: string, extra: Partial<typeof EMPTY_QUERY> = {}) {
  return { ...EMPTY_QUERY, text, ...extra };
}

describe("normalizeForSearch", () => {
  it("folds full-width forms and letter case", () => {
    expect(normalizeForSearch("ＡＢＣ１２３")).toBe("abc123");
    expect(normalizeForSearch("ｶﾀｶﾅ")).toBe("カタカナ");
  });
});

describe("search verdicts (three-valued, INV-14)", () => {
  const complete = record({ title: "Alpha", texts: ["hello", "world"] });
  const partial = record({ title: "Beta", texts: ["nothing here"], coverage: "partial" });
  const untitled = record({ title: null, texts: ["Needle in the body"] });
  const index = buildIndex([complete, partial, untitled], 1);

  it("matches the title, case- and width-insensitively", () => {
    const out = search(index, query("ＡＬＰＨＡ"));
    expect(out.matches.map((h) => h.record)).toEqual([complete]);
    expect(out.matches[0]?.titleMatch).toBe(true);
  });

  it("matches imported body text and records the matching nodes", () => {
    const out = search(index, query("needle"));
    expect(out.matches.map((h) => h.record)).toEqual([untitled]);
    expect(out.matches[0]?.matchedNodeIds).toEqual(["n0"]);
  });

  it("calls a partly imported conversation unknown, never no-match (AT08)", () => {
    const out = search(index, query("zzz"));
    expect(out.unknown.map((h) => h.record)).toEqual([partial]);
    expect(out.noMatch.map((h) => h.record)).toEqual([complete, untitled]);
    expect(out.matches).toEqual([]);
  });

  it("still matches a partly imported conversation on the text it has", () => {
    expect(search(index, query("nothing")).matches.map((h) => h.record)).toEqual([partial]);
  });

  it("returns every conversation as a match for an empty or blank query", () => {
    expect(search(index, query("   ")).matches).toHaveLength(3);
  });

  it("keeps the bucket identity: match + no-match + unknown = searched", () => {
    const out = search(index, query("o"));
    expect(out.matches.length + out.noMatch.length + out.unknown.length).toBe(out.total);
  });
});

describe("date filter (AT05)", () => {
  const known = record({ title: "known", updatedAt: "2026-03-15T12:00:00.000Z" });
  const old = record({ title: "old", updatedAt: "2025-01-01T00:00:00.000Z" });
  const unknown = record({ title: "unknown", updatedAt: null });
  const index = buildIndex([known, old, unknown], 1);
  const from = Date.parse("2026-03-15T00:00:00.000Z");
  const to = from + DAY - 1;

  it("excludes unknown dates from a date condition and counts them", () => {
    const out = search(index, query("", { fromMs: from, toMs: to }));
    expect(out.matches.map((h) => h.record)).toEqual([known]);
    expect(out.dateUnknownExcluded).toBe(1);
    expect(out.dateOutOfRange).toBe(1);
  });

  it("includes both bounds", () => {
    const at = Date.parse("2026-03-15T12:00:00.000Z");
    expect(search(index, query("", { fromMs: at, toMs: at })).matches).toHaveLength(1);
  });

  it("shows unknown dates only on request, flagged as unknown", () => {
    const out = search(index, query("", { fromMs: from, toMs: to, includeUnknownDates: true }));
    expect(out.matches.map((h) => [h.record.title, h.dateUnknown])).toEqual([
      ["known", false],
      ["unknown", true],
    ]);
    expect(out.dateUnknownExcluded).toBe(0);
  });

  it("does not treat an unknown date as old for an open-ended upper bound", () => {
    const out = search(index, query("", { toMs: Date.parse("2025-06-01T00:00:00.000Z") }));
    expect(out.matches.map((h) => h.record)).toEqual([old]);
    expect(out.dateUnknownExcluded).toBe(1);
  });

  it("filters on the chosen field", () => {
    const created = record({
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    });
    const out = search(
      buildIndex([created], 1),
      query("", { dateField: "createdAt", fromMs: from }),
    );
    expect(out.matches).toEqual([]);
    expect(out.dateOutOfRange).toBe(1);
  });

  it("orders newest first with unknown dates last", () => {
    const out = search(index, query(""));
    expect(out.matches.map((h) => h.record.title)).toEqual(["known", "old", "unknown"]);
  });
});

describe("index revisions", () => {
  it("rebuilds after a re-import, so stale records are never searched", () => {
    const cache = createIndexCache();
    const first = [record({ title: "from the first import" })];
    const second = [record({ title: "from the second import" })];
    expect(search(cache(first, 1), query("first")).matches).toHaveLength(1);
    const after = search(cache(second, 2), query("first"));
    expect(after.revision).toBe(2);
    expect(after.matches).toEqual([]);
    expect(after.total).toBe(1);
  });

  it("reuses the index while the revision is unchanged", () => {
    const cache = createIndexCache();
    const records = [record()];
    expect(cache(records, 3)).toBe(cache(records, 3));
  });
});

describe("performance (recorded, not asserted; BLUEPRINT §10)", () => {
  it("searches 10,000 synthetic conversations", () => {
    const records = Array.from({ length: 10_000 }, (_, i) =>
      record({
        title: `Synthetic conversation ${i}`,
        texts: Array.from({ length: 10 }, (_, j) =>
          `message ${j} of conversation ${i} `.repeat(20),
        ),
      }),
    );
    const t0 = performance.now();
    const index = buildIndex(records, 1);
    const t1 = performance.now();
    const out = search(index, query("conversation 9999 "));
    const t2 = performance.now();
    console.info(
      `[perf] 10,000 conversations: index ${(t1 - t0).toFixed(0)} ms, search ${(t2 - t1).toFixed(0)} ms`,
    );
    expect(out.matches.length).toBeGreaterThan(0);
  });
});
