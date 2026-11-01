// Regression tests for the PR #6 review, round 2: records must tile the bytes
// before the central directory exactly, and the descriptor form follows from
// the layout rather than from the first word.
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseChatGptExport } from "./chatgptExport";
import { canPlanDeletionFrom } from "./results";
import { conversation, ID_A } from "./testing/chatgptFixture";
import { buildZip, type FixtureEntry, zipBlob } from "./testing/zipFixture";
import { DEFAULT_IMPORT_LIMITS, type ImportResult } from "./types";

function run(bytes: Uint8Array): Promise<ImportResult> {
  return parseChatGptExport(
    zipBlob(bytes),
    DEFAULT_IMPORT_LIMITS,
    new AbortController().signal,
    () => 0,
  );
}

const conversations = JSON.stringify([conversation(ID_A)]);

describe("records tile the archive", () => {
  it("rejects an unlisted record hidden before the central directory", async () => {
    const hidden = buildZip([{ name: "conversations-002.json", data: "[]" }]);
    // Keep only the hidden local record (drop its directory and end record).
    const hiddenDirectoryOffset = new DataView(hidden.buffer).getUint32(hidden.length - 6, true);
    const localOnly = hidden.subarray(0, hiddenDirectoryOffset);
    const result = await run(
      buildZip([{ name: "conversations.json", data: conversations }], {
        beforeDirectory: localOnly,
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([
      { code: "zip-unsupported-layout", entry: "conversations.json" },
    ]);
    expect(canPlanDeletionFrom(result)).toBe(false);
  });

  it("rejects a single stray byte after the last record", async () => {
    const result = await run(
      buildZip([{ name: "conversations.json", data: conversations }], {
        beforeDirectory: new Uint8Array([0]),
      }),
    );
    expect(result.issues.map((i) => i.code)).toEqual(["zip-unsupported-layout"]);
  });

  it("rejects a gap between two records", async () => {
    const first: FixtureEntry = { name: "chat.html", data: "<html></html>", method: 0 };
    const bytes = buildZip([first, { name: "conversations.json", data: conversations }]);
    const firstLength = 30 + "chat.html".length + "<html></html>".length;
    // Point the second record one byte later than where it was written.
    const patched = buildZip([
      first,
      { name: "conversations.json", data: conversations, directoryOffset: firstLength + 1 },
    ]);
    expect((await run(bytes)).status).toBe("complete");
    expect((await run(patched)).status).toBe("failed");
  });

  it("accepts a well-formed archive whose last record carries a signed descriptor", async () => {
    const result = await run(
      buildZip([
        { name: "chat.html", data: "<html></html>", descriptor: "signed" },
        { name: "conversations.json", data: conversations, descriptor: "signed" },
      ]),
    );
    expect(result.status).toBe("complete");
  });
});

describe("data descriptor form follows the layout", () => {
  // A payload whose CRC-32 equals the descriptor signature (found by the reviewer).
  const tricky = JSON.stringify([conversation(ID_A, { title: "102:tW_ " })]);

  it("has the CRC-32 the test depends on", () => {
    expect(crc32(tricky)).toBe(0x08074b50);
  });

  for (const method of [0, 8] as const) {
    it(`reads an unsigned descriptor whose CRC equals the signature (method ${method})`, async () => {
      const result = await run(
        buildZip([{ name: "conversations.json", data: tricky, method, descriptor: "unsigned" }]),
      );
      expect(result.status).toBe("complete");
      expect(result.records).toHaveLength(1);
    });

    it(`reads the same payload with a signed descriptor (method ${method})`, async () => {
      const result = await run(
        buildZip([{ name: "conversations.json", data: tricky, method, descriptor: "signed" }]),
      );
      expect(result.status).toBe("complete");
    });
  }

  it("rejects 16 descriptor bytes that do not start with the signature", async () => {
    const result = await run(
      buildZip([{ name: "conversations.json", data: conversations, descriptor: "unsigned" }], {
        beforeDirectory: new Uint8Array(4),
      }),
    );
    expect(result.issues.map((i) => i.code)).toEqual(["zip-unsupported-layout"]);
  });
});
