import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveKey, passphraseLongEnough } from "./crypto";
import {
  aadOf,
  decodePlaintext,
  type EnvelopeHeader,
  encodePlaintext,
  fromBase64,
  parseEnvelope,
  toBase64,
} from "./envelope";

const header: EnvelopeHeader = {
  format: "lizychattidy-keep",
  schemaVersion: 1,
  storeId: toBase64(new Uint8Array(16).fill(1)),
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    salt: toBase64(new Uint8Array(16).fill(2)),
  },
  cipher: { name: "AES-GCM", iv: toBase64(new Uint8Array(12).fill(3)) },
  revision: 4,
};
const ID = "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab";

describe("envelope codec (P-0007 item 2)", () => {
  it("serializes the AAD as a fixed-order JSON array (test vector)", () => {
    expect(new TextDecoder().decode(aadOf(header))).toBe(
      '["lizychattidy-keep",1,"AQEBAQEBAQEBAQEBAQEBAQ==","PBKDF2","SHA-256",600000,"AgICAgICAgICAgICAgICAg==","AES-GCM","AwMDAwMDAwMDAwMD",4]',
    );
  });

  it("serializes the plaintext with exactly revision and entries (test vector)", () => {
    expect(
      new TextDecoder().decode(
        encodePlaintext(4, [{ provider: "chatgpt", conversationId: ID, scope: null }]),
      ),
    ).toBe(
      `{"revision":4,"entries":[{"provider":"chatgpt","conversationId":"${ID}","scope":null}]}`,
    );
  });

  it("accepts strict base64 only", () => {
    expect(fromBase64("AQID")).toEqual(new Uint8Array([1, 2, 3]));
    // "AR==" and "AQJ=" decode, but their unused bits are not zero (non-canonical).
    for (const bad of ["AQI", "AQ-D", " AQID", "AQID\n", "AQ==AQ==", "AR==", "AQJ="]) {
      expect(fromBase64(bad)).toBeNull();
    }
  });

  it("rejects missing, extra and mistyped fields", () => {
    const good = { ...header, ciphertext: "AAAA" };
    expect(parseEnvelope(good).ok).toBe(true);
    expect(parseEnvelope({ ...good, title: "x" })).toEqual({ ok: false, problem: "structure" });
    expect(parseEnvelope({ ...good, revision: 0 })).toEqual({ ok: false, problem: "structure" });
    expect(parseEnvelope({ ...good, revision: 1.5 })).toEqual({ ok: false, problem: "structure" });
    expect(parseEnvelope({ ...good, storeId: toBase64(new Uint8Array(8)) })).toEqual({
      ok: false,
      problem: "structure",
    });
    expect(parseEnvelope({ ...good, kdf: { ...good.kdf, hash: "SHA-1" } })).toEqual({
      ok: false,
      problem: "structure",
    });
    expect(parseEnvelope({ ...good, kdf: { ...good.kdf, iterations: 99_999 } })).toEqual({
      ok: false,
      problem: "kdf-range",
    });
    expect(parseEnvelope({ ...good, kdf: { ...good.kdf, iterations: 10_000_001 } })).toEqual({
      ok: false,
      problem: "kdf-range",
    });
    expect(parseEnvelope({ ...good, schemaVersion: 2 })).toEqual({ ok: false, problem: "version" });
  });

  it("rejects malformed plaintext entries and duplicates", () => {
    const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    const entry = { provider: "chatgpt", conversationId: ID, scope: null };
    expect(decodePlaintext(enc({ revision: 2, entries: [entry] }), 2)).toEqual([entry]);
    expect(decodePlaintext(enc({ revision: 2, entries: [entry, entry] }), 2)).toBeNull();
    expect(
      decodePlaintext(enc({ revision: 2, entries: [{ ...entry, title: "t" }] }), 2),
    ).toBeNull();
    expect(
      decodePlaintext(enc({ revision: 2, entries: [{ ...entry, conversationId: "x" }] }), 2),
    ).toBeNull();
    expect(
      decodePlaintext(
        enc({ revision: 2, entries: [{ ...entry, scope: { accountKey: "", workspaceKey: "w" } }] }),
        2,
      ),
    ).toBeNull();
    expect(decodePlaintext(enc({ revision: 3, entries: [] }), 2)).toBeNull();
    expect(decodePlaintext(new Uint8Array([0xff]), 2)).toBeNull();
  });
});

describe("key handling (P-0007 item 4, KINV-6)", () => {
  it("derives a non-extractable AES-GCM key", async () => {
    const key = await deriveKey(
      webcrypto.subtle as unknown as SubtleCrypto,
      "correct horse battery",
      new Uint8Array(16),
      100_000,
    );
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  });

  it("counts passphrase length in code points after NFC", () => {
    expect(passphraseLongEnough("a".repeat(11))).toBe(false);
    expect(passphraseLongEnough("a".repeat(12))).toBe(true);
    expect(passphraseLongEnough("🔑".repeat(12))).toBe(true);
    expect(passphraseLongEnough("é".repeat(11))).toBe(false);
  });
});
