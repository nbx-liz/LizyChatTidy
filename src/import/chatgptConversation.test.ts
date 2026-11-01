import { describe, expect, it } from "vitest";
import { mapConversation, newShapeStats } from "./chatgptConversation";
import { conversation, ID_A, message } from "./testing/chatgptFixture";
import type { ConversationRecord, ImportIssue } from "./types";

const OBSERVED = "2026-11-01T00:00:00.000Z";

function map(raw: unknown): { record: ConversationRecord | null; issues: ImportIssue[] } {
  return mapConversation(raw, 0, OBSERVED, newShapeStats());
}

function mapOk(raw: unknown): ConversationRecord {
  const { record, issues } = map(raw);
  expect(issues).toEqual([]);
  if (record === null) {
    throw new Error("expected a record");
  }
  return record;
}

function codes(raw: unknown): string[] {
  return map(raw).issues.map((i) => i.code);
}

/** Root-to-leaf paths of message texts; how DEV07 will show branches. */
function branches(record: ConversationRecord): string[][] {
  const byId = new Map(record.nodes.map((n) => [n.id, n]));
  const out: string[][] = [];
  const walk = (id: string, path: string[]) => {
    const node = byId.get(id);
    if (node === undefined) {
      throw new Error("dangling id");
    }
    const next = node.message === null ? path : [...path, node.message.text];
    if (node.childIds.length === 0) {
      out.push(next);
    }
    for (const child of node.childIds) {
      walk(child, next);
    }
  };
  for (const root of record.nodes.filter((n) => n.parentId === null)) {
    walk(root.id, []);
  }
  return out;
}

