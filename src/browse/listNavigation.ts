// Pure helpers for the virtualized, keyboard-operable conversation list.

export interface WindowInput {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly count: number;
  readonly overscan: number;
}

/** Half-open [start, end) of rows to render. */
export function visibleRange(input: WindowInput): { start: number; end: number } {
  const { scrollTop, viewportHeight, rowHeight, count, overscan } = input;
  if (count === 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.min(count, first + visible + overscan);
  return { start: Math.min(start, end), end };
}

/** The scrollTop that brings row `index` fully into view, or null when it already is. */
export function scrollToReveal(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) {
    return top;
  }
  if (bottom > scrollTop + viewportHeight) {
    return Math.max(0, bottom - viewportHeight);
  }
  return null;
}

export type NavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "PageDown" | "PageUp";

const KEYS: ReadonlySet<string> = new Set<NavigationKey>([
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "PageDown",
  "PageUp",
]);

export function isNavigationKey(key: string): key is NavigationKey {
  return KEYS.has(key);
}

/** Next active row for a key; null when the list is empty. Never wraps around. */
export function moveActive(
  active: number | null,
  key: NavigationKey,
  count: number,
  pageSize: number,
): number | null {
  if (count === 0) {
    return null;
  }
  const last = count - 1;
  const current = active === null ? -1 : Math.min(active, last);
  const page = Math.max(1, pageSize);
  switch (key) {
    case "ArrowDown":
      return Math.min(last, current + 1);
    case "ArrowUp":
      return current < 0 ? 0 : Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(last, Math.max(0, current) + page);
    case "PageUp":
      return Math.max(0, current - page);
  }
}
