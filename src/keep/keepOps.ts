// The state-changing KEEP store operations (P-0007 items 5 to 8). Each takes
// the store's single KeepCore, so the serial queue and the generation counter
// stay shared. The order of awaits and generation checks is load-bearing.
import {
  deriveKey,
  IV_BYTES,
  KDF_DEFAULT_ITERATIONS,
  open,
  passphraseLongEnough,
  SALT_BYTES,
} from "./crypto";
import {
  aadOf,
  decodePlaintext,
  ENVELOPE_FORMAT,
  type Envelope,
  type EnvelopeHeader,
  envelopeToken,
  fromBase64,
  SCHEMA_VERSION,
  STORAGE_KEY,
  STORE_ID_BYTES,
  toBase64,
} from "./envelope";
import type { KeepCore } from "./keepCore";
import { type Observed, readStored } from "./keepGateway";
import { type KeepEntry, withEntry } from "./keepRules";
import type { OpResult } from "./keepTypes";

export async function load(core: KeepCore): Promise<void> {
  const gen = core.advance();
  let now: Observed;
  try {
    now = await readStored(core.deps.storage);
  } catch {
    core.failIf(gen, "read-failed");
    return;
  }
  if (gen !== core.generation) {
    return;
  }
  core.observed = now;
  core.publish(gen, core.classify(now));
}

/**
 * Accepts the regressed or replaced envelope the user saw (P-0007 item 8).
 * Bound to that envelope and to the generation: if either changed, nothing
 * is adopted and the rollback checkpoint stays. On success the checkpoint
 * moves to the adopted envelope; it is never simply cleared.
 */
export async function adopt(core: KeepCore): Promise<OpResult> {
  const s = core.state;
  const seen = core.observed;
  if (
    s.status !== "unavailable" ||
    (s.reason !== "regressed" && s.reason !== "replaced") ||
    seen?.kind !== "envelope"
  ) {
    return "not-allowed";
  }
  const gen = core.generation;
  return core.serial(async () => {
    if (gen !== core.generation) {
      return "superseded";
    }
    let now: Observed;
    try {
      now = await readStored(core.deps.storage);
    } catch {
      return core.failIf(gen, "read-failed");
    }
    if (gen !== core.generation) {
      return "superseded";
    }
    if (now.kind !== "envelope" || now.token !== seen.token) {
      // Something else is stored now; classify it against the unchanged checkpoint.
      core.observed = now;
      core.publish(gen, core.classify(now));
      return "changed";
    }
    core.checkpoint = { storeId: now.envelope.storeId, revision: now.envelope.revision };
    core.observed = now;
    core.publish(gen, { status: "locked", error: null });
    return "ok";
  });
}

export async function create(
  core: KeepCore,
  passphrase: string,
  consent: boolean,
): Promise<OpResult> {
  if (!core.restricted || core.state.status !== "absent") {
    return "not-allowed";
  }
  if (!consent) {
    return "no-consent";
  }
  if (!passphraseLongEnough(passphrase)) {
    return "short-passphrase";
  }
  const gen = core.generation;
  const { random, subtle } = core.deps;
  const header: EnvelopeHeader = {
    format: ENVELOPE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    storeId: toBase64(random(STORE_ID_BYTES)),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: core.deps.iterations ?? KDF_DEFAULT_ITERATIONS,
      salt: toBase64(random(SALT_BYTES)),
    },
    cipher: { name: "AES-GCM", iv: toBase64(random(IV_BYTES)) },
    revision: 1,
  };
  let key: CryptoKey;
  let envelope: Envelope;
  try {
    key = await deriveKey(
      subtle,
      passphrase,
      fromBase64(header.kdf.salt) as Uint8Array,
      header.kdf.iterations,
    );
    envelope = await core.sealed(key, header, []);
  } catch {
    return core.failIf(gen, "crypto-failed");
  }
  return core.serial(async () => {
    const outcome = await core.underLock(gen, async (now) => {
      if (now.kind !== "absent") {
        return "conflict" as const;
      }
      return core.write(envelope);
    });
    return core.settleWrite(gen, outcome, { key, envelope, entries: [] });
  });
}

/**
 * Unlocks run one at a time with the other operations, so an earlier
 * unlock (and any write after it) is never overtaken by a later one that
 * authenticated an older envelope (PR #8 review).
 */
export async function unlock(core: KeepCore, passphrase: string): Promise<OpResult> {
  if (core.state.status !== "locked") {
    return "not-allowed";
  }
  // Bound to the generation at the call: a reload, lock or foreign change
  // while it waits in the queue invalidates it (PR #8 review, round 2).
  const gen = core.generation;
  return core.serial(() =>
    gen !== core.generation
      ? Promise.resolve("superseded" as const)
      : core.state.status === "locked"
        ? unlockNow(core, passphrase, gen)
        : Promise.resolve("not-allowed" as const),
  );
}

