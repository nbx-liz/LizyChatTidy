// Shared types of the KEEP store (P-0007, P-0009 item 8).
import type { Envelope, EnvelopeProblem } from "./envelope";
import type { LockManagerLike, StorageAreaLike, TimerApi } from "./keepGateway";
import type { KeepEntry } from "./keepRules";

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

export interface Session {
  readonly key: CryptoKey;
  readonly envelope: Envelope;
  readonly entries: readonly KeepEntry[];
}

export type Locked<T> = T | "lock-timeout" | "lock-unavailable" | "read-failed" | "superseded";

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
export function frozenEntries(entries: readonly KeepEntry[]): readonly KeepEntry[] {
  return Object.freeze(
    entries.map((e) =>
      Object.freeze({ ...e, scope: e.scope === null ? null : Object.freeze({ ...e.scope }) }),
    ),
  );
}
