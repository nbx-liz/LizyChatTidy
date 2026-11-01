import { describe, expect, it } from "vitest";
import { dateCondition } from "./dateCondition";

const empty = { from: "", to: "", fromInvalid: false, toInvalid: false };

describe("dateCondition", () => {
  it("is none without bounds", () => {
    expect(dateCondition(empty)).toEqual({ status: "none" });
  });

  it("uses inclusive local-day bounds", () => {
    const c = dateCondition({ ...empty, from: "2026-03-01", to: "2026-03-31" });
    expect(c).toEqual({
      status: "active",
      fromMs: new Date(2026, 2, 1).getTime(),
      toMs: new Date(2026, 3, 1).getTime() - 1,
    });
  });

  it("allows one open side", () => {
    expect(dateCondition({ ...empty, to: "2026-03-31" })).toMatchObject({
      status: "active",
      fromMs: null,
    });
  });

  it("refuses to filter when the browser reports an invalid input, even with an empty value (PR #7 review)", () => {
    expect(dateCondition({ ...empty, to: "2026-03-31", fromInvalid: true })).toEqual({
      status: "invalid",
    });
    expect(dateCondition({ ...empty, from: "2026-03-01", toInvalid: true })).toEqual({
      status: "invalid",
    });
  });

  it("refuses impossible or malformed date strings", () => {
    expect(dateCondition({ ...empty, from: "2026-02-30" })).toEqual({ status: "invalid" });
    expect(dateCondition({ ...empty, to: "31/03/2026" })).toEqual({ status: "invalid" });
  });

  it("reports a reversed range", () => {
    expect(dateCondition({ ...empty, from: "2026-04-01", to: "2026-03-01" })).toEqual({
      status: "reversed",
    });
  });
});
