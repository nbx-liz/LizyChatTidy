import { describe, expect, it } from "vitest";
import { Guard, ImportFailure } from "./guard";
import { buildZip, zipBlob } from "./testing/zipFixture";
import { DEFAULT_IMPORT_LIMITS, type FatalCode, type ImportLimits } from "./types";
import { readEntry, readZipDirectory } from "./zip";

const LIMITS: ImportLimits = DEFAULT_IMPORT_LIMITS;

function guard(limits: ImportLimits = LIMITS, signal = new AbortController().signal): Guard {
  return new Guard(limits, signal, () => 0);
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportFailure) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected an ImportFailure");
}

async function readNamed(bytes: Uint8Array, name: string, limits = LIMITS): Promise<string> {
  const blob = zipBlob(bytes);
  const g = guard(limits);
  const dir = await readZipDirectory(blob, g);
  const entry = dir.entries.find((e) => e.name === name);
  if (entry === undefined) {
    throw new Error("entry not found");
  }
  return new TextDecoder().decode(await readEntry(blob, dir, entry, g));
}

describe("readZipDirectory", () => {
  it("lists entries of a well-formed archive", async () => {
    const bytes = buildZip([
      { name: "conversations.json", data: "[]" },
      { name: "file-a.png", data: new Uint8Array([1, 2, 3]), method: 0 },
    ]);
    const dir = await readZipDirectory(zipBlob(bytes), guard());
    expect(dir.entries.map((e) => e.name)).toEqual(["conversations.json", "file-a.png"]);
  });

  it("accepts a trailing archive comment", async () => {
    const bytes = buildZip([{ name: "a.json", data: "1" }], { comment: "PK\x05\x06 decoy" });
    const dir = await readZipDirectory(zipBlob(bytes), guard());
    expect(dir.entries).toHaveLength(1);
  });

  const fatal: ReadonlyArray<[string, () => Uint8Array, FatalCode]> = [
    [
      "a non-ZIP file",
      () => new TextEncoder().encode("not a zip at all, just some text"),
      "not-zip",
    ],
    ["an empty file", () => new Uint8Array(0), "not-zip"],
    [
      "data before the archive",
      () => buildZip([{ name: "a", data: "x" }], { prefix: new Uint8Array(16) }),
      "zip-unsupported-layout",
    ],
    [
      "a ZIP64 locator",
      () => buildZip([{ name: "a", data: "x" }], { zip64Locator: true }),
      "zip-zip64",
    ],
    [
      "a multi-disk archive",
      () => buildZip([{ name: "a", data: "x" }], { diskNumber: 1 }),
      "zip-multi-disk",
    ],
    [
      "a directory count that does not match its entries",
      () => buildZip([{ name: "a", data: "x" }], { totalEntriesOverride: 2 }),
      "zip-bad-directory",
    ],
    [
      "duplicate entry names",
      () =>
        buildZip([
          { name: "conversations.json", data: "[]" },
          { name: "conversations.json", data: "[1]" },
        ]),
      "zip-duplicate-entry",
    ],
    [
      "a ZIP64 size marker",
      () => buildZip([{ name: "a", data: "x", uncompressedSize: 0xffffffff }]),
      "zip-zip64",
    ],
  ];

  for (const [label, make, code] of fatal) {
    it(`fails on ${label}`, async () => {
      expect(await failureCode(readZipDirectory(zipBlob(make()), guard()))).toBe(code);
    });
  }

  it("fails when the archive is larger than maxCompressedBytes", async () => {
    const bytes = buildZip([{ name: "a", data: "x".repeat(100) }]);
    const limits = { ...LIMITS, maxCompressedBytes: bytes.length - 1 };
    expect(await failureCode(readZipDirectory(zipBlob(bytes), guard(limits)))).toBe(
      "limit-compressed",
    );
  });

  it("fails when the entry count exceeds maxEntries", async () => {
    const bytes = buildZip([
      { name: "a", data: "1" },
      { name: "b", data: "2" },
      { name: "c", data: "3" },
    ]);
    const limits = { ...LIMITS, maxEntries: 2 };
    expect(await failureCode(readZipDirectory(zipBlob(bytes), guard(limits)))).toBe(
      "limit-entries",
    );
  });

  it("does not decode a non-UTF-8 name with high bytes", async () => {
    const bytes = buildZip([{ name: "café.txt", data: "x", flags: 0 }]);
    const dir = await readZipDirectory(zipBlob(bytes), guard());
    expect(dir.entries[0]?.name).toBeNull();
  });
});

