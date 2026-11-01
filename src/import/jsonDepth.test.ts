import { describe, expect, it } from "vitest";
import { jsonDepthExceeds } from "./jsonDepth";

describe("jsonDepthExceeds", () => {
  it("counts real nesting of arrays and objects", () => {
    expect(jsonDepthExceeds("[[[1]]]", 3)).toBe(false);
    expect(jsonDepthExceeds("[[[1]]]", 2)).toBe(true);
    expect(jsonDepthExceeds('{"a":{"b":[{}]}}', 4)).toBe(false);
    expect(jsonDepthExceeds('{"a":{"b":[{}]}}', 3)).toBe(true);
  });

  it("ignores brackets inside strings", () => {
    expect(jsonDepthExceeds('["[[[[{{{{"]', 1)).toBe(false);
  });

  it("does not end a string at an escaped quote", () => {
    expect(jsonDepthExceeds('["\\"[[[[", 1]', 1)).toBe(false);
    expect(jsonDepthExceeds('["\\\\", [[1]]]', 2)).toBe(true);
  });

  it("measures sibling containers by depth, not by count", () => {
    expect(jsonDepthExceeds("[[],[],[],[],[]]", 2)).toBe(false);
  });

  it("detects deep nesting that would overflow a recursive walk", () => {
    const deep = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
    expect(jsonDepthExceeds(deep, 64)).toBe(true);
  });
});
