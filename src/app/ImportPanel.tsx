import type { ImportController, ImportSession } from "../import/controller";
import { canPlanDeletionFrom } from "../import/results";
import { describeResult, ISSUE_LABELS } from "./importLabels";

const MAX_LISTED_ISSUES = 200;

/**
 * Official ChatGPT export import (DEV05). Shows status, counts, listed issues
 * and the shape-only structure report; conversation content is shown by the
 * workspace (DEV07).
 */
export function ImportPanel({
  session,
  controller,
}: {
  readonly session: ImportSession;
  readonly controller: ImportController;
}) {
  const result = session.result;
  return (
    <section aria-labelledby="import-heading" className="import-panel">
      <h2 id="import-heading">ChatGPT の公式エクスポートを取り込む</h2>
      <p>
        ファイルはこの端末の中だけで読み取ります。外部へは送信しません。本文は保存せず、この画面を閉じると消えます。
      </p>
      <label>
        エクスポートの ZIP ファイル{" "}
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) {
              controller.begin(file);
            }
          }}
        />
      </label>
      {session.running && (
        <button type="button" onClick={() => controller.cancel()}>
          取り込みを中止
        </button>
      )}
      <p role="status">
        {session.running
          ? "取り込んでいます…"
          : result === null
            ? "未取り込み"
            : describeResult(result)}
      </p>
      {result !== null && !session.running && (
        <>
          {!canPlanDeletionFrom(result) && (
            <p>この取り込みの結果は閲覧と KEEP にだけ使えます（削除計画の候補にはなりません）。</p>
          )}
          {result.issues.length > 0 && (
            <>
              <h3>問題のある項目（{result.issues.length} 件）</h3>
              <ul>
                {result.issues.slice(0, MAX_LISTED_ISSUES).map((issue, index) => (
                  // Issues have no identity of their own; their order is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable, never reordered
                  <li key={index}>
                    {ISSUE_LABELS[issue.code]}
                    {issue.entry !== null && `（${issue.entry}）`}
                  </li>
                ))}
              </ul>
              {result.issues.length > MAX_LISTED_ISSUES && (
                <p>ほか {result.issues.length - MAX_LISTED_ISSUES} 件</p>
              )}
            </>
          )}
          <details>
            <summary>構造レポート（本文・タイトル・ID を含みません）</summary>
            <pre>{JSON.stringify(result.report, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
