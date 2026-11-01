// Static-render checks of the KEEP UI per store state (node env, no DOM).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { record } from "../../browse/testing/records";
import { type KeepState, KeepStore } from "../../keep/keepStore";
import { deps, FakeArea } from "../../keep/testing/fakes";
import { PreviewPane } from "../browse/PreviewPane";
import { KeepPanel } from "./KeepPanel";
import { keepViewOf } from "./keepView";

const store = new KeepStore(deps(new FakeArea()));
const panel = (state: KeepState) =>
  renderToStaticMarkup(createElement(KeepPanel, { store, state }));

describe("KeepPanel offers only the allowed actions", () => {
  it("absent: create only", () => {
    const html = panel({ status: "absent" });
    expect(html).toContain("保存先を作成…");
    expect(html).not.toContain("解除…");
    expect(html).not.toContain("保存データを削除…");
  });

  it("locked: unlock or delete", () => {
    const html = panel({ status: "locked", error: null });
    expect(html).toContain("解除…");
    expect(html).toContain("保存データを削除…");
    expect(html).not.toContain("保存先を作成…");
  });

  it("corrupt: delete only, never create", () => {
    const html = panel({ status: "corrupt", problem: "version" });
    expect(html).toContain("保存データを削除…");
    expect(html).not.toContain("保存先を作成…");
    expect(html).not.toContain("解除…");
  });

  it("access-level: no action at all (KINV-8)", () => {
    const html = panel({ status: "unavailable", reason: "access-level" });
    expect(html).not.toContain("<button");
    expect(html).toContain("対象タブへの接続を止めています");
  });

  it("regressed: reload, adopt or delete", () => {
    const html = panel({ status: "unavailable", reason: "regressed" });
    expect(html).toContain("再読み込み");
    expect(html).toContain("この保存データを使う");
  });
});

describe("preview KEEP button (fixed name, aria-pressed)", () => {
  const r = record();
  const render = (state: KeepState) =>
    renderToStaticMarkup(
      createElement(PreviewPane, {
        record: r,
        hit: null,
        keep: keepViewOf(state, async () => "ok"),
        onClose: () => undefined,
      }),
    );

  it("is inert and explains why while the store is locked", () => {
    const html = render({ status: "locked", error: null });
    expect(html).toMatch(
      /<button[^>]*aria-pressed="false"[^>]*aria-disabled="true"[^>]*>KEEP<\/button>/,
    );
    expect(html).toContain("解除してください");
  });

  it("shows the pressed state when the conversation is kept", () => {
    const html = render({
      status: "available",
      entries: [{ provider: "chatgpt", conversationId: r.conversationId, scope: null }],
      revision: 2,
    });
    expect(html).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*aria-disabled="false"[^>]*>KEEP<\/button>/,
    );
    expect(html).toContain("付けています");
  });
});
