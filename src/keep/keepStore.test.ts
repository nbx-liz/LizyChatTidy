import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveKey, open } from "./crypto";
import { aadOf, fromBase64, parseEnvelope, STORAGE_KEY } from "./envelope";
import type { KeepEntry } from "./keepRules";
import { KeepStore } from "./keepStore";
import { deferred, deps, FakeArea, FakeLocks, settle } from "./testing/fakes";

const PASS = "correct horse battery";
const ID1 = "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab";
const ID2 = "7b2e1d3f-2c3d-4e4f-9a01-123456789abc";
const keep = (id: string): KeepEntry => ({ provider: "chatgpt", conversationId: id, scope: null });
const subtle = webcrypto.subtle as unknown as SubtleCrypto;

/** Mutable view of a stored envelope for tampering in tests. */
interface RawEnvelope {
  storeId: string;
  kdf: { salt: string; iterations: number };
  cipher: { iv: string };
  revision: number;
}

async function started(area = new FakeArea(), locks = new FakeLocks(), extra = {}) {
  const store = new KeepStore(deps(area, extra, locks));
  await store.init();
  return store;
}

async function created(area = new FakeArea(), locks = new FakeLocks()) {
  const store = await started(area, locks);
  expect(await store.create(PASS, true)).toBe("ok");
  return store;
}

async function decryptStored(area: FakeArea, passphrase = PASS): Promise<unknown> {
  const parsed = parseEnvelope(area.data.get(STORAGE_KEY));
  if (!parsed.ok) {
    throw new Error("stored envelope invalid");
  }
  const e = parsed.envelope;
  const key = await deriveKey(
    subtle,
    passphrase,
    fromBase64(e.kdf.salt) as Uint8Array,
    e.kdf.iterations,
  );
  const plain = await open(
    subtle,
    key,
    fromBase64(e.cipher.iv) as Uint8Array,
    aadOf(e),
    fromBase64(e.ciphertext) as Uint8Array,
  );
  return JSON.parse(new TextDecoder().decode(plain as Uint8Array));
}

describe("access restriction (KINV-8)", () => {
  for (const level of ["missing", "reject"] as const) {
    it(`fails closed without reading storage when setAccessLevel is ${level}`, async () => {
      const area = new FakeArea();
      const store = new KeepStore({ ...deps(area), storage: area.view(level) });
      await store.init();
      expect(store.current).toEqual({ status: "unavailable", reason: "access-level" });
      expect(store.accessRestricted).toBe(false);
      expect(area.getCalls).toBe(0);
      expect(await store.create(PASS, true)).toBe("not-allowed");
      expect(await store.reload()).toBe("not-allowed");
    });
  }
});

describe("creation (KINV-2)", () => {
  it("starts absent and never creates a store by itself", async () => {
    const area = new FakeArea();
    const store = await started(area);
    expect(store.current).toEqual({ status: "absent" });
    expect(area.data.size).toBe(0);
  });

  it("requires consent and a 12-character passphrase", async () => {
    const store = await started();
    expect(await store.create(PASS, false)).toBe("no-consent");
    expect(await store.create("short", true)).toBe("short-passphrase");
    expect(store.current.status).toBe("absent");
  });

  it("creates an encrypted store holding exactly the permitted fields (KINV-5)", async () => {
    const area = new FakeArea();
    const store = await created(area);
    expect(store.current).toEqual({ status: "available", entries: [], revision: 1 });
    expect(await store.setKeep(keep(ID1), true)).toBe("ok");
    expect(await decryptStored(area)).toEqual({
      revision: 2,
      entries: [{ provider: "chatgpt", conversationId: ID1, scope: null }],
    });
    const raw = JSON.stringify(area.data.get(STORAGE_KEY));
    expect(raw).not.toContain(ID1);
  });

  it("lets only one of two simultaneous creators write", async () => {
    const area = new FakeArea();
    const locks = new FakeLocks();
    const a = await started(area, locks);
    const b = await started(area, locks);
    const results = await Promise.all([a.create(PASS, true), b.create("another passphrase", true)]);
    // The loser is stopped either by the lock-time check (failed) or, earlier,
    // by the winner's change notification (superseded); it never writes.
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "failed" || r === "superseded")).toHaveLength(1);
    expect(area.setCalls).toBe(1);
    await settle();
    const loser = results[0] === "ok" ? b : a;
    expect(loser.current.status).toBe("unavailable");
  });

  it("refuses creation from any state but absent", async () => {
    const store = await created();
    expect(await store.create(PASS, true)).toBe("not-allowed");
    await store.lock();
    expect(await store.create(PASS, true)).toBe("not-allowed");
  });
});

