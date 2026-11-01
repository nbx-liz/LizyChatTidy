// Validation and mapping of one conversation from a ChatGPT export's
// conversations.json (P-0005 item 3). The export shape is not a fixed fact
// (BLUEPRINT §5): every field is checked at runtime, and a conversation that
// cannot be identified or whose tree is inconsistent is listed, not guessed.
import {
  CONTENT_TYPES,
  CONVERSATION_KEYS,
  MESSAGE_KEYS,
  ROLE_TOKENS,
  reportToken,
} from "./chatgptSchema";
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

/** Shape-only counters for the structure report; filled while mapping. */
export interface ShapeStats {
  conversationKeys: Counter;
  messageKeys: Counter;
  contentTypes: Counter;
  roles: Counter;
  messageCoverage: Counter;
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
    messageCoverage: newCounter(),
    nodeCount: 0,
    leafCount: 0,
    maxTreeDepth: 0,
  };
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

type Content = {
  readonly text: string;
  readonly coverage: ContentCoverage;
  /** True when a known content shape is violated; the message is listed as invalid-content. */
  readonly malformed: boolean;
};

const MALFORMED: Content = { text: "", coverage: "none", malformed: true };

/**
 * Text is taken only from the known text-bearing types. A known type whose
 * shape is wrong is malformed (listed). An unknown or non-text type is not an
 * error: its message keeps coverage "none", which the record's coverage
 * reports (P-0005 item 3).
 */
function readContent(content: unknown, stats: ShapeStats): Content {
  if (!isObject(content)) {
    return MALFORMED;
  }
  const type = content["content_type"];
  increment(stats.contentTypes, reportToken(type, CONTENT_TYPES));
  if (!isString(type)) {
    return MALFORMED;
  }
  if (type === "code") {
    const text = content["text"];
    return isString(text) ? { text, coverage: "complete", malformed: false } : MALFORMED;
  }
  if (type !== "text" && type !== "multimodal_text") {
    return { text: "", coverage: "none", malformed: false };
  }
  const parts = content["parts"];
  if (!Array.isArray(parts)) {
    return MALFORMED;
  }
  const texts = parts.filter(isString);
  // Plain text holds only strings; multimodal text may add objects (images, files).
  const others = parts.filter((p) => !isString(p));
  if (others.length > 0 && (type === "text" || !others.every(isObject))) {
    return MALFORMED;
  }
  const coverage = others.length === 0 ? "complete" : texts.length === 0 ? "none" : "partial";
  return { text: texts.join("\n"), coverage, malformed: false };
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
    increment(stats.messageKeys, reportToken(key, MESSAGE_KEYS));
  }
  const author = raw["author"];
  const rawRole = isObject(author) ? author["role"] : undefined;
  increment(stats.roles, reportToken(rawRole, ROLE_TOKENS));
  const role: MessageRole =
    isString(rawRole) && ROLE_TOKENS.has(rawRole) ? (rawRole as MessageRole) : "unknown";
  const createdAt = readTime(raw["create_time"]);
  if (!createdAt.ok) {
    issues.push("invalid-time");
  }
  const content = readContent(raw["content"], stats);
  if (content.malformed) {
    issues.push("invalid-content");
  }
  increment(stats.messageCoverage, content.coverage);
  return {
    ok: true,
    value: {
      role,
      createdAt: createdAt.ok ? createdAt.value : null,
      text: content.text,
      contentCoverage: content.coverage,
    },
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

export interface MappedConversation {
  /** The validated conversation id, also when the conversation is rejected later. */
  readonly id: string | null;
  readonly record: ConversationRecord | null;
  readonly issues: ImportIssue[];
}

export function mapConversation(
  raw: unknown,
  index: number,
  observedAt: string,
  stats: ShapeStats,
): MappedConversation {
  const entry = `conversations.json[${index}]`;
  if (!isObject(raw)) {
    return { id: null, record: null, issues: [{ code: "not-object", entry }] };
  }
  for (const key of Object.keys(raw)) {
    increment(stats.conversationKeys, reportToken(key, CONVERSATION_KEYS));
  }
  const id = readId(raw);
  if ("code" in id) {
    return { id: null, record: null, issues: [{ code: id.code, entry }] };
  }
  const reject = (code: ItemCode): MappedConversation => ({
    id: id.id,
    record: null,
    issues: [{ code, entry }],
  });
  const tree = readTree(raw["mapping"]);
  const current = raw["current_node"] ?? null;
  const currentOk = current === null || (isString(current) && tree?.some((n) => n.id === current));
  if (tree === null || !currentOk || !measureTree(tree, stats)) {
    return reject("invalid-tree");
  }

  const codes: ItemCode[] = [];
  const nodes: ConversationNode[] = [];
  for (const node of tree) {
    const message = readMessage(node.message, stats, codes);
    if (!message.ok) {
      return reject("invalid-tree");
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
  return { id: id.id, record, issues: codes.map((code) => ({ code, entry })) };
}
