// The one shared mutable state of a KeepStore (generation, serial queue,
// session, observation, checkpoint) and the primitives every operation uses.
// There is exactly one KeepCore per store, so one queue and one generation.
import { seal } from "./crypto";
import {
  aadOf,
  type Envelope,
  type EnvelopeHeader,
  encodePlaintext,
  envelopeToken,
  fromBase64,
  parseEnvelope,
  STORAGE_KEY,
  toBase64,
} from "./envelope";
import { type Observed, readStored, withLock } from "./keepGateway";
import type { KeepEntry } from "./keepRules";
import {
  frozenEntries,
  type KeepDeps,
  type KeepState,
  type Locked,
  type OpResult,
  type Session,
  type UnavailableReason,
} from "./keepTypes";

export class KeepCore {
  state: KeepState = { status: "loading" };
  generation = 0;
  session: Session | null = null;
  observed: Observed | null = null;
  checkpoint: { storeId: string; revision: number } | null = null;
  queue: Promise<unknown> = Promise.resolve();
  readonly ownWrites = new Set<string>();
  ownRemovals = 0;
  restricted = false;
  readonly listeners = new Set<(state: KeepState) => void>();
  unsubscribe: (() => void) | null = null;

  constructor(readonly deps: KeepDeps) {}

  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // The queue only orders operations; each caller receives its own result or error.
    this.queue = run.catch(() => undefined);
    return run;
  }

  advance(): number {
    this.generation++;
    this.session = null;
    return this.generation;
  }

  fail(reason: UnavailableReason): void {
    const gen = this.advance();
    this.publish(gen, { status: "unavailable", reason });
  }

  failIf(gen: number, reason: UnavailableReason): OpResult {
    if (gen === this.generation) {
      this.fail(reason);
    }
    return "failed";
  }

  publish(gen: number, state: KeepState): void {
    if (gen === this.generation) {
      this.setState(state);
    }
  }

  setState(state: KeepState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  classify(now: Observed): KeepState {
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

  async sealed(
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

  async write(envelope: Envelope): Promise<"ok" | "write-failed"> {
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
  async underLock<T>(gen: number, fn: (now: Observed) => Promise<T>): Promise<Locked<T>> {
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

  settleWrite(
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

  become(gen: number, incoming: Session): boolean {
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

  onStoredChange(value: unknown): void {
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
}
