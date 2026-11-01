import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  isNavigationKey,
  moveActive,
  scrollToReveal,
  visibleRange,
} from "../../browse/listNavigation";
import type { DateField, SearchHit } from "../../browse/search";
import { coverageLabel, dateLabel, SOURCE_LABEL, titleOf } from "./format";

export const ROW_HEIGHT = 56;
const OVERSCAN = 6;

export function rowDomId(conversationId: string): string {
  return `conversation-${conversationId}`;
}

function rowLabel(hit: SearchHit, field: DateField): string {
  const r = hit.record;
  return [
    titleOf(r),
    dateLabel(r, field),
    SOURCE_LABEL,
    coverageLabel(r.observation.contentCoverage),
  ]
    .join("、")
    .replace(/[△×] /g, "");
}

function Row({
  hit,
  index,
  count,
  active,
  field,
  onPick,
}: {
  hit: SearchHit;
  index: number;
  count: number;
  active: boolean;
  field: DateField;
  onPick: (index: number) => void;
}) {
  const r = hit.record;
  return (
    // The listbox owns keyboard handling (aria-activedescendant); rows take clicks only.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the listbox
    // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant
    <div
      role="option"
      id={rowDomId(r.conversationId)}
      aria-selected={active}
      aria-setsize={count}
      aria-posinset={index + 1}
      aria-label={rowLabel(hit, field)}
      className={active ? "row row-active" : "row"}
      style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
      onClick={() => onPick(index)}
    >
      <span className="row-lead" />
      <span className="row-main">
        <span className="row-title">{titleOf(r)}</span>
        <span className="row-sub">
          {dateLabel(r, field)}
          {hit.dateUnknown && "（日時の条件の対象外）"} ・ {SOURCE_LABEL} ・{" "}
          {coverageLabel(r.observation.contentCoverage)}
        </span>
      </span>
      <span className="row-trail" />
    </div>
  );
}

/**
 * Virtualized ARIA listbox (P-0006 item 6). DOM focus stays on the listbox;
 * the active row is announced through aria-activedescendant and is always
 * rendered, even when scrolled out of the window.
 */
export const ConversationList = forwardRef<
  HTMLDivElement,
  {
    readonly hits: readonly SearchHit[];
    readonly activeIndex: number | null;
    readonly field: DateField;
    readonly label: string;
    readonly onActiveChange: (index: number | null) => void;
    readonly onOpen: (index: number) => void;
  }
>(function ConversationList({ hits, activeIndex, field, label, onActiveChange, onOpen }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(560);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (el === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (el === null || activeIndex === null) {
      return;
    }
    const next = scrollToReveal(activeIndex, el.scrollTop, el.clientHeight, ROW_HEIGHT);
    if (next !== null) {
      el.scrollTop = next;
    }
  }, [activeIndex]);

  const { start, end } = visibleRange({
    scrollTop,
    viewportHeight: height,
    rowHeight: ROW_HEIGHT,
    count: hits.length,
    overscan: OVERSCAN,
  });
  const indices = Array.from({ length: end - start }, (_, i) => start + i);
  if (
    activeIndex !== null &&
    activeIndex < hits.length &&
    (activeIndex < start || activeIndex >= end)
  ) {
    indices.push(activeIndex);
  }
  const active = activeIndex === null ? undefined : hits[activeIndex];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isNavigationKey(event.key)) {
      event.preventDefault();
      const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
      onActiveChange(moveActive(activeIndex, event.key, hits.length, page));
    } else if (event.key === "Enter" && activeIndex !== null && active !== undefined) {
      // Enter only opens the preview; it never confirms anything (AT33).
      event.preventDefault();
      onOpen(activeIndex);
    }
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={
        active === undefined ? undefined : rowDomId(active.record.conversationId)
      }
      tabIndex={0}
      className="list"
      onKeyDown={onKeyDown}
    >
      <div
        ref={viewport}
        className="list-viewport"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="list-spacer" style={{ height: `${hits.length * ROW_HEIGHT}px` }}>
          {indices.map((index) => {
            const hit = hits[index] as SearchHit;
            return (
              <Row
                key={hit.record.conversationId}
                hit={hit}
                index={index}
                count={hits.length}
                active={index === activeIndex}
                field={field}
                onPick={(i) => {
                  onActiveChange(i);
                  onOpen(i);
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});
