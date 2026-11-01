// Validation and mapping of one conversation from a ChatGPT export's
// conversations.json (P-0005 item 3). The export shape is not a fixed fact
// (BLUEPRINT §5): every field is checked at runtime, and a conversation that
// cannot be identified or whose tree is inconsistent is listed, not guessed.
import { type Counter, increment, newCounter } from "./counter";
import type {
  ContentCoverage,
  ConversationNode,
  ConversationRecord,
  ImportedMessage,
  ImportIssue,
  ItemCode,
  MessageRole,
} from "./types";

export const CHATGPT_EXPORT_ADAPTER_VERSION = "chatgpt-export/1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 2015-01-01T00:00:00Z <= t < 2100-01-01T00:00:00Z, in Unix seconds.
const MIN_TIME = 1_420_070_400;
const MAX_TIME = 4_102_444_800;
const SCHEMA_TOKEN = /^[a-z][a-z0-9_.-]{0,63}$/;
const OTHER = "(other)";
const ROLES: ReadonlySet<string> = new Set<MessageRole>(["user", "assistant", "system", "tool"]);

/** Shape-only counters for the structure report; filled while mapping. */
export interface ShapeStats {
  conversationKeys: Counter;
  messageKeys: Counter;
  contentTypes: Counter;
  roles: Counter;
  nodeCount: number;
  leafCount: number;
  maxTreeDepth: number;
}

export function newShapeStats(): ShapeStats {
  return {
    conversationKeys: newCounter(),
    messageKeys: newCounter(),
    contentTypes: newCounter(),
    roles: newCounter(),
    nodeCount: 0,
    leafCount: 0,
    maxTreeDepth: 0,
  };
}

/** Counts a schema token; anything that does not look like one is bucketed, so no content leaks. */
function bump(counter: Counter, token: unknown): void {
  const key = typeof token === "string" && SCHEMA_TOKEN.test(token) ? token : OTHER;
  increment(counter, key);
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Field<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Absent or null is "unknown" (AT05); anything else must be an in-range Unix time. */
function readTime(value: unknown): Field<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TIME &&
    value < MAX_TIME
  ) {
    return { ok: true, value: new Date(value * 1000).toISOString() };
  }
  return { ok: false };
}

function readOptional<T>(value: unknown, guard: (v: unknown) => v is T): Field<T | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  return guard(value) ? { ok: true, value } : { ok: false };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

type IdResult = { readonly id: string } | { readonly code: ItemCode };

function readId(raw: Obj): IdResult {
  const { id, conversation_id: conversationId } = raw;
  if (id !== undefined && conversationId !== undefined && id !== conversationId) {
    return { code: "id-mismatch" };
  }
  const value = id ?? conversationId;
  if (value === undefined || value === null) {
    return { code: "missing-id" };
  }
  return typeof value === "string" && UUID.test(value) ? { id: value } : { code: "invalid-id" };
}

function readContent(content: unknown, stats: ShapeStats): [string, ContentCoverage] {
  if (!isObject(content)) {
    return ["", "none"];
  }
  const type = content["content_type"];
  bump(stats.contentTypes, type);
  if (type === "code") {
    return isString(content["text"]) ? [content["text"], "complete"] : ["", "none"];
  }
  if (type !== "text" && type !== "multimodal_text") {
    return ["", "none"];
  }
  const parts = content["parts"];
  if (!Array.isArray(parts)) {
    return ["", "none"];
  }
  const texts = parts.filter(isString);
  if (texts.length === parts.length) {
    return [texts.join("\n"), "complete"];
  }
  return [texts.join("\n"), texts.length === 0 ? "none" : "partial"];
}

function readMessage(
  raw: unknown,
  stats: ShapeStats,
  issues: ItemCode[],
): Field<ImportedMessage | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (!isObject(raw)) {
    return { ok: false };
  }
  for (const key of Object.keys(raw)) {
    bump(stats.messageKeys, key);
  }
  const author = raw["author"];
  const rawRole = isObject(author) ? author["role"] : undefined;
  bump(stats.roles, rawRole);
  const role: MessageRole =
    typeof rawRole === "string" && ROLES.has(rawRole) ? (rawRole as MessageRole) : "unknown";
  const createdAt = readTime(raw["create_time"]);
  if (!createdAt.ok) {
    issues.push("invalid-time");
  }
  const [text, contentCoverage] = readContent(raw["content"], stats);
  return {
    ok: true,
    value: { role, createdAt: createdAt.ok ? createdAt.value : null, text, contentCoverage },
  };
}

interface RawTreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly message: unknown;
}

