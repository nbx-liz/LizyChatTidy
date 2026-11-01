// Display helpers for the workspace. Dates are shown in the viewer's local time.
import type { DateField } from "../../browse/search";
import type { ContentCoverage, ConversationRecord, MessageRole } from "../../import/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm" in local time, or null for a missing or unparseable value. */
export function formatDateTime(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Converts an <input type="date"> value to the first (or last) millisecond of
 * that local day. Returns null for an empty or invalid value.
 */
export function localDayBound(value: string, edge: "start" | "end"): number | null {
  const m = DATE_INPUT.exec(value);
  if (m === null) {
    return null;
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = new Date(y, mo - 1, d);
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) {
    return null;
  }
  return edge === "start" ? start.getTime() : new Date(y, mo - 1, d + 1).getTime() - 1;
}

export const DATE_FIELD_LABELS: Readonly<Record<DateField, string>> = {
  createdAt: "作成",
  updatedAt: "更新",
};

export function titleOf(record: ConversationRecord): string {
  return record.title === null || record.title === "" ? "（無題）" : record.title;
}

export function dateLabel(record: ConversationRecord, field: DateField): string {
  const formatted = formatDateTime(record[field]);
  return formatted === null ? "日時不明" : `${DATE_FIELD_LABELS[field]} ${formatted}`;
}

/** Body coverage as symbol and text, never colour alone. */
export function coverageLabel(coverage: ContentCoverage): string {
  switch (coverage) {
    case "complete":
      return "本文: 全文";
    case "partial":
      return "△ 本文: 一部のみ";
    case "none":
      return "× 本文: 未取得";
  }
}

export const ROLE_LABELS: Readonly<Record<MessageRole, string>> = {
  user: "あなた",
  assistant: "ChatGPT",
  system: "システム",
  tool: "ツール",
  unknown: "不明",
};

export const SOURCE_LABEL = "公式エクスポート";
