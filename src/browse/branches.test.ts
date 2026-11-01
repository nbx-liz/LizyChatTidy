import { describe, expect, it } from "vitest";
import type { ConversationNode } from "../import/types";
import { createBranchIndex } from "./branches";
import { branchedNodes, record } from "./testing/records";

describe("createBranchIndex", () => {
  const branched = createBranchIndex(record({ nodes: branchedNodes(), currentNodeId: "a2" }));
  const texts = (end: string) => branched.path(end)?.nodes.map((n) => n.message?.text);

  it("returns the root-to-end path without joining branches", () => {
    expect(texts("a1")).toEqual(["Question", "First answer"]);
    expect(texts("a2")).toEqual(["Question", "Second answer"]);
  });

  it("lists leaves in tree order and defaults to the current node", () => {
    expect(branched.ends).toEqual(["a1", "a2"]);
    expect(branched.defaultEnd).toBe("a2");
    expect(branched.currentKnown).toBe(true);
  });

  it("falls back to the first leaf when the current node is missing or unknown", () => {
    for (const currentNodeId of [null, "ghost"]) {
      const index = createBranchIndex(record({ nodes: branchedNodes(), currentNodeId }));
      expect(index.defaultEnd).toBe("a1");
      expect(index.currentKnown).toBe(false);
    }
  });

  it("offers a non-leaf current node as its own branch end", () => {
    expect(createBranchIndex(record({ nodes: branchedNodes(), currentNodeId: "u" })).ends).toEqual([
      "u",
      "a1",
      "a2",
    ]);
  });

  it("handles an empty tree", () => {
    const empty = createBranchIndex(record({ nodes: [], currentNodeId: null }));
    expect(empty.defaultEnd).toBeNull();
    expect(empty.ends).toEqual([]);
    expect(empty.path("x")).toBeNull();
  });

  it("handles a very wide tree without exceeding call limits (PR #7 review)", () => {
    const width = 150_000;
    const childIds = Array.from({ length: width }, (_, i) => `c${i}`);
    const msg = {
      role: "assistant" as const,
      createdAt: null,
      text: "x",
      contentCoverage: "complete" as const,
    };
    const nodes: ConversationNode[] = [
      { id: "root", parentId: null, childIds, message: null },
      ...childIds.map((id) => ({ id, parentId: "root", childIds: [], message: msg })),
    ];
    const index = createBranchIndex(record({ nodes, currentNodeId: "c7" }));
    expect(index.ends).toHaveLength(width);
    expect(index.ends[0]).toBe("c0");
    expect(index.path("c149999")?.nodes.map((n) => n.id)).toEqual(["root", "c149999"]);
  });

  it("finds the ends through matched nodes", () => {
    expect([...branched.endsThrough(new Set(["u"]))]).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect([...branched.endsThrough(new Set(["a2"]))]).toEqual(["a2"]);
    expect(branched.endsThrough(new Set())).toEqual(new Set());
    const nonLeaf = createBranchIndex(record({ nodes: branchedNodes(), currentNodeId: "u" }));
    expect(nonLeaf.endsThrough(new Set(["u"])).has("u")).toBe(true);
    expect(nonLeaf.endsThrough(new Set(["a1"])).has("u")).toBe(false);
  });

  it("labels branches of a long shared prefix with many leaves in linear time (PR #7 review)", () => {
    const prefix = 15_000;
    const width = 15_000;
    const msg = {
      role: "user" as const,
      createdAt: null,
      text: "x",
      contentCoverage: "complete" as const,
    };
    const leafIds = Array.from({ length: width }, (_, i) => `l${i}`);
    const nodes: ConversationNode[] = [
      ...Array.from({ length: prefix }, (_, i) => ({
        id: `p${i}`,
        parentId: i === 0 ? null : `p${i - 1}`,
        childIds: i + 1 < prefix ? [`p${i + 1}`] : leafIds,
        message: msg,
      })),
      ...leafIds.map((id) => ({ id, parentId: `p${prefix - 1}`, childIds: [], message: msg })),
    ];
    const index = createBranchIndex(record({ nodes, currentNodeId: "l0" }));
    const started = performance.now();
    const ends = index.endsThrough(new Set(["p0"]));
    const elapsed = performance.now() - started;
    expect(ends.size).toBe(width);
    // A per-end path walk took about 6 s on this shape; a linear pass takes milliseconds.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("handles a very deep tree", () => {
    const depth = 50_000;
    const msg = {
      role: "user" as const,
      createdAt: null,
      text: "x",
      contentCoverage: "complete" as const,
    };
    const nodes: ConversationNode[] = Array.from({ length: depth }, (_, i) => ({
      id: `d${i}`,
      parentId: i === 0 ? null : `d${i - 1}`,
      childIds: i + 1 < depth ? [`d${i + 1}`] : [],
      message: msg,
    }));
    const index = createBranchIndex(record({ nodes, currentNodeId: null }));
    expect(index.ends).toEqual([`d${depth - 1}`]);
    expect(index.path(`d${depth - 1}`)?.nodes).toHaveLength(depth);
  });
});
