// P-0009 item 8: binding() and withOrderedSnapshot().
import { describe, expect, it } from "vitest";
import type { KeepEntry } from "./keepRules";
import { KeepStore, type OrderedKeepView } from "./keepStore";
import { deferred, deps, FakeArea, FakeLocks, settle } from "./testing/fakes";

const PASS = "correct horse battery";
const ID1 = "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab";
const keep = (id: string): KeepEntry => ({ provider: "chatgpt", conversationId: id, scope: null });

async function created(area = new FakeArea(), locks = new FakeLocks()) {
  const store = new KeepStore(deps(area, {}, locks));
  await store.init();
  expect(await store.create(PASS, true)).toBe("ok");
  return store;
}

describe("binding()", () => {
  it("returns entries, revision, storeId and generation together while available", async () => {
    const store = await created();
    await store.setKeep(keep(ID1), true);
    const b = store.binding();
    expect(b?.entries).toEqual([keep(ID1)]);
    expect(b?.revision).toBe(2);
    expect(typeof b?.storeId).toBe("string");
  });

  it("is null once lock() has dropped the session, even before locked is published", async () => {
    const area = new FakeArea();
    const store = await created(area);
    const gate = deferred();
    area.setGate = gate.promise;
    const write = store.setKeep(keep(ID1), true);
    await settle();
    const locking = store.lock();
    expect(store.current.status).toBe("available");
    expect(store.binding()).toBeNull();
    gate.resolve();
    await write;
    await locking;
  });

  it("changes generation across lock and unlock", async () => {
    const store = await created();
    const before = store.binding()?.generation;
    await store.lock();
    await store.unlock(PASS);
    expect(store.binding()?.generation).not.toBe(before);
  });
});

describe("withOrderedSnapshot()", () => {
  it("runs after a KEEP write queued before it", async () => {
    const store = await created();
    const write = store.setKeep(keep(ID1), true);
    const seen = await store.withOrderedSnapshot((v) =>
      v.status === "available" ? v.entries.length : -1,
    );
    await write;
    expect(seen).toBe(1);
  });

  it("holds back a KEEP write requested from inside fn until fn returns", async () => {
    const store = await created();
    let inner: Promise<unknown> | null = null;
    const seen = await store.withOrderedSnapshot((v) => {
      inner = store.setKeep(keep(ID1), true);
      return v.status === "available" ? v.entries.length : -1;
    });
    expect(seen).toBe(0);
    expect(await inner).toBe("ok");
  });

  it("reports not-available when locked", async () => {
    const store = await created();
    await store.lock();
    const v = await store.withOrderedSnapshot((view) => view);
    expect(v).toEqual({ status: "not-available", reason: "state" });
  });

  it("detects another tab's write under the lock and fails the store as a conflict", async () => {
    const area = new FakeArea();
    const locks = new FakeLocks();
    const a = await created(area, locks);
    const b = new KeepStore(deps(area, {}, locks));
    await b.init();
    await b.unlock(PASS);
    area.notify = false; // the change event has not arrived yet
    await b.setKeep(keep(ID1), true);
    const v: OrderedKeepView = await a.withOrderedSnapshot((view) => view);
    expect(v).toEqual({ status: "not-available", reason: "conflict" });
    expect(a.current).toEqual({ status: "unavailable", reason: "conflict" });
  });

  it("calls fn exactly once", async () => {
    const store = await created();
    let calls = 0;
    await store.withOrderedSnapshot(() => {
      calls++;
    });
    expect(calls).toBe(1);
  });
});
