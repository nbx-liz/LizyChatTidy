// Branch navigation over an imported conversation tree (P-0001: branches are
// never concatenated). A branch is identified by the node it ends at; its
// messages are the path from the root to that node.
//
// Everything is computed once per conversation (BranchIndex) and iteratively:
// the import accepts arbitrarily wide and deep trees, so neither recursion nor
// spreading a child list into one call may depend on the tree's shape.
import type { ConversationNode, ConversationRecord } from "../import/types";

export interface Branch {
  /** The node the branch ends at (a leaf, or the conversation's current node). */
  readonly endId: string;
  readonly nodes: readonly ConversationNode[];
}

export interface BranchIndex {
  /** Selectable ends: every leaf in tree order, preceded by the current node when it is not a leaf. */
  readonly ends: readonly string[];
  /** The branch shown first: the one ending at the current node, else the first leaf. */
  readonly defaultEnd: string | null;
  /** True when the current node exists in the tree. */
  readonly currentKnown: boolean;
  /** Root-to-`endId` path, or null when the node does not exist. */
  path(endId: string): Branch | null;
  /** Ends whose path contains any of `nodeIds`, in one linear traversal (not one path per end). */
  endsThrough(nodeIds: ReadonlySet<string>): Set<string>;
}

function leavesThrough(
  record: ConversationRecord,
  nodes: Map<string, ConversationNode>,
  nodeIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  const stack: Array<[string, boolean]> = record.nodes
    .filter((n) => n.parentId === null)
    .map((n) => [n.id, false]);
  while (stack.length > 0) {
    const [id, above] = stack.pop() as [string, boolean];
    const node = nodes.get(id);
    if (node === undefined) {
      continue;
    }
    const hit = above || nodeIds.has(id);
    if (node.childIds.length === 0 && hit) {
      out.add(id);
    }
    for (const child of node.childIds) {
      stack.push([child, hit]);
    }
  }
  return out;
}

function leavesInOrder(record: ConversationRecord, nodes: Map<string, ConversationNode>): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  const roots = record.nodes.filter((n) => n.parentId === null);
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push((roots[i] as ConversationNode).id);
  }
  while (stack.length > 0) {
    const node = nodes.get(stack.pop() as string);
    if (node === undefined) {
      continue;
    }
    if (node.childIds.length === 0) {
      out.push(node.id);
    }
    for (let i = node.childIds.length - 1; i >= 0; i--) {
      stack.push(node.childIds[i] as string);
    }
  }
  return out;
}

export function createBranchIndex(record: ConversationRecord): BranchIndex {
  const nodes = new Map(record.nodes.map((n) => [n.id, n]));
  const leaves = leavesInOrder(record, nodes);
  const currentKnown = record.currentNodeId !== null && nodes.has(record.currentNodeId);
  const defaultEnd = currentKnown ? record.currentNodeId : (leaves[0] ?? null);
  const currentIsLeaf =
    currentKnown && (nodes.get(record.currentNodeId as string)?.childIds.length ?? 0) === 0;
  const ends =
    currentKnown && !currentIsLeaf ? [record.currentNodeId as string, ...leaves] : leaves;
  return {
    ends,
    defaultEnd,
    currentKnown,
    endsThrough(nodeIds) {
      if (nodeIds.size === 0) {
        return new Set();
      }
      const out = leavesThrough(record, nodes, nodeIds);
      // A non-leaf current end: one walk up its own path.
      if (currentKnown && !currentIsLeaf) {
        let cursor = nodes.get(record.currentNodeId as string);
        let steps = 0;
        while (cursor !== undefined && steps <= nodes.size) {
          if (nodeIds.has(cursor.id)) {
            out.add(record.currentNodeId as string);
            break;
          }
          cursor = cursor.parentId === null ? undefined : nodes.get(cursor.parentId);
          steps++;
        }
      }
      return out;
    },
    path(endId) {
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
    },
  };
}
