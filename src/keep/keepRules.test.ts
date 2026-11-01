import { describe, expect, it } from "vitest";
import { hasEntry, isCanonicalId, isProtected, type KeepEntry, withEntry } from "./keepRules";

const ID = "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab";
const OTHER = "7b2e1d3f-2c3d-4e4f-9a01-123456789abc";
const A = { accountKey: "acct-a", workspaceKey: "ws-1" };
const B = { accountKey: "acct-b", workspaceKey: "ws-1" };

describe("isProtected (P-0001 item 1, KINV-7)", () => {
  const unscoped: KeepEntry = { provider: "chatgpt", conversationId: ID, scope: null };
  const scopedA: KeepEntry = { provider: "chatgpt", conversationId: ID, scope: A };

  it("protects every subject's same id with a scope-null entry", () => {
    expect(isProtected([unscoped], { provider: "chatgpt", conversationId: ID, scope: A })).toBe(
      true,
    );
    expect(isProtected([unscoped], { provider: "chatgpt", conversationId: ID, scope: null })).toBe(
      true,
    );
  });

  it("does not protect a different id or provider (exact match)", () => {
    expect(
      isProtected([unscoped], { provider: "chatgpt", conversationId: OTHER, scope: null }),
    ).toBe(false);
    expect(
      isProtected([unscoped], { provider: "claude-code", conversationId: ID, scope: null }),
    ).toBe(false);
    expect(
      isProtected([unscoped], {
        provider: "chatgpt",
        conversationId: ID.slice(0, 35),
        scope: null,
      }),
    ).toBe(false);
  });

  it("protects with a scoped entry only the same subject", () => {
    expect(isProtected([scopedA], { provider: "chatgpt", conversationId: ID, scope: A })).toBe(
      true,
    );
    expect(isProtected([scopedA], { provider: "chatgpt", conversationId: ID, scope: B })).toBe(
      false,
    );
    expect(isProtected([scopedA], { provider: "chatgpt", conversationId: ID, scope: null })).toBe(
      false,
    );
  });
});

describe("entry list helpers", () => {
  const e: KeepEntry = { provider: "chatgpt", conversationId: ID, scope: null };

  it("adds once and removes without mutating", () => {
    const empty: readonly KeepEntry[] = [];
    const one = withEntry(empty, e, true);
    expect(one).toEqual([e]);
    expect(withEntry(one, e, true)).toEqual([e]);
    expect(withEntry(one, e, false)).toEqual([]);
    expect(empty).toEqual([]);
    expect(hasEntry(one, e)).toBe(true);
    expect(hasEntry(one, { ...e, scope: A })).toBe(false);
  });

  it("validates the canonical ChatGPT id form", () => {
    expect(isCanonicalId("chatgpt", ID)).toBe(true);
    expect(isCanonicalId("chatgpt", ID.toUpperCase())).toBe(false);
    expect(isCanonicalId("chatgpt", "../conversations")).toBe(false);
    expect(isCanonicalId("claude-code", ID)).toBe(false);
  });
});
