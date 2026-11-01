// Test-only builders for imported conversation records (synthetic content).
import type { ContentCoverage, ConversationNode, ConversationRecord } from "../../import/types";

let counter = 0;

export function syntheticId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export interface RecordOptions {
  readonly id?: string;
  readonly title?: string | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
  /** Message texts along one branch, user and assistant alternating. */
  readonly texts?: readonly string[];
  readonly coverage?: ContentCoverage;
  readonly nodes?: readonly ConversationNode[];
  readonly currentNodeId?: string | null;
}

export function linearNodes(texts: readonly string[]): ConversationNode[] {
  const ids = texts.map((_, i) => `n${i}`);
  return texts.map((text, i) => ({
    id: ids[i] as string,
    parentId: i === 0 ? null : (ids[i - 1] as string),
    childIds: i + 1 < ids.length ? [ids[i + 1] as string] : [],
    message: {
      role: i % 2 === 0 ? "user" : "assistant",
      createdAt: null,
      text,
      contentCoverage: "complete",
    },
  }));
}

export function record(options: RecordOptions = {}): ConversationRecord {
  counter++;
  const nodes =
    options.nodes ?? linearNodes(options.texts ?? ["Synthetic question", "Synthetic answer"]);
  return {
    provider: "chatgpt",
    scope: { status: "unverified", displayLabel: null },
    conversationId: options.id ?? syntheticId(counter),
    title: options.title === undefined ? "Synthetic title" : options.title,
    createdAt: options.createdAt === undefined ? "2026-01-10T00:00:00.000Z" : options.createdAt,
    updatedAt: options.updatedAt === undefined ? "2026-01-11T00:00:00.000Z" : options.updatedAt,
    archived: false,
    nodes,
    currentNodeId:
      options.currentNodeId === undefined ? (nodes.at(-1)?.id ?? null) : options.currentNodeId,
    observation: {
      observedAt: "2026-11-01T00:00:00.000Z",
      source: "official-export",
      contentCoverage: options.coverage ?? "complete",
      revisionEvidence: null,
      activity: "unknown",
      adapterVersion: "chatgpt-export/1",
    },
  };
}

/** root(u) -> a1 and root(u) -> a2: two branches sharing the first message. */
export function branchedNodes(): ConversationNode[] {
  const msg = (text: string, role: "user" | "assistant") => ({
    role,
    createdAt: null,
    text,
    contentCoverage: "complete" as const,
  });
  return [
    { id: "u", parentId: null, childIds: ["a1", "a2"], message: msg("Question", "user") },
    { id: "a1", parentId: "u", childIds: [], message: msg("First answer", "assistant") },
    { id: "a2", parentId: "u", childIds: [], message: msg("Second answer", "assistant") },
  ];
}
