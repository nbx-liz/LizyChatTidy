// Regression tests for the layout and local-record findings of the PR #6
// review, round 1 (overlapping records, a directory hidden in the comment,
// local-only flags and size markers, data descriptors, BOM-prefixed names).
import { describe, expect, it } from "vitest";
import { Guard, ImportFailure } from "./guard";
import { buildZip, type FixtureEntry, type FixtureOptions, zipBlob } from "./testing/zipFixture";
import { DEFAULT_IMPORT_LIMITS } from "./types";
import { readEntry, readZipDirectory } from "./zip";

async function readT(entries: FixtureEntry[], options: FixtureOptions = {}): Promise<string> {
  const blob = zipBlob(buildZip(entries, options));
  const guard = new Guard(DEFAULT_IMPORT_LIMITS, new AbortController().signal, () => 0);
  const dir = await readZipDirectory(blob, guard);
  const entry = dir.entries.find((e) => e.name === "t");
  if (entry === undefined) {
    throw new Error("entry t not found");
  }
  return new TextDecoder().decode(await readEntry(blob, entry, guard));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportFailure) {
      return error.code;
    }
    throw error;
  }
  return "no-failure";
}

function endRecord(commentLength: number): Uint8Array {
  const b = new Uint8Array(22);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(20, commentLength, true);
  return b;
}

describe("ZIP layout", () => {
  it("rejects a record placed inside the payload of another record", async () => {
    const entries: FixtureEntry[] = [
      { name: "a", data: "x".repeat(200), method: 0 },
      { name: "t", data: "hello", directoryOffset: 40 },
    ];
    expect(await codeOf(readT(entries))).toBe("zip-bad-directory");
  });

  it("rejects a second end record hidden at the end of the comment", async () => {
    expect(await codeOf(readT([{ name: "t", data: "hello" }], { comment: endRecord(0) }))).toBe(
      "zip-bad-directory",
    );
  });

  it("accepts a comment that merely contains the end-record signature", async () => {
    expect(
      await readT([{ name: "t", data: "hello" }], { comment: "PK\x05\x06 not a record" }),
    ).toBe("hello");
  });
});

describe("local record must match the directory", () => {
  const cases: ReadonlyArray<[string, FixtureEntry, string]> = [
    [
      "an encryption flag set only locally",
      { name: "t", data: "hi", localFlags: 0x0801 },
      "zip-local-header-mismatch",
    ],
    [
      "a ZIP64 size marker set only locally",
      { name: "t", data: "hi", localUncompressedSize: 0xffffffff },
      "zip-zip64",
    ],
    [
      "a local CRC that differs",
      { name: "t", data: "hi", localCrc: 1 },
      "zip-local-header-mismatch",
    ],
    [
      "a local compressed size that differs",
      { name: "t", data: "hi", localCompressedSize: 1 },
      "zip-local-header-mismatch",
    ],
    [
      "a BOM-prefixed local name",
      { name: "t", data: "hi", localName: "﻿t" },
      "zip-local-header-mismatch",
    ],
    [
      "a descriptor flag with no room for the descriptor",
      { name: "t", data: "hi", flags: 0x0808 },
      "zip-truncated",
    ],
  ];

  for (const [label, entry, code] of cases) {
    it(`rejects ${label}`, async () => {
      expect(await codeOf(readT([entry]))).toBe(code);
    });
  }

  it("reads an entry with a signed data descriptor", async () => {
    expect(await readT([{ name: "t", data: "hello", descriptor: "signed" }])).toBe("hello");
  });

  it("reads an entry with an unsigned data descriptor", async () => {
    expect(await readT([{ name: "t", data: "hello", descriptor: "unsigned" }])).toBe("hello");
  });

  it("rejects a data descriptor whose sizes differ from the directory", async () => {
    const bytes = buildZip([{ name: "t", data: "hello", descriptor: "signed" }]);
    const at = bytes.findIndex(
      (b, i) =>
        b === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x07 && bytes[i + 3] === 0x08,
    );
    expect(at).toBeGreaterThan(0);
    new DataView(bytes.buffer).setUint32(at + 12, 6, true); // descriptor says 6, directory says 5
    const blob = zipBlob(bytes);
    const guard = new Guard(DEFAULT_IMPORT_LIMITS, new AbortController().signal, () => 0);
    const dir = await readZipDirectory(blob, guard);
    const entry = dir.entries[0];
    if (entry === undefined) {
      throw new Error("entry missing");
    }
    expect(await codeOf(readEntry(blob, entry, guard))).toBe("zip-local-header-mismatch");
  });

  it("rejects data longer than the size the directory and descriptor declare", async () => {
    const entry: FixtureEntry = {
      name: "t",
      data: "hello",
      descriptor: "signed",
      uncompressedSize: 4,
    };
    expect(await codeOf(readT([entry]))).toBe("zip-size-mismatch");
  });
});
