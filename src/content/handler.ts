import {
  type ContentResponse,
  type ErrorCode,
  isExecId,
  PROTOCOL_VERSION,
  parsePingRequest,
} from "../shared/messages";
import { providerForUrl } from "../shared/origins";

export interface SenderLike {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
  readonly tab?: unknown;
}

export interface HandlerContext {
  readonly extensionId: string;
  readonly pageUrl: string;
  readonly now: number;
  readonly ledger: ExecIdLedger;
}

/**
 * Accepts only messages sent from one of this extension's own pages: not from
 * another extension, not from a content script (those carry `sender.tab`), and
 * never from the web page itself (INV-11).
 */
export function isTrustedSender(sender: SenderLike, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.tab !== undefined || sender.url === undefined) {
    return false;
  }
  if (!URL.canParse(sender.url)) {
    return false;
  }
  // Compare scheme and host rather than `origin`: WHATWG URL reports an
  // opaque "null" origin for non-special schemes such as chrome-extension:.
  const url = new URL(sender.url);
  return url.protocol === "chrome-extension:" && url.host === extensionId && url.port === "";
}

/** Remembers execution IDs already used in this document so each runs at most once. */
export class ExecIdLedger {
  private readonly used = new Set<string>();

  claim(execId: string): boolean {
    if (this.used.has(execId)) {
      return false;
    }
    this.used.add(execId);
    return true;
  }
}

export function handleRequest(
  raw: unknown,
  sender: SenderLike,
  ctx: HandlerContext,
): ContentResponse {
  if (!isTrustedSender(sender, ctx.extensionId)) {
    return errorResponse(null, "bad-sender");
  }
  const request = parsePingRequest(raw);
  if (request === null) {
    return errorResponse(execIdOf(raw), "bad-message");
  }
  if (request.expiresAt <= ctx.now) {
    return errorResponse(request.execId, "expired");
  }
  if (!ctx.ledger.claim(request.execId)) {
    return errorResponse(request.execId, "replayed");
  }
  if (providerForUrl(ctx.pageUrl) === null) {
    return errorResponse(request.execId, "wrong-origin");
  }
  return {
    v: PROTOCOL_VERSION,
    kind: "pong",
    execId: request.execId,
    origin: new URL(ctx.pageUrl).origin,
  };
}

function errorResponse(execId: string | null, code: ErrorCode): ContentResponse {
  return { v: PROTOCOL_VERSION, kind: "error", execId, code };
}

function execIdOf(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && "execId" in raw && isExecId(raw.execId)) {
    return raw.execId;
  }
  return null;
}
