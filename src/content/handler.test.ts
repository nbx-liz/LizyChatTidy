import { describe, expect, it } from "vitest";
import { ExecIdLedger, type HandlerContext, handleRequest, isTrustedSender } from "./handler";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const ID = "0b6f2a3c-1d4e-4f5a-8b9c-0d1e2f3a4b5c";
const NOW = 1_700_000_000_000;
const PAGE_SENDER = { id: EXT, url: `chrome-extension://${EXT}/app.html` };
const PING = { v: 1, kind: "ping", execId: ID, expiresAt: NOW + 10_000 };

function ctx(pageUrl = "https://chatgpt.com/c/1"): HandlerContext {
  return { extensionId: EXT, pageUrl, now: NOW, ledger: new ExecIdLedger() };
}

describe("isTrustedSender", () => {
  it("accepts this extension's own page", () => {
    expect(isTrustedSender(PAGE_SENDER, EXT)).toBe(true);
  });

  it.each([
    ["another extension", { id: "other", url: "chrome-extension://other/app.html" }],
    ["a content script (has tab)", { ...PAGE_SENDER, tab: { id: 3 } }],
    ["a web page origin", { id: EXT, url: "https://chatgpt.com/" }],
    ["a look-alike extension origin", { id: EXT, url: `chrome-extension://${EXT}x/app.html` }],
    ["no url", { id: EXT }],
    ["no id", { url: PAGE_SENDER.url }],
    ["unparsable url", { id: EXT, url: "not a url" }],
  ])("rejects %s", (_label, sender) => {
    expect(isTrustedSender(sender, EXT)).toBe(false);
  });
});

describe("handleRequest", () => {
  it("answers a valid ping with the page origin", () => {
    expect(handleRequest(PING, PAGE_SENDER, ctx())).toEqual({
      v: 1,
      kind: "pong",
      execId: ID,
      origin: "https://chatgpt.com",
    });
  });

  it("rejects an untrusted sender before reading the message", () => {
    expect(handleRequest(PING, { ...PAGE_SENDER, tab: {} }, ctx())).toMatchObject({
      kind: "error",
      code: "bad-sender",
      execId: null,
    });
  });

  it("rejects a malformed message and echoes only a valid execId", () => {
    expect(handleRequest({ ...PING, extra: 1 }, PAGE_SENDER, ctx())).toMatchObject({
      code: "bad-message",
      execId: ID,
    });
    expect(handleRequest({ execId: "../x" }, PAGE_SENDER, ctx())).toMatchObject({
      code: "bad-message",
      execId: null,
    });
  });

  it("rejects an expired request", () => {
    const expired = { ...PING, expiresAt: NOW };
    expect(handleRequest(expired, PAGE_SENDER, ctx())).toMatchObject({ code: "expired" });
  });

  it("rejects a replayed execId", () => {
    const shared = ctx();
    expect(handleRequest(PING, PAGE_SENDER, shared)).toMatchObject({ kind: "pong" });
    expect(handleRequest(PING, PAGE_SENDER, shared)).toMatchObject({ code: "replayed" });
  });

  it("refuses to run on an unsupported page", () => {
    expect(handleRequest(PING, PAGE_SENDER, ctx("https://claude.ai/chat/1"))).toMatchObject({
      code: "wrong-origin",
    });
  });
});