describe("readEntry", () => {
  it("inflates deflate and stored entries", async () => {
    const bytes = buildZip([
      { name: "d.json", data: '{"a":1}' },
      { name: "s.json", data: '{"b":2}', method: 0 },
    ]);
    expect(await readNamed(bytes, "d.json")).toBe('{"a":1}');
    expect(await readNamed(bytes, "s.json")).toBe('{"b":2}');
  });

  const fatal: ReadonlyArray<[string, Parameters<typeof buildZip>[0], FatalCode]> = [
    ["an encrypted entry", [{ name: "t", data: "x", flags: 0x0801 }], "zip-encrypted"],
    ["an unsupported method", [{ name: "t", data: "x", method: 12 }], "zip-unsupported-method"],
    ["a CRC mismatch", [{ name: "t", data: "hello", crc: 1 }], "zip-crc-mismatch"],
    [
      "a declared size larger than the data",
      [{ name: "t", data: "hello", uncompressedSize: 6 }],
      "zip-size-mismatch",
    ],
    [
      "a declared size smaller than the data",
      [{ name: "t", data: "hello", uncompressedSize: 4 }],
      "zip-size-mismatch",
    ],
    [
      "a local header naming another file",
      [{ name: "t", data: "x", localName: "u" }],
      "zip-local-header-mismatch",
    ],
    [
      "a stored entry whose sizes differ",
      [{ name: "t", data: "hello", method: 0, uncompressedSize: 3 }],
      "zip-size-mismatch",
    ],
    [
      "a truncated deflate stream",
      [{ name: "t", data: "hello world ".repeat(50), truncateTo: 5 }],
      "zip-inflate-error",
    ],
    [
      "compressed data that runs into the central directory",
      [{ name: "t", data: "hello", compressedSize: 4000 }],
      "zip-truncated",
    ],
  ];

  for (const [label, entries, code] of fatal) {
    it(`fails on ${label}`, async () => {
      expect(await failureCode(readNamed(buildZip(entries), "t"))).toBe(code);
    });
  }

  it("stops inflating at maxUncompressedBytes without trusting the declared size", async () => {
    const big = "A".repeat(200_000);
    const bytes = buildZip([{ name: "t", data: big, uncompressedSize: 10 }]);
    const limits = { ...LIMITS, maxUncompressedBytes: 50_000 };
    // Either cap may trip first depending on chunk sizes; both stop inflation.
    expect(["limit-uncompressed", "zip-size-mismatch"]).toContain(
      await failureCode(readNamed(bytes, "t", limits)),
    );
  });

  it("refuses before inflating when the declared size alone exceeds the budget", async () => {
    const bytes = buildZip([{ name: "t", data: "A".repeat(1000) }]);
    const limits = { ...LIMITS, maxUncompressedBytes: 999 };
    expect(await failureCode(readNamed(bytes, "t", limits))).toBe("limit-uncompressed");
  });

  it("reports cancellation while inflating", async () => {
    const bytes = buildZip([{ name: "t", data: "B".repeat(2_000_000) }]);
    const blob = zipBlob(bytes);
    const controller = new AbortController();
    const g = new Guard(LIMITS, controller.signal, () => 0);
    const dir = await readZipDirectory(blob, g);
    const entry = dir.entries[0];
    if (entry === undefined) {
      throw new Error("entry missing");
    }
    controller.abort();
    expect(await failureCode(readEntry(blob, dir, entry, g))).toBe("cancelled");
  });
});
