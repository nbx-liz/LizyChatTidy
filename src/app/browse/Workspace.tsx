import { type ReactNode, useDeferredValue, useMemo, useRef, useState } from "react";
import { createIndexCache, type SearchHit, type SearchOutcome, search } from "../../browse/search";
import type { ConversationRecord } from "../../import/types";
import type { KeepView } from "../keep/keepView";
import { ConversationList } from "./ConversationList";
import { dateCondition } from "./dateCondition";
import { PreviewPane } from "./PreviewPane";
import { type Bucket, INITIAL_FORM, type SearchForm, SearchPane } from "./SearchPane";

function hitsFor(outcome: SearchOutcome, bucket: Bucket, querying: boolean): readonly SearchHit[] {
  if (!querying) {
    return outcome.matches;
  }
  return bucket === "match"
    ? outcome.matches
    : bucket === "unknown"
      ? outcome.unknown
      : outcome.noMatch;
}

function emptyMessage(total: number, bucket: Bucket, querying: boolean): string {
  if (total === 0) {
    return "取り込んだ会話はありません。";
  }
  if (querying && bucket === "unknown") {
    return "判定不能の会話はありません。";
  }
  return "条件に合う会話はありません。";
}

/**
 * The three-pane workspace (BLUEPRINT §8, P-0006). Remounted per import
 * revision by the caller, so the active row, the preview and the index never
 * outlive the import they came from.
 */
export function Workspace({
  records,
  revision,
  keep,
  keepPanel,
}: {
  readonly records: readonly ConversationRecord[];
  readonly revision: number;
  readonly keep: KeepView;
  /** The KEEP store panel, shown at the top of the left pane (P-0007 item 10). */
  readonly keepPanel: ReactNode;
}) {
  const [form, setForm] = useState<SearchForm>(INITIAL_FORM);
  const deferredText = useDeferredValue(form.text);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const indexOf = useMemo(() => createIndexCache(), []);

  // An invalid or reversed range is not applied at all and is shown as an error.
  const condition = dateCondition(form);
  const fromMs = condition.status === "active" ? condition.fromMs : null;
  const toMs = condition.status === "active" ? condition.toMs : null;
  const dateError =
    condition.status === "invalid" || condition.status === "reversed" ? condition.status : null;
  const outcome = useMemo(
    () =>
      search(indexOf(records, revision), {
        text: deferredText,
        dateField: form.dateField,
        fromMs,
        toMs,
        includeUnknownDates: form.includeUnknownDates,
      }),
    [
      indexOf,
      records,
      revision,
      deferredText,
      form.dateField,
      fromMs,
      toMs,
      form.includeUnknownDates,
    ],
  );
  const querying = deferredText.trim() !== "";
  const hits = hitsFor(outcome, form.bucket, querying);
  const openHit =
    openId === null ? null : (hits.find((h) => h.record.conversationId === openId) ?? null);
  const dateActive = condition.status === "active";

  const closePreview = () => {
    setOpenId(null);
    listRef.current?.focus();
  };

  return (
    <div className="workspace">
      <div className="left-pane">
        {keepPanel}
        <SearchPane
          form={form}
          counts={{
            match: outcome.matches.length,
            "no-match": outcome.noMatch.length,
            unknown: outcome.unknown.length,
          }}
          dateError={dateError}
          onChange={(next) => {
            setForm(next);
            setActiveIndex(null);
          }}
        />
      </div>
      <section className="list-pane" aria-labelledby="list-heading">
        <h2 id="list-heading" className="list-heading">
          取得済み {outcome.total} 件 / 全件数不明（表示 {hits.length} 件）
        </h2>
        {keep.blockedReason !== null && (
          <p className="notice">KEEP を確認できないため、一覧に KEEP の印を出していません。</p>
        )}
        {dateActive && outcome.dateUnknownExcluded > 0 && (
          <p className="notice">
            日時不明の会話 {outcome.dateUnknownExcluded} 件は、日時の条件から除外しています。
          </p>
        )}
        {hits.length === 0 ? (
          <p className="empty">{emptyMessage(outcome.total, form.bucket, querying)}</p>
        ) : (
          <ConversationList
            ref={listRef}
            hits={hits}
            activeIndex={activeIndex !== null && activeIndex < hits.length ? activeIndex : null}
            field={form.dateField}
            isKept={keep.isKept}
            label="会話一覧"
            onActiveChange={setActiveIndex}
            onOpen={(index) => setOpenId(hits[index]?.record.conversationId ?? null)}
            onEscape={openHit === null ? undefined : closePreview}
          />
        )}
      </section>
      <div className="preview-pane">
        {openHit === null ? (
          <p className="empty">会話を選ぶと、ここに内容を表示します。</p>
        ) : (
          <PreviewPane
            key={openHit.record.conversationId}
            record={openHit.record}
            hit={querying ? openHit : null}
            keep={keep}
            onClose={closePreview}
          />
        )}
      </div>
      <footer className="status-bar" role="status" aria-live="polite">
        {querying
          ? `一致 ${outcome.matches.length} 件 / 不一致 ${outcome.noMatch.length} 件 / 判定不能 ${outcome.unknown.length} 件`
          : `表示 ${hits.length} 件`}
        {dateActive &&
          ` ・ 日時の範囲外 ${outcome.dateOutOfRange} 件 ・ 日時不明で除外 ${outcome.dateUnknownExcluded} 件`}
        <span className="keep-count">
          {" ・ "}
          {keep.count === null ? "KEEP 未確認" : `KEEP ${keep.count} 件`}
        </span>
      </footer>
    </div>
  );
}
