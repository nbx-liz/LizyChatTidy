import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PingRequest } from "../shared/messages";
import { connect, type ExtensionApi, REQUEST_TTL_MS } from "./controller";

const ID = "0b6f2a3c-1d4e-4f5a-8b9c-0d1e2f3a4b5c";
const NOW = 1_700_000_000_000;

function fakeApi(overrides: Partial<ExtensionApi> = {}): ExtensionApi & { sent: PingRequest[] } {
  const sent: PingRequest[] = [];
  return {
    sent,
    getTabUrl: async () => "https://chatgpt.com/c/1",
    injectContentScript: async () => {},
    sendToTab: async (_tabId, message) => {
      sent.push(message);
      return { v: 1, kind: "pong", execId: message.execId, origin: "https://chatgpt.com" };
    },
    newExecId: () => ID,
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connect", () => {
  it("connects to a supported page and sends one bounded ping", async () => {
    const api = fakeApi();
    await expect(connect(api, 7)).resolves.toEqual({ status: "connected", provider: "chatgpt" });
    expect(api.sent).toEqual([{ v: 1, kind: "ping", execId: ID, expiresAt: NOW + REQUEST_TTL_MS }]);
  });

  it("connects to Claude Code on the web", async () => {
    const api = fakeApi({
      getTabUrl: async () => "https://claude.ai/code/session_1",
      sendToTab: async (_t, m) => ({
        v: 1,
        kind: "pong",
        execId: m.execId,
        origin: "https://claude.ai",
      }),
    });
    await expect(connect(api, 7)).resolves.toEqual({
      status: "connected",
      provider: "claude-code",
    });
  });

  it("reports no target without touching any tab", async () => {
    const inject = vi.fn(async () => {});
    await expect(connect(fakeApi({ injectContentScript: inject }), null)).resolves.toEqual({
      status: "no-target",
    });
    expect(inject).not.toHaveBeenCalled();
  });

  it("reports no access when the tab URL is not readable", async () => {
    const inject = vi.fn(async () => {});
    const api = fakeApi({ getTabUrl: async () => undefined, injectContentScript: inject });
    await expect(connect(api, 7)).resolves.toEqual({ status: "no-access" });
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([
    "https://claude.ai/chat/1",
    "https://chatgpt.com.evil.example/",
    "https://example.com/",
  ])("never injects into an unsupported page: %s", async (url) => {
    const inject = vi.fn(async () => {});
    const api = fakeApi({ getTabUrl: async () => url, injectContentScript: inject });
    await expect(connect(api, 7)).resolves.toEqual({ status: "unsupported-page" });
    expect(inject).not.toHaveBeenCalled();
  });

  it.each([
    [
      "tab lookup throws",
      { getTabUrl: async () => Promise.reject(new Error("x")) },
      "tab-unavailable",
    ],
    [
      "injection throws",
      { injectContentScript: async () => Promise.reject(new Error("x")) },
      "inject-failed",
    ],
    ["send throws", { sendToTab: async () => Promise.reject(new Error("x")) }, "send-failed"],
  ] as const)("fails explicitly when %s", async (_label, overrides, reason) => {
    await expect(connect(fakeApi(overrides), 7)).resolves.toEqual({ status: "failed", reason });
  });

  it.each([
    ["no response", undefined, "bad-response"],
    ["malformed response", { kind: "pong" }, "bad-response"],
    [
      "another execId",
      {
        v: 1,
        kind: "pong",
        execId: "1b6f2a3c-1d4e-4f5a-8b9c-0d1e2f3a4b5c",
        origin: "https://chatgpt.com",
      },
      "bad-response",
    ],
    [
      "wrong origin",
      { v: 1, kind: "pong", execId: ID, origin: "https://claude.ai" },
      "bad-response",
    ],
    ["explicit rejection", { v: 1, kind: "error", execId: ID, code: "bad-sender" }, "rejected"],
  ] as const)("does not connect on %s", async (_label, reply, reason) => {
    const api = fakeApi({ sendToTab: async () => reply });
    await expect(connect(api, 7)).resolves.toEqual({ status: "failed", reason });
  });
});
