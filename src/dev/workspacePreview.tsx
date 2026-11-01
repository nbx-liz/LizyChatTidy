// Development-only page for visual checks of the workspace with synthetic
// conversations (dev-workspace.html). It is not an entry of the extension
// build and never ships; all content is invented.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "../app/browse/Workspace";
import { KeepPanel } from "../app/keep/KeepPanel";
import { keepViewOf } from "../app/keep/keepView";
import { useKeepStore } from "../app/keep/useKeepStore";
import { memoryKeepDeps } from "./memoryKeepDeps";
import "../app/styles.css";
import { branchedNodes, linearNodes, record } from "../browse/testing/records";
import type { ConversationNode } from "../import/types";

function partialNodes(): ConversationNode[] {
  return linearNodes(["画像について質問します", ""]).map((n, i) =>
    i === 1 && n.message !== null
      ? { ...n, message: { ...n.message, contentCoverage: "none" as const } }
      : n,
  );
}

const count = Number(new URLSearchParams(location.search).get("count") ?? "40");
const records = [
  record({ title: "旅行の計画（京都・奈良）", texts: ["3 泊 4 日の旅程を考えて", "1 日目は…"] }),
  record({ title: null, updatedAt: null, texts: ["タイトルのない会話です"] }),
  record({
    title: "とても長いタイトルの会話。".repeat(8),
    texts: ["長いタイトルの表示を確認します", "了解しました。".repeat(80)],
  }),
  record({ title: "分岐のある会話", nodes: branchedNodes(), currentNodeId: "a2" }),
  record({ title: "一部だけ取り込まれた会話", nodes: partialNodes(), coverage: "partial" }),
  record({
    title: "危険な文字列を含む会話",
    texts: [
      "<script>alert(1)</script>",
      '<img src="https://example.invalid/x.png" onerror="alert(2)">',
    ],
  }),
  ...Array.from({ length: Math.max(0, count - 6) }, (_, i) =>
    record({
      title: `合成の会話 ${i + 1}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
      texts: [`質問 ${i + 1}`, `回答 ${i + 1}`],
    }),
  ),
];

const container = document.getElementById("root");
if (container === null) {
  throw new Error("missing #root");
}
function DevPage() {
  const { store, state } = useKeepStore(memoryKeepDeps);
  return (
    <main className="app">
      <h1>Workspace (synthetic data, in-memory KEEP store)</h1>
      <Workspace
        records={records}
        revision={1}
        keep={keepViewOf(state, (entry, on) => store.setKeep(entry, on))}
        keepPanel={<KeepPanel store={store} state={state} />}
      />
    </main>
  );
}

createRoot(container).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
);
