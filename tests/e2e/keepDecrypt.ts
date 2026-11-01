// Test-side decryption of the persisted KEEP envelope (AT28). It reuses the
// shipped pure helpers read-only, so the test reads the bytes exactly as the
// product defines them, but runs in Node with the test passphrase.
import { deriveKey, open } from "../../src/keep/crypto";
import { aadOf, fromBase64, parseEnvelope, STORAGE_KEY } from "../../src/keep/envelope";

export interface DecryptedKeep {
  readonly revision: number;
  readonly plaintextText: string;
  readonly plaintext: unknown;
}

export async function decryptKeepEnvelope(
  local: Record<string, unknown>,
  passphrase: string,
): Promise<DecryptedKeep> {
  const parsed = parseEnvelope(local[STORAGE_KEY]);
  if (!parsed.ok) {
    throw new Error(`stored KEEP envelope is not valid: ${parsed.problem}`);
  }
  const { envelope } = parsed;
  const salt = fromBase64(envelope.kdf.salt);
  const iv = fromBase64(envelope.cipher.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt === null || iv === null || ciphertext === null) {
    throw new Error("stored KEEP envelope has non-canonical base64");
  }
  const subtle = globalThis.crypto.subtle;
  const key = await deriveKey(subtle, passphrase, salt, envelope.kdf.iterations);
  const bytes = await open(subtle, key, iv, aadOf(envelope), ciphertext);
  if (bytes === null) {
    throw new Error("the stored KEEP envelope did not authenticate with the test passphrase");
  }
  const plaintextText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { revision: envelope.revision, plaintextText, plaintext: JSON.parse(plaintextText) };
}
