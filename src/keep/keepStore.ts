// The KEEP store state machine (P-0007 items 5 to 8). One instance per
// management page. Every asynchronous operation records the generation it
// started in and neither writes nor publishes once the generation changed
// (lock, reload, delete, a foreign change or a conflict all advance it).
import {
  deriveKey,
  IV_BYTES,
  KDF_DEFAULT_ITERATIONS,
  open,
  passphraseLongEnough,
  SALT_BYTES,
  seal,
} from "./crypto";
import {
  aadOf,
  decodePlaintext,
  ENVELOPE_FORMAT,
  type Envelope,
  type EnvelopeHeader,
  type EnvelopeProblem,
  encodePlaintext,
  envelopeToken,
  fromBase64,
  parseEnvelope,
  SCHEMA_VERSION,
  STORAGE_KEY,
  STORE_ID_BYTES,
  toBase64,
} from "./envelope";
import {
  type LockManagerLike,
  type Observed,
  readStored,
  type StorageAreaLike,
  type TimerApi,
  withLock,
} from "./keepGateway";
import { type KeepEntry, withEntry } from "./keepRules";

export type UnavailableReason =
  | "access-level"
  | "read-failed"
  | "write-failed"
  | "delete-failed"
  | "crypto-failed"
  | "lock-unavailable"
  | "lock-timeout"
  | "conflict"
  | "changed-elsewhere"
  | "regressed"
  | "replaced";

export type KeepState =
  | { readonly status: "loading" }
  | { readonly status: "absent" }
  | { readonly status: "locked"; readonly error: "wrong-or-corrupt" | null }
  | {
      readonly status: "available";
      readonly entries: readonly KeepEntry[];
      readonly revision: number;
    }
  | { readonly status: "corrupt"; readonly problem: EnvelopeProblem | "plaintext" }
  | { readonly status: "unavailable"; readonly reason: UnavailableReason };

export type OpResult =
  | "ok"
  | "not-allowed"
  | "no-consent"
  | "short-passphrase"
  | "wrong-passphrase"
  | "changed"
  | "superseded"
  | "failed";

export interface KeepDeps {
  readonly storage: StorageAreaLike;
  readonly locks: LockManagerLike | null;
  readonly subtle: SubtleCrypto;
  readonly random: (bytes: number) => Uint8Array;
  readonly timers: TimerApi;
  /** storage.onChanged for STORAGE_KEY in the local area; returns an unsubscribe function. */
  readonly onStoredChange: (listener: (newValue: unknown) => void) => () => void;
  readonly lockTimeoutMs?: number;
  readonly iterations?: number;
}

interface Session {
  readonly key: CryptoKey;
  readonly envelope: Envelope;
  readonly entries: readonly KeepEntry[];
}

type Locked<T> = T | "lock-timeout" | "lock-unavailable" | "read-failed" | "superseded";

/** entries, revision, storeId and generation read together (P-0009 item 8). */
export interface KeepBinding {
  readonly entries: readonly KeepEntry[];
  readonly revision: number;
  readonly storeId: string;
  readonly generation: number;
}

export type OrderedKeepView =
  | ({ readonly status: "available" } & KeepBinding)
  | {
      readonly status: "not-available";
      readonly reason:
        | "state"
        | "conflict"
        | "superseded"
        | "lock-timeout"
        | "lock-unavailable"
        | "read-failed";
    };

/** A frozen copy, so a caller of binding() or withOrderedSnapshot() cannot change the session. */
function frozenEntries(entries: readonly KeepEntry[]): readonly KeepEntry[] {
  return Object.freeze(
    entries.map((e) =>
      Object.freeze({ ...e, scope: e.scope === null ? null : Object.freeze({ ...e.scope }) }),
    ),
  );
}

export class KeepStore {
  private state: KeepState = { status: "loading" };
  private generation = 0;
  private session: Session | null = null;
  private observed: Observed | null = null;
  private checkpoint: { storeId: string; revision: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly ownWrites = new Set<string>();
  private ownRemovals = 0;
  private restricted = false;
  private readonly listeners = new Set<(state: KeepState) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: KeepDeps) {}

