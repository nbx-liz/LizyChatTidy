export type Provider = "chatgpt" | "claude-code";

const PROVIDER_ORIGINS: Readonly<Record<Provider, string>> = {
  chatgpt: "https://chatgpt.com",
  "claude-code": "https://claude.ai",
};

export function originOf(provider: Provider): string {
  return PROVIDER_ORIGINS[provider];
}

/**
 * Returns the provider whose supported page `rawUrl` points at, or null.
 * Origins are compared exactly after URL parsing, so look-alike hosts, other
 * schemes, ports and subdomains never match. Claude is supported only under
 * the `/code` path segment; regular Claude chats are out of scope.
 */
export function providerForUrl(rawUrl: string): Provider | null {
  if (!URL.canParse(rawUrl)) {
    return null;
  }
  const url = new URL(rawUrl);
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  if (url.origin === PROVIDER_ORIGINS.chatgpt) {
    return "chatgpt";
  }
  if (url.origin === PROVIDER_ORIGINS["claude-code"] && isClaudeCodePath(url.pathname)) {
    return "claude-code";
  }
  return null;
}

function isClaudeCodePath(pathname: string): boolean {
  return pathname === "/code" || pathname.startsWith("/code/");
}