describe("mapConversation", () => {
  it("maps a well-formed conversation", () => {
    const record = mapOk(conversation(ID_A));
    expect(record).toMatchObject({
      provider: "chatgpt",
      scope: { status: "unverified", displayLabel: null },
      conversationId: ID_A,
      title: "Synthetic title",
      createdAt: "2023-11-14T22:13:20.500Z",
      updatedAt: "2023-11-14T22:15:00.000Z",
      archived: false,
      currentNodeId: "a1",
      observation: {
        observedAt: OBSERVED,
        source: "official-export",
        contentCoverage: "complete",
        activity: "unknown",
      },
    });
    expect(branches(record)).toEqual([["Synthetic question", "First answer"]]);
  });

  it("keeps branches separate instead of concatenating them (P-0001)", () => {
    const record = mapOk(conversation(ID_A, { branch: true }));
    expect(branches(record)).toEqual([
      ["Synthetic question", "First answer"],
      ["Synthetic question", "Second answer"],
    ]);
    expect(record.currentNodeId).toBe("a2");
  });

  it("treats missing timestamps as unknown, without an issue (AT05)", () => {
    const record = mapOk(
      conversation(ID_A, { overrides: { create_time: null, update_time: undefined } }),
    );
    expect(record.createdAt).toBeNull();
    expect(record.updatedAt).toBeNull();
  });

  it("accepts a missing conversation_id when id is present", () => {
    expect(
      mapOk(conversation(ID_A, { overrides: { conversation_id: undefined } })).conversationId,
    ).toBe(ID_A);
  });

  const rejected: ReadonlyArray<[string, unknown, string]> = [
    ["a non-object", "text", "not-object"],
    ["an array", [], "not-object"],
    [
      "a missing id",
      conversation(ID_A, { overrides: { id: undefined, conversation_id: undefined } }),
      "missing-id",
    ],
    ["an upper-case id", conversation(ID_A.toUpperCase()), "invalid-id"],
    ["an id with a path separator", conversation("../conversations"), "invalid-id"],
    [
      "differing id and conversation_id",
      conversation(ID_A, {
        overrides: { conversation_id: "7b2e1d3f-2c3d-4e4f-9a01-123456789abc" },
      }),
      "id-mismatch",
    ],
    [
      "a mapping that is not an object",
      conversation(ID_A, { overrides: { mapping: [] } }),
      "invalid-tree",
    ],
  ];

  for (const [label, raw, code] of rejected) {
    it(`rejects ${label}`, () => {
      const { record, issues } = map(raw);
      expect(record).toBeNull();
      expect(issues).toEqual([{ code, entry: "conversations.json[0]" }]);
    });
  }

  describe("tree validation", () => {
    function withMapping(edit: (m: Record<string, Record<string, unknown>>) => void): unknown {
      const raw = conversation(ID_A, { branch: true }) as {
        mapping: Record<string, Record<string, unknown>>;
      };
      edit(raw.mapping);
      return raw;
    }

    const broken: ReadonlyArray<[string, (m: Record<string, Record<string, unknown>>) => void]> = [
      [
        "a key that differs from the node id",
        (m) => {
          m["a1"] = { ...m["a1"], id: "zz" };
        },
      ],
      [
        "a child that does not exist",
        (m) => {
          m["a1"] = { ...m["a1"], children: ["ghost"] };
        },
      ],
      [
        "a parent that does not exist",
        (m) => {
          m["a1"] = { ...m["a1"], parent: "ghost" };
        },
      ],
      [
        "a child whose parent points elsewhere",
        (m) => {
          m["a2"] = { ...m["a2"], parent: "root" };
        },
      ],
      [
        "a parent that does not list the child",
        (m) => {
          m["u1"] = { ...m["u1"], children: ["a1"] };
        },
      ],
      [
        "a duplicated child",
        (m) => {
          m["u1"] = { ...m["u1"], children: ["a1", "a1", "a2"] };
        },
      ],
      [
        "a cycle detached from the root",
        (m) => {
          m["x"] = { id: "x", parent: "y", children: ["y"], message: null };
          m["y"] = { id: "y", parent: "x", children: ["x"], message: null };
        },
      ],
      [
        "children that are not strings",
        (m) => {
          m["u1"] = { ...m["u1"], children: [1] };
        },
      ],
      [
        "a node that is not an object",
        (m) => {
          m["a1"] = "node" as unknown as Record<string, unknown>;
        },
      ],
    ];

    for (const [label, edit] of broken) {
      it(`rejects ${label}`, () => {
        expect(codes(withMapping(edit))).toEqual(["invalid-tree"]);
        expect(map(withMapping(edit)).record).toBeNull();
      });
    }

    it("rejects a current_node outside the tree", () => {
      expect(codes(conversation(ID_A, { overrides: { current_node: "ghost" } }))).toEqual([
        "invalid-tree",
      ]);
    });

    it("accepts an empty tree with no current node", () => {
      const record = mapOk(conversation(ID_A, { overrides: { mapping: {}, current_node: null } }));
      expect(record.nodes).toEqual([]);
    });
  });

  it("keeps the record but lists an invalid timestamp", () => {
    const { record, issues } = map(conversation(ID_A, { overrides: { create_time: "yesterday" } }));
    expect(record?.createdAt).toBeNull();
    expect(issues).toEqual([{ code: "invalid-time", entry: "conversations.json[0]" }]);
  });

  it("lists out-of-range and non-finite timestamps", () => {
    expect(codes(conversation(ID_A, { overrides: { create_time: 0 } }))).toEqual(["invalid-time"]);
    expect(codes(conversation(ID_A, { overrides: { update_time: 1e12 } }))).toEqual([
      "invalid-time",
    ]);
  });

  it("keeps the record but lists a title or archive flag of the wrong type", () => {
    const { record, issues } = map(
      conversation(ID_A, { overrides: { title: 5, is_archived: "no" } }),
    );
    expect(record?.title).toBeNull();
    expect(record?.archived).toBeNull();
    expect(issues.map((i) => i.code)).toEqual(["invalid-field", "invalid-field"]);
  });

  describe("message content", () => {
    function single(msg: Record<string, unknown>): ConversationRecord {
      return mapOk(
        conversation(ID_A, {
          overrides: {
            mapping: { m: { id: "m", parent: null, children: [], message: msg } },
            current_node: "m",
          },
        }),
      );
    }

    it("keeps text as a plain string", () => {
      const record = single(message("user", "<img src=x onerror=alert(1)>"));
      expect(record.nodes[0]?.message?.text).toBe("<img src=x onerror=alert(1)>");
    });

    it("takes code text", () => {
      const record = single(
        message("assistant", "", { content: { content_type: "code", text: "x = 1" } }),
      );
      expect(record.nodes[0]?.message).toMatchObject({
        text: "x = 1",
        contentCoverage: "complete",
      });
    });

    it("marks multimodal content with non-text parts as partial", () => {
      const record = single(
        message("user", "", {
          content: {
            content_type: "multimodal_text",
            parts: [{ content_type: "image_asset_pointer" }, "Look at this"],
          },
        }),
      );
      expect(record.nodes[0]?.message).toMatchObject({
        text: "Look at this",
        contentCoverage: "partial",
      });
      expect(record.observation.contentCoverage).toBe("partial");
    });

    it("does not take text from unknown content types", () => {
      const record = single(
        message("tool", "", {
          content: { content_type: "tether_browsing_display", result: "secret" },
        }),
      );
      expect(record.nodes[0]?.message).toMatchObject({ text: "", contentCoverage: "none" });
      expect(record.observation.contentCoverage).toBe("partial");
    });

    it("maps unknown roles to unknown", () => {
      expect(single(message("critic", "x")).nodes[0]?.message?.role).toBe("unknown");
    });
  });

  it("collects shape statistics without content", () => {
    const stats = newShapeStats();
    mapConversation(
      conversation(ID_A, { branch: true, title: "Private title" }),
      0,
      OBSERVED,
      stats,
    );
    expect(stats.nodeCount).toBe(4);
    expect(stats.leafCount).toBe(2);
    expect(stats.maxTreeDepth).toBe(3);
    expect(stats.roles).toEqual({ user: 1, assistant: 2 });
    expect(stats.contentTypes).toEqual({ text: 3 });
    expect(stats.conversationKeys["mapping"]).toBe(1);
    expect(JSON.stringify(stats)).not.toMatch(/Private title|Synthetic|answer|6a1f0c2e/);
  });

  it("counts keys and roles named after Object.prototype members as numbers (DC2)", () => {
    const stats = newShapeStats();
    const raw = conversation(ID_A, { overrides: { constructor: 1, valueOf: 2 } });
    const mapping = raw["mapping"] as Record<string, { message: Record<string, unknown> }>;
    mapping["a1"] = { ...(mapping["a1"] as object), message: message("constructor", "x") } as {
      message: Record<string, unknown>;
    };
    mapConversation(raw, 0, OBSERVED, stats);
    expect(stats.conversationKeys["constructor"]).toBe(1);
    expect(stats.roles["constructor"]).toBe(1);
    expect(typeof stats.roles["user"]).toBe("number");
    expect(Object.values(stats.conversationKeys).every((v) => typeof v === "number")).toBe(true);
  });

  it("buckets key names and values that do not look like schema tokens", () => {
    const stats = newShapeStats();
    mapConversation(conversation(ID_A, { overrides: { "My secret note": 1 } }), 0, OBSERVED, stats);
    expect(stats.conversationKeys["(other)"]).toBe(1);
    expect(JSON.stringify(stats)).not.toContain("secret");
  });
});
