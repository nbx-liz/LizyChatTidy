import { describe, expect, it } from "vitest";
import {
  branchEndingAt,
  branchEnds,
  branchEndsThrough,
  defaultBranchEnd,
  leafIds,
} from "./branches";
import { branchedNodes, record } from "./testing/records";

const texts = (end: string, r = record({ nodes: branchedNodes(), currentNodeId: "a2" })) =>
  branchEndingAt(r, end)?.nodes.map((n) => n.message?.text);

describe("branches", () => {
  const branched = record({ nodes: branchedNodes(), currentNodeId: "a2" });

  it("returns the root-to-end path without joining branches", () => {
    expect(texts("a1")).toEqual(["Question", "First answer"]);
    expect(texts("a2")).toEqual(["Question", "Second answer"]);
  });

  it("lists leaves in tree order", () => {
    expect(leafIds(branched)).toEqual(["a1", "a2"]);
  });

  it("defaults to the branch ending at the current node", () => {
    expect(defaultBranchEnd(branched)).toBe("a2");
  });

  it("falls back to the first leaf when the current node is missing", () => {
    expect(defaultBranchEnd(record({ nodes: branchedNodes(), currentNodeId: null }))).toBe("a1");
    expect(defaultBranchEnd(record({ nodes: branchedNodes(), currentNodeId: "ghost" }))).toBe("a1");
  });

  it("offers a non-leaf current node as its own branch end", () => {
    expect(branchEnds(record({ nodes: branchedNodes(), currentNodeId: "u" }))).toEqual([
      "u",
      "a1",
      "a2",
    ]);
  });

  it("finds the branches through a matched node", () => {
    expect(branchEndsThrough(branched, "u")).toEqual(["a1", "a2"]);
    expect(branchEndsThrough(branched, "a2")).toEqual(["a2"]);
  });

  it("handles an empty tree", () => {
    const empty = record({ nodes: [], currentNodeId: null });
    expect(defaultBranchEnd(empty)).toBeNull();
    expect(branchEndingAt(empty, "x")).toBeNull();
  });
});
