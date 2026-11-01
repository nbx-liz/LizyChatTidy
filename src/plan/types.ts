// Shared run types (P-0009 items 6, 7 and 10).
import type { BuildKind, DeleteAdapter, Provider, ReadAdapter } from "../adapters/contracts";
import type { KeepStore } from "../keep/keepStore";
import type { Clock, LedgerStorage, ServiceLockManager } from "./environment";

export type Phase =
  | "idle"
  | "inventory"
  | "draft"
  | "ready"
  | "approved"
  | "running"
  | "completed"
  | "paused"
  | "failed"
  | "uncertain";

export type ItemOutcome = "pending" | "verified" | "skipped" | "failed" | "uncertain";

export interface ItemResult {
  readonly conversationId: string;
  readonly outcome: ItemOutcome;
  /** A reason code; never a title or id (INV-03). */
  readonly reason: string | null;
  readonly dispatched: boolean;
  readonly writeAccepted: boolean;
}

export interface Approval {
  readonly approvalId: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly ledgerEpoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Provisional approval lifetime (P-0009 item 6). */
export const APPROVAL_TTL_MS = 60 * 60_000;

export type OpOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type RecoveryStatus =
  | { readonly kind: "clear" }
  | {
      readonly kind: "pending";
      readonly count: number;
      readonly lastDispatchedAt: number;
      readonly token: string;
    }
  | { readonly kind: "malformed"; readonly token: string }
  | { readonly kind: "read-failed" };

export type KeepPort = Pick<KeepStore, "binding" | "withOrderedSnapshot">;

export interface RunDeps {
  readonly provider: Provider;
  readonly read: ReadAdapter;
  readonly del: DeleteAdapter | null;
  readonly build: BuildKind;
  readonly keep: KeepPort;
  /** chrome.storage.local, only after setAccessLevel succeeded (P-0007 item 1). */
  readonly ledger: LedgerStorage;
  readonly locks: ServiceLockManager | null;
  readonly clock: Clock;
  /** A UUID v4 generator. */
  readonly newId: () => string;
  readonly subtle: SubtleCrypto;
}

export type Liveness = "live" | "stopped" | "expired" | "invalid" | "disposed";

export type Terminal = "completed" | "paused" | "failed" | "uncertain";

export function serviceLockName(provider: Provider): string {
  return `lizychattidy-service:${provider}`;
}