  get current(): KeepState {
    return this.state;
  }

  /** True once storage access is restricted to extension contexts (KINV-8). */
  get accessRestricted(): boolean {
    return this.restricted;
  }

  subscribe(listener: (state: KeepState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The token of the envelope seen last; a delete must name it (P-0007 item 7). */
  observedToken(): string | null {
    return this.observed?.token ?? null;
  }

  async init(): Promise<void> {
    const setAccessLevel = this.deps.storage.setAccessLevel;
    if (setAccessLevel === undefined) {
      this.fail("access-level");
      return;
    }
    try {
      await setAccessLevel.call(this.deps.storage, { accessLevel: "TRUSTED_CONTEXTS" });
    } catch {
      this.fail("access-level"); // Fail closed: no read, no write, no injection (KINV-8).
      return;
    }
    this.restricted = true;
    this.unsubscribe = this.deps.onStoredChange((value) => this.onStoredChange(value));
    await this.load();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.advance();
  }

  async reload(): Promise<OpResult> {
    if (!this.restricted || this.state.status === "loading") {
      return "not-allowed";
    }
    await this.queue.catch(() => undefined);
    await this.load();
    return "ok";
  }

  /**
   * Accepts the regressed or replaced envelope the user saw (P-0007 item 8).
   * Bound to that envelope and to the generation: if either changed, nothing
   * is adopted and the rollback checkpoint stays. On success the checkpoint
   * moves to the adopted envelope; it is never simply cleared.
   */
  async adopt(): Promise<OpResult> {
    const s = this.state;
    const seen = this.observed;
    if (
      s.status !== "unavailable" ||
      (s.reason !== "regressed" && s.reason !== "replaced") ||
      seen?.kind !== "envelope"
    ) {
      return "not-allowed";
    }
    const gen = this.generation;
    return this.serial(async () => {
      if (gen !== this.generation) {
        return "superseded";
      }
      let now: Observed;
      try {
        now = await readStored(this.deps.storage);
      } catch {
        return this.failIf(gen, "read-failed");
      }
      if (gen !== this.generation) {
        return "superseded";
      }
      if (now.kind !== "envelope" || now.token !== seen.token) {
        // Something else is stored now; classify it against the unchanged checkpoint.
        this.observed = now;
        this.publish(gen, this.classify(now));
        return "changed";
      }
      this.checkpoint = { storeId: now.envelope.storeId, revision: now.envelope.revision };
      this.observed = now;
      this.publish(gen, { status: "locked", error: null });
      return "ok";
    });
  }

  async create(passphrase: string, consent: boolean): Promise<OpResult> {
    if (!this.restricted || this.state.status !== "absent") {
      return "not-allowed";
    }
    if (!consent) {
      return "no-consent";
    }
    if (!passphraseLongEnough(passphrase)) {
      return "short-passphrase";
    }
    const gen = this.generation;
    const { random, subtle } = this.deps;
    const header: EnvelopeHeader = {
      format: ENVELOPE_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      storeId: toBase64(random(STORE_ID_BYTES)),
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: this.deps.iterations ?? KDF_DEFAULT_ITERATIONS,
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
      envelope = await this.sealed(key, header, []);
    } catch {
      return this.failIf(gen, "crypto-failed");
    }
    return this.serial(async () => {
      const outcome = await this.underLock(gen, async (now) => {
        if (now.kind !== "absent") {
          return "conflict" as const;
        }
        return this.write(envelope);
      });
      return this.settleWrite(gen, outcome, { key, envelope, entries: [] });
    });
  }

  /**
   * Unlocks run one at a time with the other operations, so an earlier
   * unlock (and any write after it) is never overtaken by a later one that
   * authenticated an older envelope (PR #8 review).
   */
  async unlock(passphrase: string): Promise<OpResult> {
    if (this.state.status !== "locked") {
      return "not-allowed";
    }
    // Bound to the generation at the call: a reload, lock or foreign change
    // while it waits in the queue invalidates it (PR #8 review, round 2).
    const gen = this.generation;
    return this.serial(() =>
      gen !== this.generation
        ? Promise.resolve("superseded" as const)
        : this.state.status === "locked"
          ? this.unlockNow(passphrase, gen)
          : Promise.resolve("not-allowed" as const),
    );
  }

  private async unlockNow(passphrase: string, gen: number): Promise<OpResult> {
    let now: Observed;
    try {
      now = await readStored(this.deps.storage);
    } catch {
      return this.failIf(gen, "read-failed");
    }
    if (gen !== this.generation) {
      return "superseded";
    }
    this.observed = now;
    const classified = this.classify(now);
    if (classified.status !== "locked") {
      this.publish(gen, classified);
      return "failed";
    }
    if (now.kind !== "envelope") {
      return "failed";
    }
    const envelope = now.envelope;
    try {
      const key = await deriveKey(
        this.deps.subtle,
        passphrase,
        fromBase64(envelope.kdf.salt) as Uint8Array,
        envelope.kdf.iterations,
      );
      const plain = await open(
        this.deps.subtle,
        key,
        fromBase64(envelope.cipher.iv) as Uint8Array,
        aadOf(envelope),
        fromBase64(envelope.ciphertext) as Uint8Array,
      );
      if (plain === null) {
        this.publish(gen, { status: "locked", error: "wrong-or-corrupt" });
        return "wrong-passphrase";
      }
      const entries = decodePlaintext(plain, envelope.revision);
      if (entries === null) {
        this.publish(gen, { status: "corrupt", problem: "plaintext" });
        return "failed";
      }
      return this.become(gen, { key, envelope, entries }) ? "ok" : "superseded";
    } catch {
      return this.failIf(gen, "crypto-failed");
    }
  }

  /** Stops new writes, waits for writes already sent, then publishes locked (KINV-6). */
  async lock(): Promise<OpResult> {
    if (this.state.status !== "available") {
      return "not-allowed";
    }
    const gen = this.advance();
    await this.queue.catch(() => undefined);
    this.publish(gen, { status: "locked", error: null });
    return "ok";
  }

  async setKeep(entry: KeepEntry, keep: boolean): Promise<OpResult> {
    if (this.state.status !== "available") {
      return "not-allowed";
    }
    const gen = this.generation;
    return this.serial(async () => {
      const s = this.session;
      if (gen !== this.generation || s === null) {
        return "superseded";
      }
      const revision = s.envelope.revision + 1;
      if (!Number.isSafeInteger(revision)) {
        return this.failIf(gen, "write-failed");
      }
      const entries = withEntry(s.entries, entry, keep);
      const { ciphertext: _previous, ...base } = s.envelope;
      let envelope: Envelope;
      try {
        const header = {
          ...base,
          cipher: { name: "AES-GCM" as const, iv: toBase64(this.deps.random(IV_BYTES)) },
          revision,
        };
        envelope = await this.sealed(s.key, header, entries);
      } catch {
        return this.failIf(gen, "crypto-failed");
      }
      const expected = envelopeToken(s.envelope);
      const outcome = await this.underLock(gen, async (now) => {
        if (now.kind !== "envelope" || now.token !== expected) {
          return "conflict" as const;
        }
        return this.write(envelope);
      });
      return this.settleWrite(gen, outcome, { key: s.key, envelope, entries });
    });
  }

  /**
   * The authenticated session's KEEP state, read together; null unless the
   * store is available with a session (lock() drops the session before it
   * publishes locked, so this is null in that window) (P-0009 item 8).
   */
  binding(): KeepBinding | null {
    const s = this.session;
    if (this.state.status !== "available" || s === null) {
      return null;
    }
    return {
      entries: frozenEntries(s.entries),
      revision: s.envelope.revision,
      storeId: s.envelope.storeId,
      generation: this.generation,
    };
  }

  /**
   * Runs the synchronous `fn` inside this store's serial queue and the KEEP
   * Web Lock, after re-reading the stored envelope and confirming it is the
   * authenticated one and the generation is unchanged, so no KEEP write of
   * this tab or another one lands between this read and what `fn` does.
   * `fn` must not await: the queue and the lock are released when it returns
   * (P-0009 item 8). It is called exactly once.
   */
  async withOrderedSnapshot<T>(fn: (view: OrderedKeepView) => T): Promise<T> {
    return this.serial(async () => {
      const gen = this.generation;
      const s = this.session;
      if (this.state.status !== "available" || s === null) {
        return fn({ status: "not-available", reason: "state" });
      }
      const expected = envelopeToken(s.envelope);
      let ran: { value: T } | null = null;
      const outcome = await this.underLock(gen, async (now) => {
        if (now.kind !== "envelope" || now.token !== expected) {
          return "conflict" as const;
        }
        ran = {
          value: fn({
            status: "available",
            entries: frozenEntries(s.entries),
            revision: s.envelope.revision,
            storeId: s.envelope.storeId,
            generation: gen,
          }),
        };
        return "ok" as const;
      });
      if (ran !== null) {
        return (ran as { value: T }).value;
      }
      if (outcome === "conflict" || outcome === "read-failed" || outcome === "lock-unavailable") {
        this.failIf(gen, outcome);
      }
      // A lock timeout leaves the store as it is (P-0009 item 8).
      const reason = outcome === "ok" ? "superseded" : outcome;
      return fn({ status: "not-available", reason });
    });
  }

  /** Deletes the stored envelope only if it is still the one the user confirmed. */
  async deleteStore(confirmedToken: string | null): Promise<OpResult> {
    if (!this.restricted || this.state.status === "loading") {
      return "not-allowed";
    }
    return this.serial(async () => {
      const gen = this.generation;
      const outcome = await this.underLock(gen, async (now) => {
        if (now.kind === "absent") {
          return "gone" as const;
        }
        if (now.token !== confirmedToken) {
          return "changed" as const;
        }
        this.ownRemovals++;
        try {
          await this.deps.storage.remove(STORAGE_KEY);
        } catch {
          this.ownRemovals--;
          return "delete-failed" as const;
        }
        return "ok" as const;
      });
      if (outcome === "ok" || outcome === "gone") {
        // The deleted store no longer exists, so its rollback checkpoint goes
        // either way; the state is published only if nothing overtook us
        // (for example another tab creating a new store) (PR #8 review).
        this.checkpoint = null;
        if (gen !== this.generation) {
          return "superseded";
        }
        const next = this.advance();
        this.observed = { kind: "absent", token: null };
        this.publish(next, { status: "absent" });
        return "ok";
      }
      if (outcome === "changed") {
        this.failIf(gen, "conflict");
        return "changed";
      }
      return outcome === "superseded" ? "superseded" : this.failIf(gen, outcome);
    });
  }

  // ---- internals ----

  private async load(): Promise<void> {
    const gen = this.advance();
    let now: Observed;
    try {
      now = await readStored(this.deps.storage);
    } catch {
      this.failIf(gen, "read-failed");
      return;
    }
    if (gen !== this.generation) {
      return;
    }
    this.observed = now;
    this.publish(gen, this.classify(now));
  }

  private classify(now: Observed): KeepState {
    if (now.kind === "absent") {
      return { status: "absent" };
    }
    if (now.kind === "malformed") {
      return { status: "corrupt", problem: now.problem };
    }
    const cp = this.checkpoint;
    if (cp !== null && cp.storeId !== now.envelope.storeId) {
      return { status: "unavailable", reason: "replaced" };
    }
    if (cp !== null && now.envelope.revision < cp.revision) {
      return { status: "unavailable", reason: "regressed" };
    }
    return { status: "locked", error: null };
  }

  private async sealed(
    key: CryptoKey,
    header: EnvelopeHeader,
    entries: readonly KeepEntry[],
  ): Promise<Envelope> {
    const ciphertext = await seal(
      this.deps.subtle,
      key,
      fromBase64(header.cipher.iv) as Uint8Array,
      aadOf(header),
      encodePlaintext(header.revision, entries),
    );
    const envelope: Envelope = { ...header, ciphertext: toBase64(ciphertext) };
    // Round-trip through the strict parser so nothing is written that this code would refuse to read.
    const check = parseEnvelope(JSON.parse(JSON.stringify(envelope)));
    if (!check.ok) {
      throw new Error("lizychattidy: produced an envelope outside the schema");
    }
    return check.envelope;
  }

  private async write(envelope: Envelope): Promise<"ok" | "write-failed"> {
    const token = envelopeToken(envelope);
    this.ownWrites.add(token);
    try {
      await this.deps.storage.set({ [STORAGE_KEY]: envelope });
      return "ok";
    } catch {
      this.ownWrites.delete(token);
      return "write-failed";
    }
  }

  /** Runs `fn` under the Web Lock with a fresh read; refuses to act once superseded. */
  private async underLock<T>(gen: number, fn: (now: Observed) => Promise<T>): Promise<Locked<T>> {
    const locks = this.deps.locks;
    if (locks === null) {
      return "lock-unavailable";
    }
    const result = await withLock(
      locks,
      this.deps.timers,
      this.deps.lockTimeoutMs ?? 10_000,
      async () => {
        let now: Observed;
        try {
          now = await readStored(this.deps.storage);
        } catch {
          return "read-failed" as const;
        }
        // Checked right before any storage mutation (P-0007 item 6).
        if (gen !== this.generation) {
          return "superseded" as const;
        }
        return fn(now);
      },
    );
    return result.ok ? result.value : result.reason;
  }

  private settleWrite(
    gen: number,
    outcome: Locked<"ok" | "write-failed" | "conflict">,
    session: Session,
  ): OpResult {
    if (outcome === "ok") {
      return this.become(gen, session) ? "ok" : "superseded";
    }
    if (outcome === "superseded") {
      return "superseded";
    }
    return this.failIf(gen, outcome);
  }

  private become(gen: number, incoming: Session): boolean {
    if (gen !== this.generation) {
      return false;
    }
    // The published state and the session share one deep-frozen entry list,
    // so no caller holding `current.entries` can remove a KEEP from the
    // session that later bindings and writes read (PR #10 review sweep).
    const session: Session = { ...incoming, entries: frozenEntries(incoming.entries) };
    this.session = session;
    this.checkpoint = { storeId: session.envelope.storeId, revision: session.envelope.revision };
    this.observed = {
      kind: "envelope",
      envelope: session.envelope,
      token: envelopeToken(session.envelope),
    };
    this.setState({
      status: "available",
      entries: session.entries,
      revision: session.envelope.revision,
    });
    return true;
  }

  private onStoredChange(value: unknown): void {
    if (value === undefined && this.ownRemovals > 0) {
      this.ownRemovals--;
      return;
    }
    const parsed = parseEnvelope(value);
    if (parsed.ok && this.ownWrites.delete(envelopeToken(parsed.envelope))) {
      return;
    }
    if (this.state.status !== "loading") {
      this.fail("changed-elsewhere");
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // The queue only orders operations; each caller receives its own result or error.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private advance(): number {
    this.generation++;
    this.session = null;
    return this.generation;
  }

  private fail(reason: UnavailableReason): void {
    const gen = this.advance();
    this.publish(gen, { status: "unavailable", reason });
  }

  private failIf(gen: number, reason: UnavailableReason): OpResult {
    if (gen === this.generation) {
      this.fail(reason);
    }
    return "failed";
  }

  private publish(gen: number, state: KeepState): void {
    if (gen === this.generation) {
      this.setState(state);
    }
  }

  private setState(state: KeepState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
