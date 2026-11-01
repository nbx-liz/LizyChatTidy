// Test-only synthetic service and adapters with fault injection (P-0009
// item 11). Every id, record, subject and piece of evidence here is invented;
// nothing models a real endpoint or response (D-0004).
import type {
  Anomaly,
  DeleteAdapter,
  DeleteDescriptor,
  EvidenceKind,
  FeatureGate,
  InventoryRecord,
  ItemTicket,
  ReadAdapter,
  ReadDescriptor,
  ScanContext,
  SubjectEvidence,
} from "../contracts";

export const ALLOWED_GATE: FeatureGate = {
  technical: "allowed",
  termsAndPermission: "allowed",
  storePolicy: "allowed",
  safety: "allowed",
  evidenceRefs: [],
};

export const READ_DESCRIPTOR: ReadDescriptor = {
  provider: "chatgpt",
  adapterId: "synthetic",
  version: "0.0.1-test",
  listedKinds: ["chat"],
  excludedKinds: ["project"],
  listing: { stableSnapshot: true, evidenceRef: "TEST:stable", order: "updatedAt-desc" },
  timeFields: { createdAt: true, updatedAt: true },
  minIntervalMs: 1_000,
};

export const DELETE_DESCRIPTOR: DeleteDescriptor = {
  adapterId: "synthetic",
  version: "0.0.1-test",
  fingerprintFields: ["stateToken", "updatedAt"],
  updateDetector: { field: "stateToken", evidenceRef: "TEST:state-token" },
  verificationRule: ["item-deleted-marker", "list-absent"],
  verificationEvidenceRef: "TEST:verification",
};

export const SUBJECT_A = { accountKey: "acct-a", workspaceKey: "ws-a" } as const;
export const SUBJECT_B = { accountKey: "acct-b", workspaceKey: "ws-b" } as const;

/** Invented ids in the canonical (UUID) form. */
export function fakeId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function fakeRecord(n: number, extra: Partial<InventoryRecord> = {}): InventoryRecord {
  const minute = String(59 - (n % 60)).padStart(2, "0");
  return {
    conversationId: fakeId(n),
    kind: "chat",
    title: `Synthetic conversation ${n}`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: `2026-02-01T10:${minute}:00Z`,
    archived: false,
    activity: "idle",
    stateToken: `rev-${n}-1`,
    ...extra,
  };
}

export type Op =
  | "inspectScope"
  | "listPage"
  | "preflight"
  | "prepareCommit"
  | "dispatch"
  | "reconcileOne";

export interface CallLog {
  readonly op: Op;
  readonly at: number;
  readonly id: string | null;
  readonly probe: EvidenceKind | null;
}

/** Returning undefined lets the normal behaviour run; anything else is returned raw. */
export type Override = (op: Op, ticket: ItemTicket | ScanContext | null) => unknown;

export class SyntheticService {
  readonly records = new Map<string, InventoryRecord>();
  readonly deleted = new Set<string>();
  readonly hidden = new Set<string>();
  readonly log: CallLog[] = [];
  subject: SubjectEvidence = { status: "verified", ...SUBJECT_A, workspaceKind: "personal" };
  documentKey = "doc-1";
  pageSize = 2;
  reportedTotal: number | "auto" | null = "auto";
  /** When true, a confirmed commit only hides the conversation (AT26). */
  hideInsteadOfDelete = false;
  override: Override | null = null;
  /** Awaited inside prepareCommit, before it resolves (interleaving point). */
  onPrepare: ((ticket: ItemTicket) => Promise<void>) | null = null;
  /** Called synchronously inside dispatch, after the instruction left. */
  onDispatch: ((ticket: ItemTicket) => void) | null = null;
  /** Called on each listPage before answering (to inject changes mid-scan). */
  onPage: ((pageNo: number) => void) | null = null;
  /** Replaces the commit response; may never settle. */
  commitResponse: ((ticket: ItemTicket) => Promise<unknown>) | null = null;

  constructor(
    private readonly now: () => number,
    count = 4,
  ) {
    for (let i = 1; i <= count; i++) {
      this.add(fakeRecord(i));
    }
  }

  add(record: InventoryRecord): void {
    this.records.set(record.conversationId, record);
  }

