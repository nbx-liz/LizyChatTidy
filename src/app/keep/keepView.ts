// What the workspace needs to show and change KEEP marks (P-0007 item 10).
// Outside `available` nothing is claimed: no count, no badge (INV-05).
import type { ConversationRecord } from "../../import/types";
import { isProtected, type KeepEntry } from "../../keep/keepRules";
import type { KeepState, OpResult } from "../../keep/keepStore";

export interface KeepView {
  readonly status: KeepState["status"];
  /** null unless the store is available. */
  readonly count: number | null;
  /** true / false when the store is available; null when KEEP cannot be checked. */
  isKept(record: ConversationRecord): boolean | null;
  toggle(record: ConversationRecord, keep: boolean): Promise<OpResult>;
  /** Why KEEP cannot be changed now, or null when it can. */
  readonly blockedReason: string | null;
}

/**
 * The entry a record is marked with. Export records have an unverified
 * subject, so their KEEP has scope null and protects every subject (P-0001).
 */
export function entryFor(record: ConversationRecord): KeepEntry {
  const scope =
    record.scope.status === "verified"
      ? { accountKey: record.scope.accountKey, workspaceKey: record.scope.workspaceKey }
      : null;
  return { provider: record.provider, conversationId: record.conversationId, scope };
}

const BLOCKED: Readonly<Partial<Record<KeepState["status"], string>>> = {
  loading: "KEEP の保存先を確認しています。",
  absent: "KEEP を付けるには、左の「KEEP の保存先」で保存先を作成してください。",
  locked: "KEEP を付けるには、左の「KEEP の保存先」で解除してください。",
  corrupt: "KEEP の保存先を利用できません。左のパネルを確認してください。",
  unavailable: "KEEP の保存先を利用できません。左のパネルを確認してください。",
};

export function keepViewOf(
  state: KeepState,
  setKeep: (entry: KeepEntry, keep: boolean) => Promise<OpResult>,
): KeepView {
  const available = state.status === "available";
  return {
    status: state.status,
    count: available ? state.entries.length : null,
    isKept: (record) =>
      available
        ? isProtected(state.entries, {
            provider: record.provider,
            conversationId: record.conversationId,
            scope: entryFor(record).scope,
          })
        : null,
    toggle: (record, keep) => setKeep(entryFor(record), keep),
    blockedReason: available ? null : (BLOCKED[state.status] ?? null),
  };
}
