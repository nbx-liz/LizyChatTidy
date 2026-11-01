import { describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_LIMITS } from "./types";
import { parseStartMessage } from "./workerProtocol";

const file = new Blob(["x"]);

describe("parseStartMessage", () => {
  it("accepts a well-formed start message", () => {
    expect(parseStartMessage({ kind: "start", file, limits: DEFAULT_IMPORT_LIMITS })).toEqual({
      file,
      limits: DEFAULT_IMPORT_LIMITS,
    });
  });

  const rejected: ReadonlyArray<[string, unknown]> = [
    ["null", null],
    ["a wrong kind", { kind: "begin", file, limits: DEFAULT_IMPORT_LIMITS }],
    ["an extra key", { kind: "start", file, limits: DEFAULT_IMPORT_LIMITS, x: 1 }],
    ["a file that is not a Blob", { kind: "start", file: "path", limits: DEFAULT_IMPORT_LIMITS }],
    [
      "a missing limit",
      { kind: "start", file, limits: { ...DEFAULT_IMPORT_LIMITS, maxMillis: undefined } },
    ],
    ["an extra limit", { kind: "start", file, limits: { ...DEFAULT_IMPORT_LIMITS, maxFoo: 1 } }],
    ["a zero limit", { kind: "start", file, limits: { ...DEFAULT_IMPORT_LIMITS, maxEntries: 0 } }],
    [
      "a fractional limit",
      { kind: "start", file, limits: { ...DEFAULT_IMPORT_LIMITS, maxJsonDepth: 1.5 } },
    ],
    [
      "an infinite limit",
      { kind: "start", file, limits: { ...DEFAULT_IMPORT_LIMITS, maxMillis: Infinity } },
    ],
  ];

  for (const [label, data] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseStartMessage(data)).toBeNull();
    });
  }
});