  commits(): string[] {
    return this.log.filter((c) => c.op === "dispatch").map((c) => c.id as string);
  }

  visible(): InventoryRecord[] {
    return [...this.records.values()]
      .filter((r) => !this.deleted.has(r.conversationId) && !this.hidden.has(r.conversationId))
      .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""));
  }

  record(op: Op, id: string | null, probe: EvidenceKind | null = null): void {
    this.log.push({ op, at: this.now(), id, probe });
  }

  injected(op: Op, ctx: ItemTicket | ScanContext | null): unknown {
    return this.override === null ? undefined : this.override(op, ctx);
  }
}

export const ok = (execId: string, value: unknown) => ({ execId, ok: true, value });
export const anomaly = (execId: string, a: Anomaly) => ({ execId, ok: false, anomaly: a });

export function syntheticRead(
  service: SyntheticService,
  descriptor = READ_DESCRIPTOR,
  gate = ALLOWED_GATE,
): ReadAdapter {
  let pageNo = 0;
  return {
    descriptor,
    gate,
    inspectScope: async (ctx) => {
      service.record("inspectScope", null);
      pageNo = 0;
      const raw = service.injected("inspectScope", null);
      return raw !== undefined
        ? raw
        : ok(ctx.execId, { subject: service.subject, documentKey: service.documentKey });
    },
    listPage: async (ctx, cursor) => {
      service.record("listPage", null);
      service.onPage?.(pageNo++);
      const raw = service.injected("listPage", ctx);
      if (raw !== undefined) {
        return raw;
      }
      const all = service.visible();
      const start = cursor === null ? 0 : Number(cursor.slice(1));
      const slice = all.slice(start, start + service.pageSize);
      const end = start + service.pageSize >= all.length;
      const total = service.reportedTotal === "auto" ? all.length : service.reportedTotal;
      return ok(ctx.execId, {
        subject: service.subject,
        documentKey: service.documentKey,
        records: slice,
        next: end ? { kind: "end" } : { kind: "cursor", cursor: `p${start + service.pageSize}` },
        reportedTotal: total,
      });
    },
  };
}

function probeSatisfied(service: SyntheticService, id: string, probe: EvidenceKind): boolean {
  if (probe === "item-deleted-marker") {
    return service.deleted.has(id);
  }
  return service.deleted.has(id) || service.hidden.has(id);
}

export function syntheticDelete(
  service: SyntheticService,
  descriptor = DELETE_DESCRIPTOR,
  gate = ALLOWED_GATE,
): DeleteAdapter {
  return {
    descriptor,
    gate,
    preflight: async (t) => {
      service.record("preflight", t.conversationId);
      const raw = service.injected("preflight", t);
      if (raw !== undefined) {
        return raw;
      }
      const r = service.records.get(t.conversationId);
      const gone = r === undefined || service.deleted.has(t.conversationId);
      return ok(t.execId, {
        subject: service.subject,
        documentKey: service.documentKey,
        item: gone
          ? { kind: "absent", conversationId: t.conversationId }
          : { kind: "present", record: r },
      });
    },
    prepareCommit: async (t) => {
      service.record("prepareCommit", t.conversationId);
      await service.onPrepare?.(t);
      const raw = service.injected("prepareCommit", t);
      if (raw !== undefined) {
        return raw;
      }
      const dispatch = () => {
        service.record("dispatch", t.conversationId);
        if (service.hideInsteadOfDelete) {
          service.hidden.add(t.conversationId);
        } else {
          service.deleted.add(t.conversationId);
        }
        service.onDispatch?.(t);
        const response =
          service.commitResponse !== null
            ? service.commitResponse(t)
            : Promise.resolve(ok(t.execId, { conversationId: t.conversationId, accepted: true }));
        return { response };
      };
      return ok(t.execId, { documentKey: service.documentKey, dispatch });
    },
    reconcileOne: async (t) => {
      const probe = t.probe as EvidenceKind;
      service.record("reconcileOne", t.conversationId, probe);
      const raw = service.injected("reconcileOne", t);
      if (raw !== undefined) {
        return raw;
      }
      return ok(t.execId, {
        subject: service.subject,
        documentKey: service.documentKey,
        conversationId: t.conversationId,
        probe,
        satisfied: probeSatisfied(service, t.conversationId, probe),
      });
    },
  };
}
