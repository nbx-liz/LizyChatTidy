// Test-only builders for synthetic ChatGPT export conversations. All content
// is invented; no real export is used (CLAUDE.md safety rules).

export type RawNode = {
  id: string;
  parent: string | null;
  children: string[];
  message: Record<string, unknown> | null;
};

export function message(
  role: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `msg-${role}-${text.length}`,
    author: { role, name: null, metadata: {} },
    create_time: 1_700_000_000,
    content: { content_type: "text", parts: [text] },
    status: "finished_successfully",
    ...extra,
  };
}

/**
 * A conversation whose tree is root -> u1 -> a1, plus an optional second
 * branch u1 -> a2 (a regenerated answer).
 */
export function conversation(
  id: string,
  options: { title?: string; branch?: boolean; overrides?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const mapping: Record<string, RawNode> = {
    root: { id: "root", parent: null, children: ["u1"], message: null },
    u1: {
      id: "u1",
      parent: "root",
      children: options.branch === true ? ["a1", "a2"] : ["a1"],
      message: message("user", "Synthetic question"),
    },
    a1: { id: "a1", parent: "u1", children: [], message: message("assistant", "First answer") },
  };
  if (options.branch === true) {
    mapping["a2"] = {
      id: "a2",
      parent: "u1",
      children: [],
      message: message("assistant", "Second answer"),
    };
  }
  return {
    id,
    conversation_id: id,
    title: options.title ?? "Synthetic title",
    create_time: 1_700_000_000.5,
    update_time: 1_700_000_100,
    is_archived: false,
    mapping,
    current_node: options.branch === true ? "a2" : "a1",
    ...options.overrides,
  };
}

export const ID_A = "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab";
export const ID_B = "7b2e1d3f-2c3d-4e4f-9a01-123456789abc";
export const ID_C = "8c3f2e40-3d4e-4f50-ab12-23456789abcd";
