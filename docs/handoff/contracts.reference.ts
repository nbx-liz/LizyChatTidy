/**
 * LizyChatTidy v0.1.1 - reference contracts only.
 * No browser automation or deletion implementation is included.
 * Validate untrusted input at runtime; TypeScript types are not a security boundary.
 * Destructive adapters must remain disabled until all release gates pass.
 */
export type Provider = "chatgpt-web" | "claude-code-web";
export type ISODateTime = string;
export type GateStatus = "unreviewed" | "allowed" | "blocked";
export interface FeatureGate {
  readonly technical: GateStatus;
  readonly termsAndPermission: GateStatus;
  readonly safety: GateStatus;
  readonly evidenceRefs: readonly string[];
  readonly reviewedAt: ISODateTime | null;
}
export type AccountScope =
  | { readonly status: "unverified"; readonly displayLabel: string | null }
  | { readonly status: "verified"; readonly accountKey: string;
      readonly workspaceKey: string; readonly evidenceRef: string };
export interface ConversationRef {
  readonly provider: Provider;
  readonly accountKey: string;
  readonly workspaceKey: string;
  readonly conversationId: string;
}
export interface Observation {
  readonly observedAt: ISODateTime;
  readonly source: "official-export" | "web-dom";
  readonly contentCoverage: "none" | "partial" | "complete";
  readonly revisionEvidence: string | null;
  readonly activity: "idle" | "running" | "unknown";
  readonly adapterVersion: string;
}
export interface ConversationRecord {
  readonly provider: Provider;
  readonly scope: AccountScope;
  readonly conversationId: string | null;
  readonly title: string | null; // Ephemeral by default; never send to diagnostic logs.
  readonly createdAt: ISODateTime | null;
  readonly updatedAt: ISODateTime | null;
  readonly archived: boolean | null;
  readonly observation: Observation;
}
export interface Coverage {
  readonly status: "partial" | "unknown" | "complete-within-declared-scope";
  readonly declaredScope: string;
  readonly observedCount: number;
  readonly reportedTotal: number | null;
  readonly excludedScopes: readonly string[];
  readonly evidenceRefs: readonly string[];
}
export interface KeepSnapshot {
  readonly status: "available" | "locked" | "corrupt" | "unavailable";
  readonly revision: number;
  readonly protectedRefs: readonly ConversationRef[];
}
export interface PlannedItem {
  readonly ref: ConversationRef;
  readonly observed: Observation;
  readonly stateFingerprint: string;
}
export interface DeletePlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly createdAt: ISODateTime;
  readonly expiresAt: ISODateTime;
  readonly keepRevision: number;
  readonly coverage: Coverage;
  readonly targets: readonly PlannedItem[];
  readonly planDigest: string;
}
export interface Approval {
  readonly approvalId: string; // Controller-issued, single-use, memory only.
  readonly planId: string;
  readonly planDigest: string;
  readonly approvedAt: ISODateTime;
  readonly expiresAt: ISODateTime;
}
export type StopReason =
  | "keep-protected" | "keep-unavailable" | "scope-unverified"
  | "scope-mismatch" | "state-changed" | "state-unknown"
  | "active-session" | "permission-lost" | "unsupported-ui"
  | "ambiguous-target" | "gate-blocked" | "cancelled"
  | "approval-invalid" | "concurrent-run";
export type Preflight =
  | { readonly ok: true; readonly ref: ConversationRef;
      readonly latest: Observation; readonly keepRevision: number;
      readonly evidenceRefs: readonly string[] }
  | { readonly ok: false; readonly reason: StopReason };
export type DeleteResult =
  | { readonly status: "verified-in-ui"; readonly ref: ConversationRef;
      readonly evidenceRefs: readonly string[]; readonly checkedAt: ISODateTime }
  | { readonly status: "skipped" | "failed"; readonly ref: ConversationRef;
      readonly reason: StopReason | "operation-error" }
  | { readonly status: "uncertain"; readonly ref: ConversationRef;
      readonly reason: "timeout" | "interrupted" | "insufficient-evidence" };
export interface AdapterCapabilities {
  readonly read: FeatureGate;
  readonly assist: FeatureGate;
  readonly automaticDelete: FeatureGate;
}
export interface WebHistoryAdapter {
  readonly provider: Provider;
  readonly version: string;
  capabilities(): AdapterCapabilities;
  inspectScope(signal: AbortSignal): Promise<AccountScope>;
  collect(signal: AbortSignal): Promise<{
    readonly records: readonly ConversationRecord[];
    readonly coverage: Coverage;
  }>;
  openConversation(ref: ConversationRef, signal: AbortSignal): Promise<void>;
  preflight(item: PlannedItem, keep: KeepSnapshot,
            signal: AbortSignal): Promise<Preflight>;
  // Controller rechecks scope, KEEP and approval immediately before each commit.
  // After commit, cancellation cannot promise to undo the service-side operation.
  commitOne(item: PlannedItem, approval: Approval,
            signal: AbortSignal): Promise<DeleteResult>;
}
export type RunState = "draft" | "ready" | "approved" | "running"
  | "paused" | "failed" | "uncertain" | "completed";
// Runtime schemas, token validation, durable locks and evidence verification are
// implementation tasks. These interfaces alone do not implement those controls.
