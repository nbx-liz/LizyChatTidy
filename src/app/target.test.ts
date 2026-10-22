import { describe, expect, it } from "vitest";
import { targetTabIdFrom } from "./target";

describe("targetTabIdFrom", () => {
  it("reads a decimal tab ID", () => {
    expect(targetTabIdFrom("?target=42")).toBe(42);
  });

  it.each([
    ["missing", ""],
    ["empty", "?target="],
    ["negative", "?target=-1"],
    ["fraction", "?target=1.5"],
    ["exponent", "?target=1e3"],
    ["hex", "?target=0x10"],
    ["trailing text", "?target=42abc"],
    ["too long", "?target=1234567890123456"],
  ])("rejects %s", (_label, search) => {
    expect(targetTabIdFrom(search)).toBeNull();
  });
});
