import type { ImportIssueCode, ImportResult } from "../import/types";

export const ISSUE_LABELS: Readonly<Record<ImportIssueCode, string>> = {
  "not-zip": "ZIP ファイルではありません",
  "zip-unsupported-layout":
    "対応していない ZIP の構成です（先頭や中央ディレクトリの前後に余分なデータ）",
  "zip-zip64": "ZIP64 形式には対応していません",
  "zip-multi-disk": "分割された ZIP には対応していません",
  "zip-truncated": "ZIP が途中で切れています",
  "zip-bad-directory": "ZIP の中央ディレクトリが壊れています",
  "zip-duplicate-entry": "同じ名前のファイルが ZIP 内に複数あります",
  "zip-encrypted": "暗号化された ZIP には対応していません",
  "zip-unsupported-method": "対応していない圧縮方式です",
  "zip-local-header-mismatch": "ZIP 内のファイル情報が一致しません",
  "zip-size-mismatch": "展開後の大きさが宣言と一致しません",
  "zip-crc-mismatch": "ファイルの検査値（CRC）が一致しません",
  "zip-inflate-error": "展開に失敗しました",
  "limit-compressed": "ファイルが大きすぎます（圧縮後の上限を超過）",
  "limit-uncompressed": "展開後の大きさが上限を超えました",
  "limit-entries": "ZIP 内のファイル数が上限を超えました",
  "limit-json-depth": "JSON の入れ子が深すぎます",
  "limit-time": "処理時間の上限を超えました",
  "missing-conversations": "conversations.json が見つかりません",
  "json-syntax": "conversations.json の構文が正しくありません",
  "json-encoding": "conversations.json が UTF-8 ではありません",
  "not-conversation-array": "conversations.json が会話の配列ではありません",
  "worker-error": "取り込み処理が異常終了しました",
  cancelled: "中止しました",
  "unknown-entry": "未知のファイル（解析していません）",
  "not-object": "会話の形式ではありません",
  "missing-id": "会話 ID がありません",
  "invalid-id": "会話 ID の形式が想定外です",
  "id-mismatch": "会話 ID が 2 つあり一致しません",
  "duplicate-id": "同じ会話 ID が複数あります",
  "invalid-field": "項目の型が想定外です（不明として扱います）",
  "invalid-time": "日時の値が想定外です（日時不明として扱います）",
  "invalid-tree": "会話の分岐構造が壊れています",
};

const STATUS_LABELS: Readonly<Record<ImportResult["status"], string>> = {
  complete: "完了",
  partial: "一部のみ（問題のある項目を除いて取り込み）",
  failed: "失敗（何も取り込んでいません）",
  cancelled: "中止（何も取り込んでいません）",
};

export function describeResult(result: ImportResult): string {
  const base = `${STATUS_LABELS[result.status]}: 取り込み済み ${result.records.length} 件`;
  // The export says nothing about the account's total (INV-14).
  return `${base} / アカウント上の全件数は不明`;
}