describe("unlock (KINV-1)", () => {
  it("stays locked on a wrong passphrase and opens with the right one", async () => {
    const area = new FakeArea();
    const first = await created(area);
    await first.setKeep(keep(ID1), true);
    const second = await started(area);
    expect(second.current).toEqual({ status: "locked", error: null });
    expect(await second.unlock("wrong passphrase!")).toBe("wrong-passphrase");
    expect(second.current).toEqual({ status: "locked", error: "wrong-or-corrupt" });
    expect(await second.unlock(PASS)).toBe("ok");
    expect(second.current).toEqual({ status: "available", entries: [keep(ID1)], revision: 2 });
  });

  it("does not publish an unlock that a foreign change overtook", async () => {
    const area = new FakeArea();
    await created(area);
    const reader = await started(area);
    const pending = reader.unlock(PASS);
    area.data.set("noise", 1);
    // A foreign write to the KEEP key while the key is being derived.
    const other = await started(area);
    expect(other.current.status).toBe("locked");
    const stored = area.data.get(STORAGE_KEY) as Record<string, unknown>;
    await area.view().set({ [STORAGE_KEY]: { ...stored, revision: 99 } });
    expect(["superseded", "wrong-passphrase", "ok"]).toContain(await pending);
    await settle();
    expect(reader.current).toEqual({ status: "unavailable", reason: "changed-elsewhere" });
  });

  it("marks authenticated but malformed plaintext as corrupt", async () => {
    const area = new FakeArea();
    const store = await created(area);
    await store.lock();
    // Re-seal a plaintext whose revision disagrees with the header.
    const e = (
      parseEnvelope(area.data.get(STORAGE_KEY)) as {
        ok: true;
        envelope: import("./envelope").Envelope;
      }
    ).envelope;
    const key = await deriveKey(
      subtle,
      PASS,
      fromBase64(e.kdf.salt) as Uint8Array,
      e.kdf.iterations,
    );
    const bad = new TextEncoder().encode(JSON.stringify({ revision: 7, entries: [] }));
    const ct = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(e.cipher.iv) as BufferSource,
        additionalData: aadOf(e) as BufferSource,
      },
      key,
      bad,
    );
    area.notify = false;
    await area
      .view()
      .set({ [STORAGE_KEY]: { ...e, ciphertext: Buffer.from(ct).toString("base64") } });
    expect(await store.unlock(PASS)).toBe("failed");
    expect(store.current).toEqual({ status: "corrupt", problem: "plaintext" });
  });

  it("detects tampering with every authenticated header field", async () => {
    const area = new FakeArea();
    const store = await created(area);
    await store.lock();
    const original = structuredClone(area.data.get(STORAGE_KEY)) as RawEnvelope;
    const other16 = Buffer.alloc(16, 9).toString("base64");
    const tampers: Array<(e: RawEnvelope) => void> = [
      (e) => {
        e.storeId = other16;
      },
      (e) => {
        e.kdf.salt = other16;
      },
      (e) => {
        e.kdf.iterations = 100_001;
      },
      (e) => {
        e.cipher.iv = Buffer.alloc(12, 3).toString("base64");
      },
      (e) => {
        e.revision = 5;
      },
    ];
    area.notify = false;
    for (const tamper of tampers) {
      const copy = structuredClone(original);
      tamper(copy);
      area.data.set(STORAGE_KEY, copy);
      const fresh = await started(area);
      expect(await fresh.unlock(PASS)).toBe("wrong-passphrase");
    }
  });
});

