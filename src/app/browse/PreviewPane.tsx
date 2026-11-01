import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type BranchIndex, createBranchIndex } from "../../browse/branches";
import type { SearchHit } from "../../browse/search";
import type { ConversationNode, ConversationRecord } from "../../import/types";
import type { KeepView } from "../keep/keepView";
import {
  coverageLabel,
  dateLabel,
  formatDateTime,
  ROLE_LABELS,
  SOURCE_LABEL,
  titleOf,
} from "./format";

/**
 * One message, rendered only as text nodes (AT09): no HTML parsing, no
 * Markdown, no links, no images.
 */
function MessageItem({ node, matched }: { node: ConversationNode; matched: boolean }) {
  const message = node.message;
  if (message === null) {
    return (
      <li className="message message-empty">
        <p className="note">（内容のないノード）</p>
      </li>
    );
  }
  const time = formatDateTime(message.createdAt);
  return (
    <li className={matched ? "message message-matched" : "message"}>
      <p className="message-meta">
        <span className="message-role">{ROLE_LABELS[message.role]}</span>
        {time !== null && <span> {time}</span>}
        {matched && <span> ・ 検索語を含む</span>}
      </p>
      {message.text !== "" && <div className="message-text">{message.text}</div>}
      {message.contentCoverage === "partial" && (
        <p className="note">（この発言は一部のみ取り込まれています）</p>
      )}
      {message.contentCoverage === "none" && (
        <p className="note">（この発言の内容は取り込まれていません）</p>
      )}
    </li>
  );
}

function branchLabel(
  branches: BranchIndex,
  end: string,
  index: number,
  matchedEnds: ReadonlySet<string>,
) {
  const current = branches.currentKnown && end === branches.defaultEnd ? "（現在）" : "";
  return `ブランチ ${index + 1}${current}${matchedEnds.has(end) ? "・一致あり" : ""}`;
}

/**
 * KEEP toggle with a fixed accessible name and aria-pressed for its state
 * (P-0007 item 10). Outside `available` it is focusable but inert and says why.
 */
function KeepButton({ record, keep }: { record: ConversationRecord; keep: KeepView }) {
  const describedBy = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const kept = keep.isKept(record);
  const blocked = keep.blockedReason;
  return (
    <span className="keep-toggle">
      <button
        type="button"
        aria-pressed={kept === true}
        aria-disabled={blocked !== null || busy}
        aria-describedby={describedBy}
        onClick={async () => {
          if (blocked !== null || busy || kept === null) {
            return;
          }
          setBusy(true);
          const result = await keep.toggle(record, !kept);
          setBusy(false);
          setMessage(
            result === "ok"
              ? { text: kept ? "KEEP を外しました。" : "KEEP に追加しました。", alert: false }
              : {
                  text: "KEEP を更新できませんでした。左のパネルを確認してください。",
                  alert: true,
                },
          );
        }}
      >
        KEEP
      </button>
      <span id={describedBy} className="note" role={message?.alert === true ? "alert" : "status"}>
        {blocked ?? message?.text ?? (kept === true ? "付けています" : "付けていません")}
      </span>
    </span>
  );
}

export function PreviewPane({
  record,
  hit,
  keep,
  onClose,
}: {
  readonly record: ConversationRecord;
  readonly hit: SearchHit | null;
  readonly keep?: KeepView | undefined;
  readonly onClose: () => void;
}) {
  const headingId = useId();
  const branchId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const branches = useMemo(() => createBranchIndex(record), [record]);
  const matched = useMemo(() => new Set(hit?.matchedNodeIds ?? []), [hit]);
  const matchedEnds = useMemo(() => branches.endsThrough(matched), [branches, matched]);
  const ends = branches.ends;
  const [end, setEnd] = useState<string | null>(branches.defaultEnd);
  const branch = end === null ? null : branches.path(end);
  // Structural roots without a message (the export's empty root) are not shown.
  const nodes = (branch?.nodes ?? []).filter((n) => !(n.parentId === null && n.message === null));

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="preview"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="preview-header">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="preview-title">
          {titleOf(record)}
        </h2>
        <p className="preview-meta">
          {dateLabel(record, "createdAt")} ・ {dateLabel(record, "updatedAt")} ・ {SOURCE_LABEL} ・{" "}
          {coverageLabel(record.observation.contentCoverage)}
          {ends.length > 1 && ` ・ 分岐 ${ends.length} 本`}
        </p>
        <div className="preview-actions">
          {keep !== undefined && <KeepButton record={record} keep={keep} />}
          <button type="button" onClick={onClose}>
            プレビューを閉じる
          </button>
        </div>
      </header>
      {ends.length > 1 && (
        <p className="preview-branch">
          <label htmlFor={branchId}>ブランチ </label>
          <select id={branchId} value={end ?? ""} onChange={(e) => setEnd(e.currentTarget.value)}>
            {ends.map((e, i) => (
              <option key={e} value={e}>
                {branchLabel(branches, e, i, matchedEnds)}
              </option>
            ))}
          </select>
        </p>
      )}
      {ends.length > 0 && !branches.currentKnown && end === branches.defaultEnd && (
        <p className="note">
          現在のブランチを特定できませんでした。最初のブランチを表示しています。
        </p>
      )}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the message region scrolls and must be reachable by keyboard */}
      <ol className="messages" aria-label="メッセージ" tabIndex={0}>
        {nodes.map((node) => (
          <MessageItem key={node.id} node={node} matched={matched.has(node.id)} />
        ))}
      </ol>
      {nodes.length === 0 && <p className="note">この会話にはメッセージがありません。</p>}
    </section>
  );
}
