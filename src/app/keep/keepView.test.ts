import { describe, expect, it } from "vitest";
import { record } from "../../browse/testing/records";
import type { KeepEntry } from "../../keep/keepRules";
import { entryFor, keepViewOf } from "./keepView";

const noop = async () => "ok" as const;

describe("keepViewOf", () => {
  const r = record();
  const entry: KeepEntry = { provider: "chatgpt", conversationId: r.conversationId, scope: null };

  it("claims nothing outside the available state (INV-05)", () => {
    for (const state of [
      { status: "loading" } as const,
      { status: "absent" } as const,
      { status: "locked", error: null } as const,
      { status: "corrupt", problem: "structure" } as const,
      { status: "unavailable", reason: "conflict" } as const,
    ]) {
      const view = keepViewOf(state, noop);
      expect(view.count).toBeNull();
      expect(view.isKept(r)).toBeNull();
      expect(view.blockedReason).not.toBeNull();
    }
  });

  it("reports marks and the count when available", () => {
    const view = keepViewOf({ status: "available", entries: [entry], revision: 2 }, noop);
    expect(view.count).toBe(1);
    expect(view.isKept(r)).toBe(true);
    expect(view.isKept(record())).toBe(false);
    expect(view.blockedReason).toBeNull();
  });

  it("marks export records with scope null (P-0001)", () => {
    expect(entryFor(r)).toEqual(entry);
  });

  it("passes the record's entry and the wanted state to the store", async () => {
    const calls: Array<[KeepEntry, boolean]> = [];
    const view = keepViewOf({ status: "available", entries: [], revision: 1 }, async (e, k) => {
      calls.push([e, k]);
      return "ok";
    });
    await view.toggle(r, true);
    expect(calls).toEqual([[entry, true]]);
  });
});