async function unlockNow(core: KeepCore, passphrase: string, gen: number): Promise<OpResult> {
  let now: Observed;
  try {
    now = await readStored(core.deps.storage);
  } catch {
    return core.failIf(gen, "read-failed");
  }
  if (gen !== core.generation) {
    return "superseded";
  }
  core.observed = now;
  const classified = core.classify(now);
  if (classified.status !== "locked") {
    core.publish(gen, classified);
    return "failed";
  }
  if (now.kind !== "envelope") {
    return "failed";
  }
  const envelope = now.envelope;
  try {
    const key = await deriveKey(
      core.deps.subtle,
      passphrase,
      fromBase64(envelope.kdf.salt) as Uint8Array,
      envelope.kdf.iterations,
    );
    const plain = await open(
      core.deps.subtle,
      key,
      fromBase64(envelope.cipher.iv) as Uint8Array,
      aadOf(envelope),
      fromBase64(envelope.ciphertext) as Uint8Array,
    );
    if (plain === null) {
      core.publish(gen, { status: "locked", error: "wrong-or-corrupt" });
      return "wrong-passphrase";
    }
    const entries = decodePlaintext(plain, envelope.revision);
    if (entries === null) {
      core.publish(gen, { status: "corrupt", problem: "plaintext" });
      return "failed";
    }
    return core.become(gen, { key, envelope, entries }) ? "ok" : "superseded";
  } catch {
    return core.failIf(gen, "crypto-failed");
  }
}

/** Stops new writes, waits for writes already sent, then publishes locked (KINV-6). */
export async function lock(core: KeepCore): Promise<OpResult> {
  if (core.state.status !== "available") {
    return "not-allowed";
  }
  const gen = core.advance();
  await core.queue.catch(() => undefined);
  core.publish(gen, { status: "locked", error: null });
  return "ok";
}

export async function setKeep(core: KeepCore, entry: KeepEntry, keep: boolean): Promise<OpResult> {
  if (core.state.status !== "available") {
    return "not-allowed";
  }
  const gen = core.generation;
  return core.serial(async () => {
    const s = core.session;
    if (gen !== core.generation || s === null) {
      return "superseded";
    }
    const revision = s.envelope.revision + 1;
    if (!Number.isSafeInteger(revision)) {
      return core.failIf(gen, "write-failed");
    }
    const entries = withEntry(s.entries, entry, keep);
    const { ciphertext: _previous, ...base } = s.envelope;
    let envelope: Envelope;
    try {
      const header = {
        ...base,
        cipher: { name: "AES-GCM" as const, iv: toBase64(core.deps.random(IV_BYTES)) },
        revision,
      };
      envelope = await core.sealed(s.key, header, entries);
    } catch {
      return core.failIf(gen, "crypto-failed");
    }
    const expected = envelopeToken(s.envelope);
    const outcome = await core.underLock(gen, async (now) => {
      if (now.kind !== "envelope" || now.token !== expected) {
        return "conflict" as const;
      }
      return core.write(envelope);
    });
    return core.settleWrite(gen, outcome, { key: s.key, envelope, entries });
  });
}

/** Deletes the stored envelope only if it is still the one the user confirmed. */
export async function deleteStore(
  core: KeepCore,
  confirmedToken: string | null,
): Promise<OpResult> {
  if (!core.restricted || core.state.status === "loading") {
    return "not-allowed";
  }
  return core.serial(async () => {
    const gen = core.generation;
    const outcome = await core.underLock(gen, async (now) => {
      if (now.kind === "absent") {
        return "gone" as const;
      }
      if (now.token !== confirmedToken) {
        return "changed" as const;
      }
      core.ownRemovals++;
      try {
        await core.deps.storage.remove(STORAGE_KEY);
      } catch {
        core.ownRemovals--;
        return "delete-failed" as const;
      }
      return "ok" as const;
    });
    if (outcome === "ok" || outcome === "gone") {
      // The deleted store no longer exists, so its rollback checkpoint goes
      // either way; the state is published only if nothing overtook us
      // (for example another tab creating a new store) (PR #8 review).
      core.checkpoint = null;
      if (gen !== core.generation) {
        return "superseded";
      }
      const next = core.advance();
      core.observed = { kind: "absent", token: null };
      core.publish(next, { status: "absent" });
      return "ok";
    }
    if (outcome === "changed") {
      core.failIf(gen, "conflict");
      return "changed";
    }
    return outcome === "superseded" ? "superseded" : core.failIf(gen, outcome);
  });
}
