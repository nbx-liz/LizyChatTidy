import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DELETE_DESCRIPTOR, fakeId, fakeRecord } from "../adapters/testing/synthetic";
import { FakeArea } from "../keep/testing/fakes";
import { Pacer } from "./calls";
import { canonicalJson } from "./canonical";
import type { InventorySnapshot } from "./inventory";
import {
  ledgerKey,
  parseLedger,
  readLedger,
  withOneLessPending,
  withOneMorePending,
} from "./ledger";
import { buildPlan, digestOf } from "./plan";
import { FakeClock } from "./testing/fakes";
import { approved, rig } from "./testing/harness";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe("canonical JSON", () => {
  it("sorts keys at every depth and rejects non-JSON values", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x"], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,"x"]},"b":1}',
    );
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
  });
});

function snapshotOf(ids: number[]): InventorySnapshot {
  return {
    snapshotId: "s",
    source: "web-api",
    provider: "chatgpt",
    adapter: { adapterId: "synthetic", version: "0.0.1-test" },
    importVersion: null,
    subject: { status: "verified", accountKey: "a", workspaceKey: "w", workspaceKind: "personal" },
    documentKey: "doc-1",
    ledgerEpoch: 0,
    records: new Map(ids.map((n) => [fakeId(n), fakeRecord(n)])),
    duplicateIds: new Set(),
    invalidCount: 0,
    issues: new Set(),
    completeness: "complete",
    capturedAt: 1,
  };
}

describe("plan digest", () => {
  const base = {
    keep: { entries: [], revision: 1, storeId: "store", generation: 1 },
    del: DELETE_DESCRIPTOR,
    parentPlanId: null,
    now: 5,
    newId: () => "11111111-1111-4111-8111-111111111111",
    subtle,
  };

  it("does not depend on the selection order and covers every field", async () => {
    const a = await buildPlan({
      ...base,
      snapshot: snapshotOf([1, 2]),
      ids: [fakeId(1), fakeId(2)],
    });
    const b = await buildPlan({
      ...base,
      snapshot: snapshotOf([1, 2]),
      ids: [fakeId(2), fakeId(1)],
    });
    expect(a.ok && b.ok && a.plan.planDigest === b.plan.planDigest).toBe(true);
    if (!a.ok) {
      throw new Error("plan expected");
    }
    const { planDigest, ...body } = a.plan;
    expect(await digestOf(subtle, body)).toBe(planDigest);
    expect(await digestOf(subtle, { ...body, documentKey: "doc-2" })).not.toBe(planDigest);
    expect(await digestOf(subtle, { ...body, keep: { ...body.keep, revision: 2 } })).not.toBe(
      planDigest,
    );
  });

  it("refuses a snapshot from the official export even with targets selected (INV-06)", async () => {
    const snap = { ...snapshotOf([1]), source: "official-export" as const };
    const res = await buildPlan({ ...base, snapshot: snap, ids: [fakeId(1)] });
    expect(res).toMatchObject({ ok: false, excluded: { "subject-unverified": 1 } });
  });
});

describe("run ledger", () => {
  it("counts pending writes up and down and holds no ids", () => {
    const empty = {
      format: "lizychattidy-run-ledger",
      schemaVersion: 1,
      provider: "chatgpt",
      epoch: 0,
      pending: null,
    } as const;
    const one = withOneMorePending(empty, 10, () => "22222222-2222-4222-8222-222222222222");
    const two = withOneMorePending(one, 20, () => "unused");
    expect(two.pending).toMatchObject({ count: 2, firstDispatchedAt: 10, lastDispatchedAt: 20 });
    expect(withOneLessPending(withOneLessPending(two)).pending).toBeNull();
    expect(parseLedger(JSON.parse(JSON.stringify(two)), "chatgpt")).toEqual(two);
  });

  it("treats malformed and unreadable ledgers as blocking", async () => {
    const area = new FakeArea();
    area.data.set(ledgerKey("chatgpt"), { format: "lizychattidy-run-ledger", schemaVersion: 2 });
    expect((await readLedger(area.view(), "chatgpt")).kind).toBe("malformed");
    area.failGet = true;
    expect((await readLedger(area.view(), "chatgpt")).kind).toBe("read-failed");
  });

  it("a failed write-ahead stops the run before any dispatch", async () => {
    const r = await rig();
    const id = await approved(r);
    r.service.onPrepare = async () => {
      r.profile.area.failSet = true;
    };
    await r.controller.start(id);
    expect(r.service.commits()).toEqual([]);
    expect(r.controller.phase).toBe("failed");
  });
});

describe("Pacer", () => {
  it("waits a full interval after reset and between requests", async () => {
    const clock = new FakeClock();
    const pacer = new Pacer(clock, 1_000);
    pacer.reset();
    await pacer.beforeRequest();
    await pacer.beforeRequest();
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });
});

describe("inventory issues", () => {
  it("a cursor that repeats ends the scan as partial", async () => {
    const r = await rig();
    r.service.override = (op, ctx) =>
      op === "listPage"
        ? {
            execId: (ctx as { execId: string }).execId,
            ok: true,
            value: {
              subject: r.service.subject,
              documentKey: "doc-1",
              records: [],
              next: { kind: "cursor", cursor: "same" },
              reportedTotal: null,
            },
          }
        : undefined;
    expect((await r.controller.collect()).ok).toBe(true);
    expect(r.controller.snapshot?.issues.has("cursor-repeat")).toBe(true);
    expect(r.controller.snapshot?.completeness).toBe("partial");
  });

  it("an order reversal and an invalid record make the snapshot partial", async () => {
    const r = await rig();
    r.service.add(fakeRecord(2, { updatedAt: "2026-03-01T00:00:00Z" }));
    r.service.override = (op, ctx) => {
      if (op !== "listPage") {
        return undefined;
      }
      return {
        execId: (ctx as { execId: string }).execId,
        ok: true,
        value: {
          subject: r.service.subject,
          documentKey: "doc-1",
          records: [
            fakeRecord(1),
            fakeRecord(2, { updatedAt: "2026-03-01T00:00:00Z" }),
            { bad: true },
          ],
          next: { kind: "end" },
          reportedTotal: null,
        },
      };
    };
    await r.controller.collect();
    const issues = r.controller.snapshot?.issues;
    expect(issues?.has("order-reversal")).toBe(true);
    expect(issues?.has("invalid-record")).toBe(true);
    expect(r.controller.snapshot?.invalidCount).toBe(1);
  });
});
