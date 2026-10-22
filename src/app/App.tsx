import { useState } from "react";
import type { Provider } from "../shared/origins";
import { chromeApi } from "./chromeApi";
import { type ConnectResult, connect } from "./controller";

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

  const onConnect = async () => {
    setState({ phase: "busy" });
    setState(await connect(chromeApi, targetTabId));
  };

  return (
    <main>
      <h1>LizyChatTidy</h1>
      <p role="status">{describe(state)}</p>
      <button
        type="button"
        onClick={onConnect}
        disabled={"phase" in state && state.phase === "busy"}
      >
        対象のタブに接続
      </button>
    </main>
  );
}
