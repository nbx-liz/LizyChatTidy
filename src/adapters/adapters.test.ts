import { describe, expect, it } from "vitest";
import type { FeatureGate, GateStatus } from "./contracts";
import { validDeleteDescriptor, validReadDescriptor } from "./descriptor";
import { capabilityEnabled, OWNER_RISK_RECORD } from "./gate";
import {
  ALLOWED_GATE,
  DELETE_DESCRIPTOR,
  fakeId,
  fakeRecord,
  READ_DESCRIPTOR,
} from "./testing/synthetic";
import { parseOutcome, parsePage, parseReconcile, parseRecord, parseSubject } from "./validate";

const gate = (
  g: Partial<Record<keyof Omit<FeatureGate, "evidenceRefs">, GateStatus>>,
  refs: string[] = [],
): FeatureGate => ({
  ...ALLOWED_GATE,
  ...g,
  evidenceRefs: refs,
});

describe("capabilityEnabled (PINV-11)", () => {
  it("distribution needs all four allowed", () => {
    expect(capabilityEnabled(ALLOWED_GATE, "distribution")).toBe(true);
    for (const key of ["technical", "termsAndPermission", "storePolicy", "safety"] as const) {
      expect(capabilityEnabled(gate({ [key]: "unreviewed" }), "distribution")).toBe(false);
    }
    expect(
      capabilityEnabled(
        gate({ termsAndPermission: "ownerAcceptedRisk" }, [OWNER_RISK_RECORD]),
        "distribution",
      ),
    ).toBe(false);
    expect(capabilityEnabled(gate({ storePolicy: "notApplicable" }), "distribution")).toBe(false);
  });

  it("personal accepts ownerAcceptedRisk only with the recorded decision", () => {
    const risk = { termsAndPermission: "ownerAcceptedRisk", storePolicy: "notApplicable" } as const;
    expect(capabilityEnabled(gate(risk, [OWNER_RISK_RECORD]), "personal")).toBe(true);
    expect(capabilityEnabled(gate(risk, []), "personal")).toBe(false);
    expect(
      capabilityEnabled(gate({ ...risk, safety: "unreviewed" }, [OWNER_RISK_RECORD]), "personal"),
    ).toBe(false);
  });

  it("a special value placed on another judgement disables the gate", () => {
    expect(
      capabilityEnabled(gate({ technical: "ownerAcceptedRisk" }, [OWNER_RISK_RECORD]), "personal"),
    ).toBe(false);
    expect(capabilityEnabled(gate({ termsAndPermission: "notApplicable" }), "personal")).toBe(
      false,
    );
    expect(capabilityEnabled(gate({ safety: "maybe" as GateStatus }), "personal")).toBe(false);
  });
});

describe("descriptors (PINV-11)", () => {
  it("accepts the synthetic descriptors", () => {
    expect(validReadDescriptor(READ_DESCRIPTOR)).toBe(true);
    expect(validDeleteDescriptor(DELETE_DESCRIPTOR, READ_DESCRIPTOR)).toBe(true);
  });

  it("rejects request spacing below the floor and a stable claim without evidence", () => {
    expect(validReadDescriptor({ ...READ_DESCRIPTOR, minIntervalMs: 999 })).toBe(false);
    expect(
      validReadDescriptor({
        ...READ_DESCRIPTOR,
        listing: { stableSnapshot: true, evidenceRef: null, order: "none" },
      }),
    ).toBe(false);
  });

  it("rejects a rule without the positive deletion marker or with one kind", () => {
    const d = DELETE_DESCRIPTOR;
    expect(
      validDeleteDescriptor(
        { ...d, verificationRule: ["item-not-found", "list-absent"] },
        READ_DESCRIPTOR,
      ),
    ).toBe(false);
    expect(
      validDeleteDescriptor({ ...d, verificationRule: ["item-deleted-marker"] }, READ_DESCRIPTOR),
    ).toBe(false);
    expect(
      validDeleteDescriptor(
        { ...d, verificationRule: ["item-deleted-marker", "item-deleted-marker"] },
        READ_DESCRIPTOR,
      ),
    ).toBe(false);
  });

  it("rejects an update detector outside the fingerprint or an unverified updatedAt", () => {
    const d = DELETE_DESCRIPTOR;
    expect(validDeleteDescriptor({ ...d, fingerprintFields: ["title"] }, READ_DESCRIPTOR)).toBe(
      false,
    );
    const unverified = { ...READ_DESCRIPTOR, timeFields: { createdAt: true, updatedAt: false } };
    expect(validDeleteDescriptor(d, unverified)).toBe(false);
    expect(validDeleteDescriptor({ ...d, fingerprintFields: ["stateToken"] }, unverified)).toBe(
      true,
    );
  });

  it("rejects a delete descriptor of another adapter version", () => {
    expect(validDeleteDescriptor({ ...DELETE_DESCRIPTOR, version: "9" }, READ_DESCRIPTOR)).toBe(
      false,
    );
  });
});

