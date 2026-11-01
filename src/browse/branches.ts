// Branch navigation over an imported conversation tree (P-0001: branches are
// never concatenated). A branch is identified by the node it ends at; its
// messages are the path from the root to that node.
import type { ConversationNode, ConversationRecord } from "../import/types";

export interface Branch {
  /** The node the branch ends at (a leaf, or the conversation's current node). */
  readonly endId: string;
  readonly nodes: readonly ConversationNode[];
}

function byId(record: ConversationRecord): Map<string, ConversationNode> {
  return new Map(record.nodes.map((n) => [n.id, n]));
}

/** Root-to-`endId` path. The import guarantees a consistent forest, so the walk terminates. */
export function branchEndingAt(record: ConversationRecord, endId: string): Branch | null {
  const nodes = byId(record);
  const path: ConversationNode[] = [];
  let cursor = nodes.get(endId);
  while (cursor !== undefined) {
    path.push(cursor);
    if (path.length > nodes.size) {
      return null; // Defensive: never loop on a malformed tree.
    }
    cursor = cursor.parentId === null ? undefined : nodes.get(cursor.parentId);
  }
  return path.length === 0 ? null : { endId, nodes: path.reverse() };
}

/** Leaf ids in tree order (depth-first, children in their stored order). */
export function leafIds(record: ConversationRecord): string[] {
  const nodes = byId(record);
  const out: string[] = [];
  const stack = record.nodes
    .filter((n) => n.parentId === null)
    .map((n) => n.id)
    .reverse();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const node = nodes.get(id);
    if (node === undefined) {
      continue;
    }
    if (node.childIds.length === 0) {
      out.push(id);
    } else {
      stack.push(...[...node.childIds].reverse());
    }
  }
  return out;
}

/** The branch shown first: the one ending at the current node, else the first leaf. */
export function defaultBranchEnd(record: ConversationRecord): string | null {
  if (record.currentNodeId !== null && record.nodes.some((n) => n.id === record.currentNodeId)) {
    return record.currentNodeId;
  }
  return leafIds(record)[0] ?? null;
}

/** Selectable branch ends: every leaf, plus the current node when it is not a leaf. */
export function branchEnds(record: ConversationRecord): string[] {
  const leaves = leafIds(record);
  const current = defaultBranchEnd(record);
  return current !== null && !leaves.includes(current) ? [current, ...leaves] : leaves;
}

/** Branch ends whose path contains `nodeId` (the node itself or any descendant end). */
export function branchEndsThrough(record: ConversationRecord, nodeId: string): string[] {
  return branchEnds(record).filter((end) =>
    (branchEndingAt(record, end)?.nodes ?? []).some((n) => n.id === nodeId),
  );
}
