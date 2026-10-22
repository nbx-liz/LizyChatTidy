import { describe, expect, it } from "vitest";
import { originOf, providerForUrl } from "./origins";

describe("providerForUrl", () => {
  it.each([
    ["https://chatgpt.com/", "chatgpt"],
    ["https://chatgpt.com/c/abc", "chatgpt"],
    ["https://chatgpt.com:443/", "chatgpt"],
    ["https://CHATGPT.com/", "chatgpt"],
    ["https://claude.ai/code", "claude-code"],
    ["https://claude.ai/code/session_123", "claude-code"],
  ])("accepts %s", (url, provider) => {
    expect(providerForUrl(url)).toBe(provider);
  });

  it.each([
    ["look-alike suffix", "https://chatgpt.com.evil.example/"],
    ["look-alike prefix", "https://evilchatgpt.com/"],
    ["subdomain", "https://www.chatgpt.com/"],
    ["plain http", "http://chatgpt.com/"],
    ["other port", "https://chatgpt.com:8443/"],
    ["host in path", "https://evil.example/chatgpt.com"],
    ["userinfo", "https://user@chatgpt.com/"],
    ["regular Claude chat", "https://claude.ai/chat/abc"],
    ["Claude root", "https://claude.ai/"],
    ["Claude path prefix", "https://claude.ai/codex"],
    ["Claude path prefix with suffix", "https://claude.ai/code-review/x"],
    ["extension page", "chrome-extension://abc/app.html"],
    ["not a URL", "chatgpt.com"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(providerForUrl(url)).toBeNull();
  });
});

describe("originOf", () => {
  it("maps each provider to its origin", () => {
    expect(originOf("chatgpt")).toBe("https://chatgpt.com");
    expect(originOf("claude-code")).toBe("https://claude.ai");
  });
});