function readTreeNode(key: string, raw: unknown): RawTreeNode | null {
  if (!isObject(raw) || raw["id"] !== key) {
    return null;
  }
  const parent = raw["parent"] ?? null;
  const children = raw["children"] ?? [];
  if ((parent !== null && !isString(parent)) || !Array.isArray(children)) {
    return null;
  }
  if (!children.every(isString) || new Set(children).size !== children.length) {
    return null;
  }
  return { id: key, parentId: parent, childIds: children, message: raw["message"] };
}

/**
 * Accepts only a forest in which parent and child links agree and every node
 * is reached exactly once from a root; cycles, orphans and shared children fail.
 */
function readTree(mapping: unknown): RawTreeNode[] | null {
  if (!isObject(mapping)) {
    return null;
  }
  const nodes = new Map<string, RawTreeNode>();
  for (const [key, raw] of Object.entries(mapping)) {
    const node = readTreeNode(key, raw);
    if (node === null) {
      return null;
    }
    nodes.set(key, node);
  }
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.get(node.parentId)?.childIds.includes(node.id) !== true) {
      return null;
    }
    if (node.childIds.some((child) => nodes.get(child)?.parentId !== node.id)) {
      return null;
    }
  }
  return [...nodes.values()];
}

function measureTree(nodes: readonly RawTreeNode[], stats: ShapeStats): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stack: Array<[string, number]> = nodes
    .filter((n) => n.parentId === null)
    .map((n) => [n.id, 1]);
  let visited = 0;
  let leaves = 0;
  let maxDepth = 0;
  const seen = new Set<string>();
  while (stack.length > 0) {
    const [id, depth] = stack.pop() as [string, number];
    const node = byId.get(id);
    if (node === undefined || seen.has(id)) {
      return false;
    }
    seen.add(id);
    visited++;
    maxDepth = Math.max(maxDepth, depth);
    if (node.childIds.length === 0) {
      leaves++;
    }
    for (const child of node.childIds) {
      stack.push([child, depth + 1]);
    }
  }
  if (visited !== nodes.length) {
    return false; // Unreachable nodes: a detached cycle or an orphan.
  }
  stats.nodeCount += visited;
  stats.leafCount += leaves;
  stats.maxTreeDepth = Math.max(stats.maxTreeDepth, maxDepth);
  return true;
}

function coverageOf(nodes: readonly ConversationNode[]): ContentCoverage {
  return nodes.every((n) => n.message === null || n.message.contentCoverage === "complete")
    ? "complete"
    : "partial";
}

export function mapConversation(
  raw: unknown,
  index: number,
  observedAt: string,
  stats: ShapeStats,
): { record: ConversationRecord | null; issues: ImportIssue[] } {
  const entry = `conversations.json[${index}]`;
  const fail = (code: ItemCode) => ({ record: null, issues: [{ code, entry }] });
  if (!isObject(raw)) {
    return fail("not-object");
  }
  for (const key of Object.keys(raw)) {
    bump(stats.conversationKeys, key);
  }
  const id = readId(raw);
  if ("code" in id) {
    return fail(id.code);
  }
  const tree = readTree(raw["mapping"]);
  const current = raw["current_node"] ?? null;
  const currentOk = current === null || (isString(current) && tree?.some((n) => n.id === current));
  if (tree === null || !currentOk || !measureTree(tree, stats)) {
    return fail("invalid-tree");
  }

  const codes: ItemCode[] = [];
  const nodes: ConversationNode[] = [];
  for (const node of tree) {
    const message = readMessage(node.message, stats, codes);
    if (!message.ok) {
      return fail("invalid-tree");
    }
    nodes.push({
      id: node.id,
      parentId: node.parentId,
      childIds: node.childIds,
      message: message.value,
    });
  }
  const title = readOptional(raw["title"], isString);
  const archived = readOptional(raw["is_archived"], isBoolean);
  const createdAt = readTime(raw["create_time"]);
  const updatedAt = readTime(raw["update_time"]);
  for (const [field, code] of [
    [title, "invalid-field"],
    [archived, "invalid-field"],
    [createdAt, "invalid-time"],
    [updatedAt, "invalid-time"],
  ] as const) {
    if (!field.ok) {
      codes.push(code);
    }
  }
  const updated = updatedAt.ok ? updatedAt.value : null;
  const record: ConversationRecord = {
    provider: "chatgpt",
    scope: { status: "unverified", displayLabel: null },
    conversationId: id.id,
    title: title.ok ? title.value : null,
    createdAt: createdAt.ok ? createdAt.value : null,
    updatedAt: updated,
    archived: archived.ok ? archived.value : null,
    nodes,
    currentNodeId: current,
    observation: {
      observedAt,
      source: "official-export",
      contentCoverage: coverageOf(nodes),
      revisionEvidence: updated,
      activity: "unknown",
      adapterVersion: CHATGPT_EXPORT_ADAPTER_VERSION,
    },
  };
  return { record, issues: codes.map((code) => ({ code, entry })) };
}