describe("validation (PINV-9)", () => {
  const exec = "11111111-1111-4111-8111-111111111111";

  it("parses ok and anomaly outcomes and rejects everything else", () => {
    expect(parseOutcome({ execId: exec, ok: true, value: 1 }, exec, (v) => v)).toEqual({
      kind: "ok",
      value: 1,
    });
    expect(
      parseOutcome({ execId: exec, ok: false, anomaly: { code: "redirect" } }, exec, (v) => v),
    ).toEqual({
      kind: "anomaly",
      anomaly: { code: "redirect" },
    });
    const invalid = [
      { execId: "other", ok: true, value: 1 },
      { execId: exec, ok: true, value: 1, extra: true },
      { execId: exec, ok: false, anomaly: { code: "teapot" } },
      { execId: exec, ok: false, anomaly: { code: "rate-limited", retryAfterSeconds: -1 } },
      { execId: exec, ok: false, anomaly: { code: "redirect", retryAfterSeconds: 1 } },
      { execId: exec, ok: "yes", value: 1 },
      Object.assign(Object.create({ inherited: 1 }), { execId: exec, ok: true, value: 1 }),
      null,
      [],
    ];
    for (const raw of invalid) {
      expect(parseOutcome(raw, exec, (v) => v)).toEqual({ kind: "invalid" });
    }
    expect(parseOutcome({ execId: exec, ok: true, value: 1 }, exec, () => null)).toEqual({
      kind: "invalid",
    });
  });

  it("rejects malformed records", () => {
    const good = fakeRecord(1);
    expect(parseRecord(good, "chatgpt", ["chat"])).toEqual(good);
    const bad = [
      { ...good, conversationId: "../conversations" },
      { ...good, conversationId: fakeId(10).toUpperCase() },
      { ...good, kind: "project" },
      { ...good, title: "x".repeat(2001) },
      { ...good, updatedAt: "2026-02-01 10:00:00" },
      { ...good, updatedAt: "2101-01-01T00:00:00Z" },
      { ...good, archived: "no" },
      { ...good, activity: "busy" },
      { ...good, stateToken: "has space" },
      { ...good, extra: 1 },
    ];
    for (const r of bad) {
      expect(parseRecord(r, "chatgpt", ["chat"])).toBeNull();
    }
  });

  it("counts invalid records in a page instead of dropping them silently", () => {
    const page = {
      subject: { status: "unverified" },
      documentKey: "doc-1",
      records: [fakeRecord(1), { nope: 1 }],
      next: { kind: "end" },
      reportedTotal: 2,
    };
    expect(parsePage(page, "chatgpt", ["chat"])).toMatchObject({ invalidRecords: 1 });
    expect(
      parsePage({ ...page, next: { kind: "cursor", cursor: "" } }, "chatgpt", ["chat"]),
    ).toBeNull();
  });

  it("parses subjects and reconcile answers strictly", () => {
    expect(
      parseSubject({
        status: "verified",
        accountKey: "a",
        workspaceKey: "w",
        workspaceKind: "personal",
      }),
    ).not.toBeNull();
    expect(
      parseSubject({
        status: "verified",
        accountKey: "",
        workspaceKey: "w",
        workspaceKind: "personal",
      }),
    ).toBeNull();
    expect(
      parseSubject({
        status: "verified",
        accountKey: "a",
        workspaceKey: "w",
        workspaceKind: "team",
      }),
    ).toBeNull();
    const r = {
      subject: { status: "unverified" },
      documentKey: "d",
      conversationId: fakeId(1),
      probe: "list-absent",
      satisfied: true,
    };
    expect(parseReconcile(r, "chatgpt")).not.toBeNull();
    expect(parseReconcile({ ...r, probe: "gone" }, "chatgpt")).toBeNull();
    expect(parseReconcile({ ...r, satisfied: "true" }, "chatgpt")).toBeNull();
  });
});
