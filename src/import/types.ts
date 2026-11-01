// Import contracts (P-0001 item 2, made concrete for ChatGPT exports by P-0005).
// TypeScript types are not a security boundary: the parser validates every
// value read from the export at runtime.

export type ISODateTime = string;

export interface ImportLimits {
  readonly maxCompressedBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxEntries: number;
  readonly maxJsonDepth: number;
  readonly maxMillis: number;
}

/** Provisional defaults (P-0005 item 4); revisit with the owner's structure report. */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = Object.freeze({
  maxCompressedBytes: 2 * 1024 ** 3,
  maxUncompressedBytes: 256 * 1024 ** 2,
  maxEntries: 100_000,
  maxJsonDepth: 64,
  maxMillis: 120_000,
});

/** Codes that end the import with status "failed". */
export type FatalCode =
  | "not-zip"
  | "zip-unsupported-layout"
  | "zip-zip64"
  | "zip-multi-disk"
  | "zip-truncated"
  | "zip-bad-directory"
  | "zip-duplicate-entry"
  | "zip-encrypted"
  | "zip-unsupported-method"
  | "zip-local-header-mismatch"
  | "zip-size-mismatch"
  | "zip-crc-mismatch"
  | "zip-inflate-error"
  | "limit-compressed"
  | "limit-uncompressed"
  | "limit-entries"
  | "limit-json-depth"
  | "limit-time"
  | "missing-conversations"
  | "json-syntax"
  | "json-encoding"
  | "not-conversation-array"
  | "worker-error";

/** Codes that make the import "partial"; the item is listed, never dropped silently. */
export type ItemCode =
  | "unknown-entry"
  | "not-object"
  | "missing-id"
  | "invalid-id"
  | "id-mismatch"
  | "duplicate-id"
  | "invalid-field"
  | "invalid-time"
  | "invalid-content"
  | "invalid-tree";

export type ImportIssueCode = FatalCode | ItemCode | "cancelled";

/**
 * `entry` locates the problem: a ZIP entry name, or `conversations.json[<index>]`
 * for one conversation. It never carries titles or message text.
 */
export interface ImportIssue {
  readonly code: ImportIssueCode;
  readonly entry: string | null;
}

export type AccountScope =
  | { readonly status: "unverified"; readonly displayLabel: string | null }
  | {
      readonly status: "verified";
      readonly accountKey: string;
      readonly workspaceKey: string;
      readonly evidenceRef: string;
    };

export type ContentCoverage = "none" | "partial" | "complete";

export interface Observation {
  readonly observedAt: ISODateTime;
  readonly source: "official-export" | "web-api";
  readonly contentCoverage: ContentCoverage;
  readonly revisionEvidence: string | null;
  readonly activity: "idle" | "running" | "unknown";
  readonly adapterVersion: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export interface ImportedMessage {
  readonly role: MessageRole;
  readonly createdAt: ISODateTime | null;
  /** Message text as a plain string; never rendered as HTML. */
  readonly text: string;
  readonly contentCoverage: ContentCoverage;
}

export interface ConversationNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly message: ImportedMessage | null;
}

/**
 * One conversation with its branch structure preserved (P-0001): branches are
 * never concatenated. A branch is a root-to-leaf path through `nodes`.
 */
export interface ConversationRecord {
  readonly provider: "chatgpt";
  readonly scope: AccountScope;
  readonly conversationId: string;
  /** Ephemeral (INV-03); never send to diagnostic logs. */
  readonly title: string | null;
  readonly createdAt: ISODateTime | null;
  readonly updatedAt: ISODateTime | null;
  readonly archived: boolean | null;
  readonly nodes: readonly ConversationNode[];
  readonly currentNodeId: string | null;
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

export type EntryCategory =
  | "conversations"
  | "chat-html"
  | "user-json"
  | "message-feedback"
  | "shared-conversations"
  | "attachment"
  | "directory"
  | "unknown";

/**
 * Shape-only summary of an export (P-0005 item 6). Holds counts, sizes,
 * schema key names and enumerated type values, never titles, text, IDs,
 * file names or account details.
 */
export interface StructureReport {
  readonly entryCount: number;
  readonly entries: Readonly<Partial<Record<EntryCategory, { count: number; bytes: number }>>>;
  readonly unknownExtensions: Readonly<Record<string, number>>;
  readonly conversationsUncompressedBytes: number | null;
  readonly conversationCount: number;
  readonly conversationKeys: Readonly<Record<string, number>>;
  readonly messageKeys: Readonly<Record<string, number>>;
  readonly contentTypes: Readonly<Record<string, number>>;
  readonly roles: Readonly<Record<string, number>>;
  readonly messageCoverage: Readonly<Record<string, number>>;
  readonly nodeCount: number;
  readonly leafCount: number;
  readonly maxTreeDepth: number;
}

export type ImportStatus = "complete" | "partial" | "failed" | "cancelled";

export interface ImportResult {
  readonly status: ImportStatus;
  readonly records: readonly ConversationRecord[];
  readonly coverage: Coverage;
  readonly issues: readonly ImportIssue[];
  readonly report: StructureReport;
}

export interface ExportImporter {
  readonly provider: "chatgpt";
  readonly version: string;
  parse(file: Blob, limits: ImportLimits, signal: AbortSignal): Promise<ImportResult>;
}
