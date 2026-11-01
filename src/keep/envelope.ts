// The stored KEEP envelope (P-0007 items 2 and 3). Parsing is strict: any
// shape outside the declared one is "corrupt", never "empty" (INV-05).
import { IV_BYTES, KDF_MAX_ITERATIONS, KDF_MIN_ITERATIONS, SALT_BYTES } from "./crypto";
import { isCanonicalId, type KeepEntry, type KeepProvider } from "./keepRules";

export const ENVELOPE_FORMAT = "lizychattidy-keep";
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "lizychattidy.keep";
export const STORE_ID_BYTES = 16;

/** Envelopes compare by every field, in a fixed order (P-0007 item 7). */
export function envelopeToken(envelope: Envelope): string {
  return JSON.stringify([
    envelope.format,
    envelope.schemaVersion,
    envelope.storeId,
    envelope.kdf.name,
    envelope.kdf.hash,
    envelope.kdf.iterations,
    envelope.kdf.salt,
    envelope.cipher.name,
    envelope.cipher.iv,
    envelope.revision,
    envelope.ciphertext,
  ]);
}

export interface EnvelopeHeader {
  readonly format: typeof ENVELOPE_FORMAT;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /** 16 random bytes chosen at creation; distinguishes a recreated store. */
  readonly storeId: string;
  readonly kdf: {
    readonly name: "PBKDF2";
    readonly hash: "SHA-256";
    readonly iterations: number;
    readonly salt: string;
  };
  readonly cipher: { readonly name: "AES-GCM"; readonly iv: string };
  readonly revision: number;
}

export interface Envelope extends EnvelopeHeader {
  readonly ciphertext: string;
}

export type EnvelopeProblem = "structure" | "version" | "kdf-range";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Strict base64 (standard alphabet, padded); null for anything else. */
export function fromBase64(text: string): Uint8Array | null {
  if (!BASE64.test(text)) {
    return null;
  }
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function parseEnvelope(
  value: unknown,
): { ok: true; envelope: Envelope } | { ok: false; problem: EnvelopeProblem } {
  const bad = (problem: EnvelopeProblem) => ({ ok: false as const, problem });
  if (!isObject(value) || value["format"] !== ENVELOPE_FORMAT) {
    return bad("structure");
  }
  if (value["schemaVersion"] !== SCHEMA_VERSION) {
    // Unknown or newer versions are never rewritten (AT14).
    return bad("version");
  }
  if (
    !exactKeys(value, [
      "format",
      "schemaVersion",
      "storeId",
      "kdf",
      "cipher",
      "revision",
      "ciphertext",
    ])
  ) {
    return bad("structure");
  }
  const { storeId, kdf, cipher, revision, ciphertext } = value;
  if (typeof storeId !== "string" || fromBase64(storeId)?.length !== STORE_ID_BYTES) {
    return bad("structure");
  }
  if (
    !isObject(kdf) ||
    !exactKeys(kdf, ["name", "hash", "iterations", "salt"]) ||
    kdf["name"] !== "PBKDF2" ||
    kdf["hash"] !== "SHA-256" ||
    typeof kdf["salt"] !== "string" ||
    fromBase64(kdf["salt"])?.length !== SALT_BYTES ||
    !Number.isSafeInteger(kdf["iterations"])
  ) {
    return bad("structure");
  }
  const iterations = kdf["iterations"] as number;
  if (iterations < KDF_MIN_ITERATIONS || iterations > KDF_MAX_ITERATIONS) {
    return bad("kdf-range");
  }
  if (
    !isObject(cipher) ||
    !exactKeys(cipher, ["name", "iv"]) ||
    cipher["name"] !== "AES-GCM" ||
    typeof cipher["iv"] !== "string" ||
    fromBase64(cipher["iv"])?.length !== IV_BYTES ||
    !isRevision(revision) ||
    typeof ciphertext !== "string" ||
    fromBase64(ciphertext) === null
  ) {
    return bad("structure");
  }
  return {
    ok: true,
    envelope: {
      format: ENVELOPE_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      storeId,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: kdf["salt"] as string },
      cipher: { name: "AES-GCM", iv: cipher["iv"] as string },
      revision,
      ciphertext,
    },
  };
}

/**
 * Additional authenticated data: every header field, as a JSON array in a
 * fixed order, so no two headers share an encoding.
 */
export function aadOf(header: EnvelopeHeader): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      header.format,
      header.schemaVersion,
      header.storeId,
      header.kdf.name,
      header.kdf.hash,
      header.kdf.iterations,
      header.kdf.salt,
      header.cipher.name,
      header.cipher.iv,
      header.revision,
    ]),
  );
}

const PROVIDERS: ReadonlySet<string> = new Set<KeepProvider>(["chatgpt", "claude-code"]);

function parseEntry(value: unknown): KeepEntry | null {
  if (!isObject(value) || !exactKeys(value, ["provider", "conversationId", "scope"])) {
    return null;
  }
  const { provider, conversationId, scope } = value;
  if (
    typeof provider !== "string" ||
    !PROVIDERS.has(provider) ||
    typeof conversationId !== "string" ||
    !isCanonicalId(provider as KeepProvider, conversationId)
  ) {
    return null;
  }
  if (scope === null) {
    return { provider: provider as KeepProvider, conversationId, scope: null };
  }
  if (
    !isObject(scope) ||
    !exactKeys(scope, ["accountKey", "workspaceKey"]) ||
    typeof scope["accountKey"] !== "string" ||
    typeof scope["workspaceKey"] !== "string" ||
    scope["accountKey"] === "" ||
    scope["workspaceKey"] === ""
  ) {
    return null;
  }
  return {
    provider: provider as KeepProvider,
    conversationId,
    scope: { accountKey: scope["accountKey"], workspaceKey: scope["workspaceKey"] },
  };
}

/** Plaintext: { revision, entries } with nothing else (KINV-5). */
export function encodePlaintext(revision: number, entries: readonly KeepEntry[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      revision,
      entries: entries.map((e) => ({
        provider: e.provider,
        conversationId: e.conversationId,
        scope:
          e.scope === null
            ? null
            : { accountKey: e.scope.accountKey, workspaceKey: e.scope.workspaceKey },
      })),
    }),
  );
}

/** Null when the plaintext is malformed or its revision differs from the header's. */
export function decodePlaintext(bytes: Uint8Array, revision: number): readonly KeepEntry[] | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null; // Reported by the caller as corrupt.
  }
  if (
    !isObject(value) ||
    !exactKeys(value, ["revision", "entries"]) ||
    value["revision"] !== revision
  ) {
    return null;
  }
  const raw = value["entries"];
  if (!Array.isArray(raw)) {
    return null;
  }
  const entries: KeepEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const entry = parseEntry(item);
    if (entry === null) {
      return null;
    }
    const key = JSON.stringify([
      entry.provider,
      entry.conversationId,
      entry.scope?.accountKey ?? null,
      entry.scope?.workspaceKey ?? null,
    ]);
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}
