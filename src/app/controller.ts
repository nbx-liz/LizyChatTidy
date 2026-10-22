import { type PingRequest, PROTOCOL_VERSION, parseContentResponse } from "../shared/messages";
import { originOf, type Provider, providerForUrl } from "../shared/origins";

export const REQUEST_TTL_MS = 10_000;

/** The browser surface the Controller needs; injected so it can be tested without Chrome. */
export interface ExtensionApi {
  getTabUrl(tabId: number): Promise<string | undefined>;
  injectContentScript(tabId: number): Promise<void>;
  sendToTab(tabId: number, message: PingRequest): Promise<unknown>;
  newExecId(): string;
  now(): number;
}

export type ConnectFailure =
  | "tab-unavailable"
  | "inject-failed"
  | "send-failed"
  | "bad-response"
  | "rejected";

export type ConnectResult =
  | { readonly status: "connected"; readonly provider: Provider }
  | { readonly status: "no-target" }
  | { readonly status: "no-access" }
  | { readonly status: "unsupported-page" }
  | { readonly status: "failed"; readonly reason: ConnectFailure };

/**
 * Checks that the target tab is a supported page, injects the content script
 * into its ISOLATED world and confirms it answers from the expected origin.
 * Nothing is injected unless the tab URL is a supported page (P-0004).
 */
export async function connect(api: ExtensionApi, tabId: number | null): Promise<ConnectResult> {
  if (tabId === null) {
    return { status: "no-target" };
  }
  const url = await attempt(() => api.getTabUrl(tabId));
  if (!url.ok) {
    return { status: "failed", reason: "tab-unavailable" };
  }
  if (url.value === undefined) {
    return { status: "no-access" };
  }
  const provider = providerForUrl(url.value);
  if (provider === null) {
    return { status: "unsupported-page" };
  }
  const injected = await attempt(() => api.injectContentScript(tabId));
  if (!injected.ok) {
    return { status: "failed", reason: "inject-failed" };
  }
  const request: PingRequest = {
    v: PROTOCOL_VERSION,
    kind: "ping",
    execId: api.newExecId(),
    expiresAt: api.now() + REQUEST_TTL_MS,
  };
  const reply = await attempt(() => api.sendToTab(tabId, request));
  if (!reply.ok) {
    return { status: "failed", reason: "send-failed" };
  }
  const response = parseContentResponse(reply.value);
  if (response === null || response.execId !== request.execId) {
    return { status: "failed", reason: "bad-response" };
  }
  if (response.kind === "error") {
    return { status: "failed", reason: "rejected" };
  }
  if (response.origin !== originOf(provider)) {
    return { status: "failed", reason: "bad-response" };
  }
  return { status: "connected", provider };
}

type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    // Diagnostics carry only the error class name, never URLs or page data (INV-03).
    console.error("lizychattidy: controller-step-failed", errorName(error));
    return { ok: false };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