describe("corrupt and unknown stores (KINV-4, AT13, AT14)", () => {
  const cases: ReadonlyArray<[string, unknown, string]> = [
    ["not an object", "garbage", "structure"],
    ["a newer schema version", { format: "lizychattidy-keep", schemaVersion: 2 }, "version"],
    ["an extra field", { format: "lizychattidy-keep", schemaVersion: 1, extra: 1 }, "structure"],
  ];
  for (const [label, value, problem] of cases) {
    it(`treats ${label} as corrupt, never as empty, and never overwrites it`, async () => {
      const area = new FakeArea();
      area.data.set(STORAGE_KEY, value);
      const store = await started(area);
      expect(store.current).toEqual({ status: "corrupt", problem });
      expect(await store.create(PASS, true)).toBe("not-allowed");
      expect(await store.setKeep(keep(ID1), true)).toBe("not-allowed");
      expect(area.data.get(STORAGE_KEY)).toEqual(value);
    });
  }

  it("treats an out-of-range KDF as corrupt", async () => {
    const area = new FakeArea();
    const store = await created(area);
    const e = structuredClone(area.data.get(STORAGE_KEY)) as RawEnvelope;
    e.kdf.iterations = 1_000;
    area.notify = false;
    area.data.set(STORAGE_KEY, e);
    await store.reload();
    expect(store.current).toEqual({ status: "corrupt", problem: "kdf-range" });
  });

  it("maps a failed read to unavailable", async () => {
    const area = new FakeArea();
    area.failGet = true;
    const store = await started(area);
    expect(store.current).toEqual({ status: "unavailable", reason: "read-failed" });
  });
});

describe("writes (KINV-3)", () => {
  it("refuses a write after another tab wrote, without overwriting", async () => {
    const area = new FakeArea();
    const locks = new FakeLocks();
    const a = await created(area, locks);
    const b = await started(area, locks);
    await b.unlock(PASS);
    area.notify = false; // the change notification has not arrived yet
    expect(await a.setKeep(keep(ID1), true)).toBe("ok");
    expect(await b.setKeep(keep(ID2), true)).toBe("failed");
    expect(b.current).toEqual({ status: "unavailable", reason: "conflict" });
    expect(await decryptStored(area)).toEqual({ revision: 2, entries: [keep(ID1)] });
  });

  it("refuses a write after the store was deleted and recreated to the same revision", async () => {
    const area = new FakeArea();
    const locks = new FakeLocks();
    const a = await created(area, locks);
    area.notify = false;
    const b = await started(area, locks);
    expect(await b.deleteStore(b.observedToken())).toBe("ok");
    expect(await b.create(PASS, true)).toBe("ok");
    expect(a.current).toMatchObject({ status: "available", revision: 1 });
    expect(await a.setKeep(keep(ID1), true)).toBe("failed");
    expect(a.current).toEqual({ status: "unavailable", reason: "conflict" });
    expect(await decryptStored(area)).toEqual({ revision: 1, entries: [] });
  });

  it("reports a rejected set as write-failed and keeps the stored data", async () => {
    const area = new FakeArea();
    const store = await created(area);
    area.failSet = true;
    expect(await store.setKeep(keep(ID1), true)).toBe("failed");
    expect(store.current).toEqual({ status: "unavailable", reason: "write-failed" });
    expect(await decryptStored(area)).toEqual({ revision: 1, entries: [] });
  });

  it("preserves the KDF parameters of the unlocked store", async () => {
    const area = new FakeArea();
    await created(area);
    const before = structuredClone(area.data.get(STORAGE_KEY)) as RawEnvelope;
    const store = new KeepStore(deps(area, { iterations: 600_000 }));
    await store.init();
    await store.unlock(PASS);
    await store.setKeep(keep(ID1), true);
    const after = area.data.get(STORAGE_KEY) as RawEnvelope;
    expect(after.kdf).toEqual(before.kdf);
    expect(after.storeId).toBe(before.storeId);
    expect(after.cipher.iv).not.toBe(before.cipher.iv);
  });

  it("ignores its own change notifications but stops on a foreign one", async () => {
    const area = new FakeArea();
    const store = await created(area);
    await store.setKeep(keep(ID1), true);
    await settle();
    expect(store.current.status).toBe("available");
    await area.view().remove(STORAGE_KEY);
    await settle();
    expect(store.current).toEqual({ status: "unavailable", reason: "changed-elsewhere" });
  });
});

