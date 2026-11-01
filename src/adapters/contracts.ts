// Adapter contracts on the Controller side (P-0009 item 1; P-0001 items 3 and
// 4; P-0003). The owner's adapters implement these by sending one instruction
// per call to the content script; the synthetic adapter implements them in
// process for tests. TypeScript types are not a security boundary: every value
// an adapter returns is typed `unknown` here and validated in validate.ts.

export type Provider = "chatgpt" | "claude-code";

export type GateStatus =
  | "unreviewed"
  | "allowed"
  | "blocked"
  | "ownerAcceptedRisk"
  | "notApplicable";

export interface FeatureGate {
  readonly technical: GateStatus;
  /** ownerAcceptedRisk is valid only here. */
  readonly termsAndPermission: GateStatus;
  /** notApplicable is valid only here. */
  readonly storePolicy: GateStatus;
  readonly safety: GateStatus;
  readonly evidenceRefs: readonly string[];
}

export type BuildKind = "distribution" | "personal";

export interface SubjectKeys {
  readonly accountKey: string;
  readonly workspaceKey: string;
}

export type WorkspaceKind = "personal" | "organization" | "unknown";

export type SubjectEvidence =
  | {
      readonly status: "verified";
      readonly accountKey: string;
      readonly workspaceKey: string;
      readonly workspaceKind: WorkspaceKind;
    }
  | { readonly status: "unverified" };

export type AnomalyCode =
  | "rate-limited"
  | "server-error"
  | "timeout"
  | "network"
  | "unexpected-status"
  | "unexpected-schema"
  | "redirect"
  | "auth-changed"
  | "tab-lost"
  | "permission-lost"
  | "document-changed";

/** Events whose write outcome cannot be confirmed (INV-19); a closed set. */
export type Anomaly =
  | { readonly code: "rate-limited"; readonly retryAfterSeconds: number | null }
  | { readonly code: Exclude<AnomalyCode, "rate-limited"> };

export type Outcome<T> =
  | { readonly execId: string; readonly ok: true; readonly value: T }
  | { readonly execId: string; readonly ok: false; readonly anomaly: Anomaly };

export type Activity = "idle" | "running" | "unknown";

export interface InventoryRecord {
  readonly conversationId: string;
  readonly kind: string;
  /** Ephemeral (INV-03). */
  readonly title: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly archived: boolean | null;
  readonly activity: Activity;
  readonly stateToken: string | null;
}

export interface ReadDescriptor {
  readonly provider: Provider;
  readonly adapterId: string;
  readonly version: string;
  readonly listedKinds: readonly string[];
  readonly excludedKinds: readonly string[];
  readonly listing: {
    readonly stableSnapshot: boolean;
    readonly evidenceRef: string | null;
    readonly order: "updatedAt-desc" | "none";
  };
  /** Whether the meaning and unit of each time field were confirmed (DEV03). */
  readonly timeFields: { readonly createdAt: boolean; readonly updatedAt: boolean };
  readonly minIntervalMs: number;
}

export interface CallContext {
  readonly execId: string;
  readonly expiresAt: number;
}

export interface ScanContext extends CallContext {
  readonly subject: SubjectKeys;
  readonly documentKey: string;
}

export interface ScopeValue {
  readonly subject: SubjectEvidence;
  readonly documentKey: string;
}

export interface PageValue {
  /** Observed from this request's own response. */
  readonly subject: SubjectEvidence;
  readonly documentKey: string;
  readonly records: readonly InventoryRecord[];
  readonly invalidRecords: number;
  /** Canonical ids on records that failed validation; they still count as occurrences. */
  readonly invalidIds: readonly string[];
  readonly next: { readonly kind: "cursor"; readonly cursor: string } | { readonly kind: "end" };
  readonly reportedTotal: number | null;
}

export interface ReadAdapter {
  readonly descriptor: ReadDescriptor;
  readonly gate: FeatureGate;
  inspectScope(ctx: CallContext, signal: AbortSignal): Promise<unknown>;
  listPage(ctx: ScanContext, cursor: string | null, signal: AbortSignal): Promise<unknown>;
}

export type EvidenceKind = "item-deleted-marker" | "item-not-found" | "list-absent";

export type FingerprintField = "title" | "updatedAt" | "archived" | "stateToken";

export interface DeleteDescriptor {
  readonly adapterId: string;
  readonly version: string;
  readonly fingerprintFields: readonly FingerprintField[];
  readonly updateDetector: {
    readonly field: "updatedAt" | "stateToken";
    readonly evidenceRef: string;
  };
  readonly verificationRule: readonly EvidenceKind[];
  readonly verificationEvidenceRef: string;
}

export type ItemOperation = "preflight" | "commit" | "reconcile";

/** A single-use ticket the framework issues for one call about one target. */
export interface ItemTicket {
  readonly execId: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly subject: SubjectKeys;
  readonly documentKey: string;
  readonly conversationId: string;
  readonly operation: ItemOperation;
  readonly probe: EvidenceKind | null;
  readonly expiresAt: number;
}

export interface PreflightValue {
  readonly subject: SubjectEvidence;
  readonly documentKey: string;
  readonly item:
    | { readonly kind: "present"; readonly record: InventoryRecord }
    | { readonly kind: "absent"; readonly conversationId: string };
}

/** dispatch() sends the single instruction synchronously and returns { response }. */
export interface PreparedCommit {
  readonly documentKey: string;
  readonly dispatch: () => unknown;
}

export interface CommitValue {
  readonly conversationId: string;
  readonly accepted: true;
}

export interface ReconcileValue {
  readonly subject: SubjectEvidence;
  readonly documentKey: string;
  readonly conversationId: string;
  readonly probe: EvidenceKind;
  readonly satisfied: boolean;
}

export interface DeleteAdapter {
  readonly descriptor: DeleteDescriptor;
  readonly gate: FeatureGate;
  preflight(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>;
  /** Sends no request; resolves to Outcome<PreparedCommit>. */
  prepareCommit(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>;
  reconcileOne(ticket: ItemTicket, signal: AbortSignal): Promise<unknown>;
}
