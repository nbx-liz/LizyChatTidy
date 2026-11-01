import { describe, expect, it } from "vitest";
import { parseChatGptExport } from "./chatgptExport";
import { canPlanDeletionFrom } from "./results";
import { conversation, ID_A, ID_B, ID_C } from "./testing/chatgptFixture";
import { buildZip, type FixtureEntry, zipBlob } from "./testing/zipFixture";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits, type ImportResult } from "./types";

const FIXED_NOW = Date.UTC(2026, 10, 1);

function exportZip(conversations: unknown, extra: FixtureEntry[] = []): Blob {
  return zipBlob(
    buildZip([
      { name: "conversations.json", data: JSON.stringify(conversations) },
      { name: "chat.html", data: "<html><script>alert(1)</script></html>" },
      { name: "user.json", data: '{"email":"someone@example.invalid"}' },
      { name: "file-abc123.png", data: new Uint8Array([137, 80, 78, 71]), method: 0 },
      ...extra,
    ]),
  );
}

async function run(
  file: Blob,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
  signal = new AbortController().signal,
  now: () => number = () => FIXED_NOW,
): Promise<ImportResult> {
  return parseChatGptExport(file, limits, signal, now);
}

function expectFailed(result: ImportResult, code: string): void {
  expect(result.status).toBe("failed");
  expect(result.records).toEqual([]);
  expect(result.issues.map((i) => i.code)).toEqual([code]);
  expect(result.coverage.status).toBe("unknown");
  expect(canPlanDeletionFrom(result)).toBe(false);
}