describe("lock and pending work (KINV-6)", () => {
  it("waits for a write already sent, then sends no further write", async () => {
    const area = new FakeArea();
    const store = await created(area);
    const gate = deferred();
    area.setGate = gate.promise;
    const first = store.setKeep(keep(ID1), true);
    const second = store.setKeep(keep(ID2), true);
    await settle();
    const locking = store.lock();
    gate.resolve();
    await locking;
    expect(await first).toBe("superseded");
    expect(await second).toBe("superseded");
    expect(store.current).toEqual({ status: "locked", error: null });
    expect(area.setCalls).toBe(2); // creation + the write that was already sent
    expect(await store.setKeep(keep(ID2), true)).toBe("not-allowed");
  });
});

describe("Web Lock timeout applies to acquisition only", () => {
  it("times out a waiting writer while the holder keeps the lock through a slow set", async () => {
    const area = new FakeArea();
    const locks = new FakeLocks();
    const a = await created(area, locks);
    area.notify = false;
    const b = new KeepStore(deps(area, { lockTimeoutMs: 30 }, locks));
    await b.init();
    await b.unlock(PASS);
    const gate = deferred();
    area.setGate = gate.promise;
    const slow = a.setKeep(keep(ID1), true);
    await settle();
    expect(await b.setKeep(keep(ID2), true)).toBe("failed");
    expect(b.current).toEqual({ status: "unavailable", reason: "lock-timeout" });
    expect(locks.held).toBe(1);
    gate.resolve();
    expect(await slow).toBe("ok");
    expect(locks.maxHeld).toBe(1);
    expect(await decryptStored(area)).toEqual({ revision: 2, entries: [keep(ID1)] });
  });

  it("is unavailable without Web Locks", async () => {
    const area = new FakeArea();
    const store = new KeepStore({ ...deps(area), locks: null });
    await store.init();
    expect(await store.create(PASS, true)).toBe("failed");
    expect(store.current).toEqual({ status: "unavailable", reason: "lock-unavailable" });
  });
});

describe("rollback and replacement (P-0007 item 8)", () => {
  it("refuses an older envelope of the same store until the user adopts it", async () => {
    const area = new FakeArea();
    const store = await created(area);
    const old = structuredClone(area.data.get(STORAGE_KEY));
    await store.setKeep(keep(ID1), true);
    await store.lock();
    area.notify = false;
    area.data.set(STORAGE_KEY, old);
    await store.reload();
    expect(store.current).toEqual({ status: "unavailable", reason: "regressed" });
    expect(await store.adopt()).toBe("ok");
    expect(store.current.status).toBe("locked");
  });

  it("refuses a different store id", async () => {
    const area = new FakeArea();
    const store = await created(area);
    await store.lock();
    const e = structuredClone(area.data.get(STORAGE_KEY)) as RawEnvelope;
    e.storeId = Buffer.alloc(16, 1).toString("base64");
    area.notify = false;
    area.data.set(STORAGE_KEY, e);
    await store.reload();
    expect(store.current).toEqual({ status: "unavailable", reason: "replaced" });
  });
});

describe("deletion (AT32)", () => {
  it("deletes the confirmed envelope and returns to absent", async () => {
    const area = new FakeArea();
    const store = await created(area);
    expect(await store.deleteStore(store.observedToken())).toBe("ok");
    expect(store.current).toEqual({ status: "absent" });
    expect(area.data.has(STORAGE_KEY)).toBe(false);
  });

  it("does not delete an envelope that changed after confirmation", async () => {
    const area = new FakeArea();
    const store = await created(area);
    const token = store.observedToken();
    area.notify = false;
    const other = await started(area);
    await other.unlock(PASS);
    await other.setKeep(keep(ID1), true);
    expect(await store.deleteStore(token)).toBe("changed");
    expect(area.data.has(STORAGE_KEY)).toBe(true);
  });

  it("can delete a corrupt store", async () => {
    const area = new FakeArea();
    area.data.set(STORAGE_KEY, "garbage");
    const store = await started(area);
    expect(await store.deleteStore(store.observedToken())).toBe("ok");
    expect(store.current).toEqual({ status: "absent" });
  });

  it("maps a failed removal to unavailable", async () => {
    const area = new FakeArea();
    const store = await created(area);
    area.failRemove = true;
    expect(await store.deleteStore(store.observedToken())).toBe("failed");
    expect(store.current).toEqual({ status: "unavailable", reason: "delete-failed" });
  });
});
