// Passphrase-derived AES-GCM key and sealing (P-0007 item 4). WebCrypto only.

export const KDF_DEFAULT_ITERATIONS = 600_000;
export const KDF_MIN_ITERATIONS = 100_000;
export const KDF_MAX_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const MIN_PASSPHRASE_LENGTH = 12;

const encoder = new TextEncoder();

/** Code points after NFC, so the same passphrase typed through different input methods matches. */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC");
}

export function passphraseLongEnough(passphrase: string): boolean {
  return [...normalizePassphrase(passphrase)].length >= MIN_PASSPHRASE_LENGTH;
}

/** A non-extractable AES-GCM-256 key from PBKDF2-SHA256. The passphrase is not retained. */
export async function deriveKey(
  subtle: SubtleCrypto,
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle.importKey(
    "raw",
    encoder.encode(normalizePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(
  subtle: SubtleCrypto,
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const out = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return new Uint8Array(out);
}

/**
 * Null when authentication fails: a wrong passphrase and tampered or corrupt
 * data cannot be told apart (P-0007 limits). Other errors propagate.
 */
export async function open(
  subtle: SubtleCrypto,
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const out = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(out);
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      return null;
    }
    throw error;
  }
}
