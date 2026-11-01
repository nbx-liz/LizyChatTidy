import { useId } from "react";
import type { DateField } from "../../browse/search";

export type Bucket = "match" | "no-match" | "unknown";

export interface SearchForm {
  readonly text: string;
  readonly dateField: DateField;
  readonly from: string;
  readonly to: string;
  readonly includeUnknownDates: boolean;
  readonly bucket: Bucket;
}

export const INITIAL_FORM: SearchForm = {
  text: "",
  dateField: "updatedAt",
  from: "",
  to: "",
  includeUnknownDates: false,
  bucket: "match",
};

export interface BucketCounts {
  readonly match: number;
  readonly "no-match": number;
  readonly unknown: number;
}

const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
  match: "一致",
  "no-match": "不一致",
  unknown: "判定不能",
};

export function SearchPane({
  form,
  counts,
  rangeError,
  onChange,
}: {
  readonly form: SearchForm;
  readonly counts: BucketCounts;
  readonly rangeError: boolean;
  readonly onChange: (form: SearchForm) => void;
}) {
  const ids = {
    text: useId(),
    help: useId(),
    field: useId(),
    from: useId(),
    to: useId(),
    err: useId(),
  };
  const set = (patch: Partial<SearchForm>) => onChange({ ...form, ...patch });
  const querying = form.text.trim() !== "";
  return (
    <aside className="search-pane" aria-label="検索と絞り込み">
      <p className="service">サービス: ChatGPT</p>
      <label htmlFor={ids.text}>検索（タイトルと取得済みの本文）</label>
      <input
        id={ids.text}
        type="search"
        placeholder="キーワード"
        value={form.text}
        aria-describedby={ids.help}
        onChange={(e) => set({ text: e.currentTarget.value, bucket: "match" })}
      />
      <p id={ids.help} className="help">
        取得済みの本文だけを検索します。一部しか取得していない会話は「判定不能」になることがあります。
      </p>
      {querying && (
        <fieldset className="buckets">
          <legend>検索結果の区分</legend>
          {(Object.keys(BUCKET_LABELS) as Bucket[]).map((bucket) => (
            <label key={bucket} className="bucket">
              <input
                type="radio"
                name="bucket"
                value={bucket}
                checked={form.bucket === bucket}
                onChange={() => set({ bucket })}
              />
              {BUCKET_LABELS[bucket]} {counts[bucket]} 件
              {bucket === "unknown" && "（本文が一部のみで、一致なし）"}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="dates">
        <legend>日時で絞り込み</legend>
        <label htmlFor={ids.field}>対象の日時</label>
        <select
          id={ids.field}
          value={form.dateField}
          onChange={(e) => set({ dateField: e.currentTarget.value as DateField })}
        >
          <option value="updatedAt">更新日時</option>
          <option value="createdAt">作成日時</option>
        </select>
        <label htmlFor={ids.from}>開始日</label>
        <input
          id={ids.from}
          type="date"
          value={form.from}
          aria-describedby={rangeError ? ids.err : undefined}
          onChange={(e) => set({ from: e.currentTarget.value })}
        />
        <label htmlFor={ids.to}>終了日</label>
        <input
          id={ids.to}
          type="date"
          value={form.to}
          aria-describedby={rangeError ? ids.err : undefined}
          onChange={(e) => set({ to: e.currentTarget.value })}
        />
        {rangeError && (
          <p id={ids.err} className="error" role="alert">
            開始日が終了日より後です。日時の条件は適用していません。
          </p>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={form.includeUnknownDates}
            onChange={(e) => set({ includeUnknownDates: e.currentTarget.checked })}
          />
          日時不明の会話を表示
        </label>
        <button type="button" onClick={() => set({ from: "", to: "", includeUnknownDates: false })}>
          日時の条件をクリア
        </button>
      </fieldset>
    </aside>
  );
}
