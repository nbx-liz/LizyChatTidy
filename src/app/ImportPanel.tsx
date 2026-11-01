import { useEffect, useMemo, useState } from "react";
import { startImport, type WorkerLike } from "../import/client";
import { ImportController, type ImportSession } from "../import/controller";
import { canPlanDeletionFrom } from "../import/results";
import { DEFAULT_IMPORT_LIMITS } from "../import/types";
import { describeResult, ISSUE_LABELS } from "./importLabels";

const MAX_LISTED_ISSUES = 200;

function createWorker(): WorkerLike {
  const worker = new Worker(new URL("../import/worker.ts", import.meta.url), { type: "module" });
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (event) => like.onmessage?.({ data: event.data });
  worker.onerror = (event) => like.onerror?.(event);
  worker.onmessageerror = (event) => like.onerror?.(event);
  return like;
}

const browserTimers = {
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (id: number) => window.clearTimeout(id),
};

/**
 * Official ChatGPT export import (DEV05). Shows status, counts, listed issues
 * and the shape-only structure report; conversation content is shown by DEV07.
 */
export function ImportPanel() {
  const [session, setSession] = useState<ImportSession>({
    revision: 0,
    result: null,
    running: false,
  });
  const controller = useMemo(
    () =>
      new ImportController(
        (file) => startImport(file, DEFAULT_IMPORT_LIMITS, createWorker, browserTimers),
        setSession,
      ),
    [],
  );
  useEffect(() => () => controller.cancel(), [controller]);

  const result = session.result;
  return (
    <section aria-labelledby="import-heading">
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
