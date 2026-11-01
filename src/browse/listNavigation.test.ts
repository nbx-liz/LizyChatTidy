import { describe, expect, it } from "vitest";
import { isNavigationKey, moveActive, scrollToReveal, visibleRange } from "./listNavigation";

describe("visibleRange", () => {
  const base = { scrollTop: 0, viewportHeight: 560, rowHeight: 56, count: 10_000, overscan: 6 };

  it("renders the first screen plus overscan", () => {
    expect(visibleRange(base)).toEqual({ start: 0, end: 17 });
  });

  it("follows the scroll position", () => {
    expect(visibleRange({ ...base, scrollTop: 56 * 100 })).toEqual({ start: 94, end: 117 });
  });

  it("clamps at the tail", () => {
    expect(visibleRange({ ...base, scrollTop: 56 * 9_995 })).toEqual({ start: 9_989, end: 10_000 });
  });

  it("renders nothing for an empty list or a zero row height", () => {
    expect(visibleRange({ ...base, count: 0 })).toEqual({ start: 0, end: 0 });
    expect(visibleRange({ ...base, rowHeight: 0 })).toEqual({ start: 0, end: 0 });
  });

  it("tolerates negative scroll (overscroll)", () => {
    expect(visibleRange({ ...base, scrollTop: -40 }).start).toBe(0);
  });
});

describe("scrollToReveal", () => {
  it("scrolls up or down only as far as needed", () => {
    expect(scrollToReveal(0, 112, 560, 56)).toBe(0);
    expect(scrollToReveal(20, 0, 560, 56)).toBe(56 * 21 - 560);
    expect(scrollToReveal(3, 0, 560, 56)).toBeNull();
  });
});

describe("moveActive", () => {
  it("moves within bounds without wrapping", () => {
    expect(moveActive(null, "ArrowDown", 5, 3)).toBe(0);
    expect(moveActive(null, "ArrowUp", 5, 3)).toBe(0);
    expect(moveActive(4, "ArrowDown", 5, 3)).toBe(4);
    expect(moveActive(0, "ArrowUp", 5, 3)).toBe(0);
    expect(moveActive(2, "Home", 5, 3)).toBe(0);
    expect(moveActive(2, "End", 5, 3)).toBe(4);
    expect(moveActive(0, "PageDown", 5, 3)).toBe(3);
    expect(moveActive(3, "PageDown", 5, 3)).toBe(4);
    expect(moveActive(4, "PageUp", 5, 3)).toBe(1);
  });

  it("clamps an active index left over from a longer list", () => {
    expect(moveActive(9, "ArrowUp", 5, 3)).toBe(3);
  });

  it("returns null for an empty list", () => {
    expect(moveActive(0, "ArrowDown", 0, 3)).toBeNull();
  });

  it("recognises only the navigation keys", () => {
    expect(isNavigationKey("ArrowDown")).toBe(true);
    expect(isNavigationKey("Enter")).toBe(false);
  });
});
