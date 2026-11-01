import { useState } from "react";
import type { Provider } from "../shared/origins";
import { Workspace } from "./browse/Workspace";
import { chromeApi } from "./chromeApi";
import { type ConnectResult, connect } from "./controller";
import { ImportPanel } from "./ImportPanel";
import { describeResult } from "./importLabels";
import { chromeKeepDeps } from "./keep/chromeKeep";
import { KeepPanel } from "./keep/KeepPanel";
import { keepViewOf } from "./keep/keepView";
import { useKeepStore } from "./keep/useKeepStore";
import { useImportSession } from "./useImportSession";

const PROVIDER_LABELS: Readonly<Record<Provider, string>> = {
  chatgpt: "ChatGPT",
  "claude-code": "Claude Code on the web",
};

type ViewState = { readonly phase: "idle" } | { readonly phase: "busy" } | ConnectResult;

function describe(state: ViewState): string {
  if ("phase" in state) {
    return state.phase === "busy" ? "接続しています…" : "未接続";
  }
  switch (state.status) {
    case "connected":
      return `接続済み: ${PROVIDER_LABELS[state.provider]}`;
    case "no-target":
      return "対象のタブがありません。ChatGPT または Claude Code on the web のタブで拡張のアイコンを押してください。";
    case "no-access":
      return "対象のタブにアクセスできません。対象のタブで拡張のアイコンを押し直してください。";
    case "unsupported-page":
      return "対象のタブは対応ページではありません（ChatGPT または claude.ai/code）。";
    case "failed":
      return `接続できませんでした（${state.reason}）。`;
  }
}

export function App({ targetTabId }: { readonly targetTabId: number | null }) {
  const [state, setState] = useState<ViewState>({ phase: "idle" });
  const { session, controller } = useImportSession();
  const keepStore = useKeepStore(chromeKeepDeps);
  const keep = keepViewOf(keepStore.state, (entry, on) => keepStore.store.setKeep(entry, on));
  const keepPanel = <KeepPanel store={keepStore.store} state={keepStore.state} />;
  // No content script is injected until storage access is restricted to the
  // extension (P-0007 item 1, KINV-8).
  const connectBlocked = !keepStore.store.accessRestricted;
  const result = session.result;
  // Keep the import section open until there is something to browse, and
  // whenever the latest import was not complete, so its issues stay in view.
  const importOpen = session.running || result === null || result.status !== "complete";

  const onConnect = async () => {
    setState({ phase: "busy" });
    setState(await connect(chromeApi, targetTabId));
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>LizyChatTidy</h1>
        <button
          type="button"
          onClick={onConnect}
          disabled={connectBlocked || ("phase" in state && state.phase === "busy")}
        >
          対象のタブに接続
        </button>
        <p role="status">
          {connectBlocked
            ? keepStore.state.status === "loading"
              ? "保存領域の設定を確認しています…"
              : "保存領域へのアクセスを拡張の内部に限定できないため、対象のタブに接続できません。"
            : describe(state)}
        </p>
      </header>
      <details className="import-section" open={importOpen}>
        <summary>
          取り込み
          {result !== null && !session.running && `: ${describeResult(result)}`}
          {result !== null && result.issues.length > 0 && ` ・ 問題 ${result.issues.length} 件`}
        </summary>
        <ImportPanel session={session} controller={controller} />
      </details>
      {result === null || session.running ? (
        <>
          <p className="empty">
            まだ取り込んでいません。上の「取り込み」からエクスポートの ZIP を選んでください。
          </p>
          <div className="standalone-keep">{keepPanel}</div>
        </>
      ) : (
        <Workspace
          key={session.revision}
          records={result.records}
          revision={session.revision}
          keep={keep}
          keepPanel={keepPanel}
        />
      )}
    </main>
  );
}
