// Static-render tests in the node environment (no DOM dependency): the markup
// React would produce for hostile content (AT09) and the list labels.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../browse/search";
import { linearNodes, record } from "../../browse/testing/records";
import { ConversationList } from "./ConversationList";
import { PreviewPane } from "./PreviewPane";

const HOSTILE = [
  "<script>alert(1)</script>",
  '<img src="https://tracker.example.invalid/p.png" onerror="alert(2)">',
  '<a href="javascript:alert(3)">click</a>',
  "![x](https://tracker.example.invalid/m.png)",
  '<iframe src="https://example.invalid"></iframe>',
  "<style>body{background:url(https://example.invalid/s.png)}</style>",
];

function hit(r: ReturnType<typeof record>): SearchHit {
  return { record: r, verdict: "match", titleMatch: false, matchedNodeIds: [], dateUnknown: false };
}

describe("preview renders text only (AT09)", () => {
  const hostile = record({ title: '<b onmouseover="x()">t</b>', nodes: linearNodes(HOSTILE) });
  const html = renderToStaticMarkup(
    createElement(PreviewPane, { record: hostile, hit: null, onClose: () => undefined }),
  );

  it("creates no executable, embedding or linking element", () => {
    for (const tag of ["<script", "<img", "<a ", "<iframe", "<style", "<b "]) {
      expect(html).not.toContain(tag);
    }
    // Inspect real tags only: escaped text starts with "&lt;", never "<".
    const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).not.toMatch(/\s(on\w+|href|src|style)=/i);
    }
  });

  it("shows the hostile strings as escaped text", () => {
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("![x](https://tracker.example.invalid/m.png)");
    expect(html).toContain("&lt;b onmouseover=");
  });

  it("notes messages whose content was not imported instead of omitting them", () => {
    const nodes = linearNodes(["question", ""]).map((n, i) =>
      i === 1 && n.message !== null
        ? { ...n, message: { ...n.message, contentCoverage: "none" as const } }
        : n,
    );
    const out = renderToStaticMarkup(
      createElement(PreviewPane, {
        record: record({ nodes }),
        hit: null,
        onClose: () => undefined,
      }),
    );
    expect(out).toContain("この発言の内容は取り込まれていません");
  });
});

describe("list rows", () => {
  it("label untitled, undated, partly imported conversations without hiding them", () => {
    const r = record({ title: null, updatedAt: null, coverage: "partial" });
    const html = renderToStaticMarkup(
      createElement(ConversationList, {
        hits: [hit(r)],
        activeIndex: 0,
        field: "updatedAt",
        label: "会話一覧",
        onActiveChange: () => undefined,
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain(`aria-activedescendant="conversation-${r.conversationId}"`);
    expect(html).toContain('aria-label="（無題）、日時不明、公式エクスポート、本文: 一部のみ"');
    expect(html).toContain("△ 本文: 一部のみ");
    expect(html).toContain('aria-setsize="1"');
  });
});
