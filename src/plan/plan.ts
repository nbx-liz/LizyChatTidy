// Delete plan generation (P-0009 item 5). The plan is an immutable selection
// of explicit ids out of one frozen snapshot; conditions are never
// re-evaluated (INV-04).
import type {
  DeleteDescriptor,
  FingerprintField,
  InventoryRecord,
  SubjectKeys,
} from "../adapters/contracts";
import { isProtected } from "../keep/keepRules";
import type { KeepBinding } from "../keep/keepStore";
import { canonicalJson, sha256Hex } from "./canonical";
import type { Completeness, InventorySnapshot } from "./inventory";

export const PLAN_APPROVABLE_MS = 15 * 60_000;

export const EXCLUSION_REASONS = [
  "not-in-inventory",
  "duplicate",
  "subject-unverified",
  "workspace-not-personal",
  "active-or-unknown",
  "state-unknown",
  "keep-protected",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface PlanTarget {
  readonly conversationId: string;
  readonly fingerprint: string;
}

export interface DeletePlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly parentPlanId: string | null;
  readonly createdAt: number;
  readonly approvableUntil: number;
  readonly provider: "chatgpt" | "claude-code";
  readonly subject: SubjectKeys;
  readonly documentKey: string;
  readonly adapter: { readonly adapterId: string; readonly version: string };
  readonly snapshot: {
    readonly snapshotId: string;
    readonly completeness: Completeness;
    readonly capturedAt: number;
    readonly ledgerEpoch: number;
  };
  readonly keep: { readonly storeId: string; readonly revision: number };
  readonly targets: readonly PlanTarget[];
  readonly excluded: Readonly<Record<ExclusionReason, number>>;
  readonly planDigest: string;
}

export interface PlanInput {
  readonly snapshot: InventorySnapshot;
  readonly ids: readonly string[];
  readonly keep: KeepBinding;
  readonly del: DeleteDescriptor;
  readonly parentPlanId: string | null;
  readonly now: number;
  readonly newId: () => string;
  readonly subtle: SubtleCrypto;
}

export type PlanResult =
  | { readonly ok: true; readonly plan: DeletePlan }
  | {
      readonly ok: false;
      readonly reason: "no-targets" | "snapshot-not-plannable";
      readonly excluded: Readonly<Record<ExclusionReason, number>>;
    };

function fingerprintSource(
  record: InventoryRecord,
  fields: readonly FingerprintField[],
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const value = record[f];
    if (value === null) {
      return null;
    }
    out[f] = value;
  }
  return out;
}

export async function fingerprintOf(
  subtle: SubtleCrypto,
  record: InventoryRecord,
  fields: readonly FingerprintField[],
): Promise<string | null> {
  const source = fingerprintSource(record, fields);
  return source === null ? null : sha256Hex(subtle, canonicalJson(source));
}

function emptyCounts(): Record<ExclusionReason, number> {
  const counts = {} as Record<ExclusionReason, number>;
  for (const r of EXCLUSION_REASONS) {
    counts[r] = 0;
  }
  return counts;
}

function exclusionOf(
  input: PlanInput,
  id: string,
  seen: Set<string>,
): ExclusionReason | InventoryRecord {
  const { snapshot, keep } = input;
  if (seen.has(id)) {
    return "duplicate";
  }
  seen.add(id);
  if (snapshot.duplicateIds.has(id)) {
    return "duplicate";
  }
  const record = snapshot.records.get(id);
  if (record === undefined) {
    return "not-in-inventory";
  }
  const subject = snapshot.subject;
  if (subject.status !== "verified" || snapshot.source !== "web-api") {
    return "subject-unverified";
  }
  if (subject.workspaceKind !== "personal") {
    return "workspace-not-personal";
  }
  if (record.activity !== "idle") {
    return "active-or-unknown";
  }
  if (fingerprintSource(record, input.del.fingerprintFields) === null) {
    return "state-unknown";
  }
  const scope = { accountKey: subject.accountKey, workspaceKey: subject.workspaceKey };
  if (isProtected(keep.entries, { provider: snapshot.provider, conversationId: id, scope })) {
    return "keep-protected";
  }
  return record;
}

/** Computes the digest over every plan field except the digest itself. */
export async function digestOf(
  subtle: SubtleCrypto,
  plan: Omit<DeletePlan, "planDigest">,
): Promise<string> {
  return sha256Hex(subtle, canonicalJson(plan));
}

export async function buildPlan(input: PlanInput): Promise<PlanResult> {
  const { snapshot } = input;
  const counts = emptyCounts();
  const picked: InventoryRecord[] = [];
  const seen = new Set<string>();
  for (const id of input.ids) {
    const outcome = exclusionOf(input, id, seen);
    if (typeof outcome === "string") {
      counts[outcome]++;
    } else {
      picked.push(outcome);
    }
  }
  const subject = snapshot.subject;
  if (
    picked.length === 0 ||
    subject.status !== "verified" ||
    snapshot.documentKey === null ||
    snapshot.ledgerEpoch === null
  ) {
    return {
      ok: false,
      reason: picked.length === 0 ? "no-targets" : "snapshot-not-plannable",
      excluded: counts,
    };
  }
  const targets: PlanTarget[] = [];
  for (const record of picked) {
    const fingerprint = await fingerprintOf(input.subtle, record, input.del.fingerprintFields);
    if (fingerprint !== null) {
      targets.push({ conversationId: record.conversationId, fingerprint });
    }
  }
  targets.sort((a, b) =>
    a.conversationId < b.conversationId ? -1 : a.conversationId > b.conversationId ? 1 : 0,
  );
  const body: Omit<DeletePlan, "planDigest"> = {
    schemaVersion: 1,
    planId: input.newId(),
    parentPlanId: input.parentPlanId,
    createdAt: input.now,
    approvableUntil: input.now + PLAN_APPROVABLE_MS,
    provider: snapshot.provider,
    subject: { accountKey: subject.accountKey, workspaceKey: subject.workspaceKey },
    documentKey: snapshot.documentKey,
    adapter: snapshot.adapter,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      completeness: snapshot.completeness,
      capturedAt: snapshot.capturedAt,
      ledgerEpoch: snapshot.ledgerEpoch,
    },
    keep: { storeId: input.keep.storeId, revision: input.keep.revision },
    targets,
    excluded: counts,
  };
  return { ok: true, plan: { ...body, planDigest: await digestOf(input.subtle, body) } };
}