describe("parseChatGptExport", () => {
  it("imports a well-formed export as complete", async () => {
    const result = await run(exportZip([conversation(ID_A), conversation(ID_B, { branch: true })]));
    expect(result.status).toBe("complete");
    expect(result.issues).toEqual([]);
    expect(result.records.map((r) => r.conversationId)).toEqual([ID_A, ID_B]);
    expect(result.records[0]?.observation.observedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(result.coverage).toEqual({
      status: "complete-within-declared-scope",
      declaredScope: "chatgpt-export:conversations.json",
      observedCount: 2,
      reportedTotal: null,
      excludedScopes: ["attachment", "chat-html", "user-json"],
      evidenceRefs: [],
    });
    expect(canPlanDeletionFrom(result)).toBe(true);
  });

  it("accepts a UTF-8 byte order mark", async () => {
    const bytes = new TextEncoder().encode(`﻿${JSON.stringify([conversation(ID_A)])}`);
    const result = await run(zipBlob(buildZip([{ name: "conversations.json", data: bytes }])));
    expect(result.status).toBe("complete");
  });

  describe("partial imports are listed and never plannable", () => {
    it("lists an unknown entry", async () => {
      const result = await run(
        exportZip([conversation(ID_A)], [{ name: "conversations-001.json", data: "[]" }]),
      );
      expect(result.status).toBe("partial");
      expect(result.issues).toEqual([{ code: "unknown-entry", entry: "conversations-001.json" }]);
      expect(result.records).toHaveLength(1);
      expect(result.coverage.status).toBe("partial");
      expect(canPlanDeletionFrom(result)).toBe(false);
    });

    it("lists an entry whose name cannot be decoded", async () => {
      const result = await run(
        exportZip([conversation(ID_A)], [{ name: "café.bin", data: "x", flags: 0 }]),
      );
      expect(result.issues).toEqual([{ code: "unknown-entry", entry: null }]);
    });

    it("drops every copy of a duplicated id and lists each one (AT07)", async () => {
      const result = await run(
        exportZip([
          conversation(ID_A),
          conversation(ID_B),
          conversation(ID_A, { title: "Changed" }),
        ]),
      );
      expect(result.status).toBe("partial");
      expect(result.records.map((r) => r.conversationId)).toEqual([ID_B]);
      expect(result.issues).toEqual([
        { code: "duplicate-id", entry: "conversations.json[0]" },
        { code: "duplicate-id", entry: "conversations.json[2]" },
      ]);
    });

    it("keeps valid conversations next to rejected ones", async () => {
      const result = await run(exportZip([conversation(ID_A), "junk", conversation(ID_C)]));
      expect(result.status).toBe("partial");
      expect(result.records.map((r) => r.conversationId)).toEqual([ID_A, ID_C]);
      expect(result.issues).toEqual([{ code: "not-object", entry: "conversations.json[1]" }]);
      expect(canPlanDeletionFrom(result)).toBe(false);
    });
  });

  describe("failed imports carry no records (AT10)", () => {
    it("fails without conversations.json", async () => {
      expectFailed(
        await run(zipBlob(buildZip([{ name: "chat.html", data: "<html></html>" }]))),
        "missing-conversations",
      );
    });

    it("fails on a JSON syntax error", async () => {
      expectFailed(
        await run(zipBlob(buildZip([{ name: "conversations.json", data: "[{" }]))),
        "json-syntax",
      );
    });

    it("fails on invalid UTF-8", async () => {
      expectFailed(
        await run(
          zipBlob(
            buildZip([{ name: "conversations.json", data: new Uint8Array([0x5b, 0xff, 0x5d]) }]),
          ),
        ),
        "json-encoding",
      );
    });

    it("fails when the top level is not an array", async () => {
      expectFailed(await run(exportZip({ conversations: [] })), "not-conversation-array");
    });

    it("fails on nesting deeper than maxJsonDepth", async () => {
      const deep = `[${"[".repeat(70)}${"]".repeat(70)}]`;
      expectFailed(
        await run(zipBlob(buildZip([{ name: "conversations.json", data: deep }]))),
        "limit-json-depth",
      );
    });

    it("fails when the uncompressed size exceeds the limit", async () => {
      const limits = { ...DEFAULT_IMPORT_LIMITS, maxUncompressedBytes: 100 };
      expectFailed(await run(exportZip([conversation(ID_A)]), limits), "limit-uncompressed");
    });

    it("fails when the time budget runs out", async () => {
      let t = 0;
      const clock = () => {
        t += 1000;
        return t;
      };
      const limits = { ...DEFAULT_IMPORT_LIMITS, maxMillis: 1500 };
      const result = await run(exportZip([conversation(ID_A)]), limits, undefined, clock);
      expectFailed(result, "limit-time");
    });

    it("fails on a corrupted archive", async () => {
      expectFailed(await run(zipBlob(new TextEncoder().encode("PK not really"))), "not-zip");
    });

    it("names the entry that failed", async () => {
      const result = await run(
        zipBlob(buildZip([{ name: "conversations.json", data: "[]", crc: 7 }])),
      );
      expect(result.issues).toEqual([{ code: "zip-crc-mismatch", entry: "conversations.json" }]);
    });
  });

  it("returns cancelled with no records when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run(
      exportZip([conversation(ID_A)]),
      DEFAULT_IMPORT_LIMITS,
      controller.signal,
    );
    expect(result.status).toBe("cancelled");
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([{ code: "cancelled", entry: null }]);
    expect(canPlanDeletionFrom(result)).toBe(false);
  });

  it("reports structure without titles, text, ids, file names or account details", async () => {
    const result = await run(
      exportZip(
        [conversation(ID_A, { title: "Private title", branch: true })],
        [{ name: "my-diary-notes.docx", data: "x" }],
      ),
    );
    expect(result.report).toMatchObject({
      entryCount: 5,
      conversationCount: 1,
      nodeCount: 4,
      leafCount: 2,
      maxTreeDepth: 3,
      unknownExtensions: { docx: 1 },
      entries: {
        conversations: { count: 1 },
        "chat-html": { count: 1 },
        "user-json": { count: 1 },
        attachment: { count: 1, bytes: 4 },
        unknown: { count: 1 },
      },
    });
    expect(result.report.conversationsUncompressedBytes).toBeGreaterThan(0);
    const text = JSON.stringify(result.report);
    for (const secret of [
      "Private title",
      "Synthetic",
      "answer",
      ID_A,
      "diary",
      "abc123",
      "example.invalid",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("treats entries named after Object.prototype members as unknown (DC2)", async () => {
    const result = await run(
      exportZip(
        [conversation(ID_A)],
        [
          { name: "constructor", data: "x" },
          { name: "toString", data: "x" },
          { name: "a.constructor", data: "x" },
        ],
      ),
    );
    expect(result.issues).toEqual([
      { code: "unknown-entry", entry: "constructor" },
      { code: "unknown-entry", entry: "toString" },
      { code: "unknown-entry", entry: "a.constructor" },
    ]);
    expect(result.report.entries.unknown).toEqual({ count: 3, bytes: 3 });
    expect(result.report.unknownExtensions).toEqual({ "(none)": 3 });
  });

  it("still reports the archive shape when the import fails", async () => {
    const result = await run(zipBlob(buildZip([{ name: "chat.html", data: "<html></html>" }])));
    expect(result.report.entries["chat-html"]).toEqual({ count: 1, bytes: 13 });
  });
});
