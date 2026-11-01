// KEEP entries and the protection rule (P-0001 item 1, P-0007 item 7). Pure.

export type KeepProvider = "chatgpt" | "claude-code";

export interface KeepScope {
  readonly accountKey: string;
  readonly workspaceKey: string;
}

export interface KeepEntry {
  readonly provider: KeepProvider;
  readonly conversationId: string;
  /** null: marked while the subject was unverified; protects every subject's same id. */
  readonly scope: KeepScope | null;
}

/** The conversation a delete plan or a preflight asks about. */
export interface KeepQuery {
  readonly provider: KeepProvider;
  readonly conversationId: string;
  /** null when the conversation's subject is not verified. */
  readonly scope: KeepScope | null;
}

const CHATGPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The adapter's canonical id form; only ChatGPT exists so far. */
export function isCanonicalId(provider: KeepProvider, id: string): boolean {
  return provider === "chatgpt" ? CHATGPT_ID.test(id) : false;
}

function sameScope(a: KeepScope, b: KeepScope): boolean {
  return a.accountKey === b.accountKey && a.workspaceKey === b.workspaceKey;
}

/**
 * A conversation is protected when some entry has the same provider and id
 * (exact comparison) and either has no scope or the same scope. An entry with
 * a scope never protects a conversation whose scope is unknown or different;
 * an entry without a scope protects every subject (it only broadens).
 */
export function isProtected(entries: readonly KeepEntry[], query: KeepQuery): boolean {
  return entries.some(
    (e) =>
      e.provider === query.provider &&
      e.conversationId === query.conversationId &&
      (e.scope === null || (query.scope !== null && sameScope(e.scope, query.scope))),
  );
}

function sameEntry(a: KeepEntry, b: KeepEntry): boolean {
  return (
    a.provider === b.provider &&
    a.conversationId === b.conversationId &&
    (a.scope === null ? b.scope === null : b.scope !== null && sameScope(a.scope, b.scope))
  );
}

export function hasEntry(entries: readonly KeepEntry[], entry: KeepEntry): boolean {
  return entries.some((e) => sameEntry(e, entry));
}

/** Returns a new list with `entry` added or removed; never mutates `entries`. */
export function withEntry(
  entries: readonly KeepEntry[],
  entry: KeepEntry,
  keep: boolean,
): readonly KeepEntry[] {
  const without = entries.filter((e) => !sameEntry(e, entry));
  return keep ? [...without, entry] : without;
}
