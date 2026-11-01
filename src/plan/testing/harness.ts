// Test-only wiring of a run controller with the synthetic service, a real
// KeepStore on fake storage, fake time and fake locks.
import { webcrypto } from "node:crypto";
import type { DeleteAdapter, ReadAdapter } from "../../adapters/contracts";
import { SyntheticService, syntheticDelete, syntheticRead } from "../../adapters/testing/synthetic";
import { KeepStore } from "../../keep/keepStore";
import { FakeArea, FakeLocks, deps as keepDeps } from "../../keep/testing/fakes";
import { RunController } from "../runController";
import type { RunDeps } from "../types";
import { FakeClock, FakeServiceLocks } from "./fakes";

export const PASS = "correct horse battery";
export const subtle = webcrypto.subtle as unknown as SubtleCrypto;

export interface Profile {
  readonly area: FakeArea;
  readonly keepLocks: FakeLocks;
  readonly serviceLocks: FakeServiceLocks;
  readonly clock: FakeClock;
}

export function newProfile(): Profile {
  return {
    area: new FakeArea(),
    keepLocks: new FakeLocks(),
    serviceLocks: new FakeServiceLocks(),
    clock: new FakeClock(),
  };
}

export async function openKeep(profile: Profile, create: boolean): Promise<KeepStore> {
  const store = new KeepStore(keepDeps(profile.area, {}, profile.keepLocks));
  await store.init();
  if (create) {
    if ((await store.create(PASS, true)) !== "ok") {
      throw new Error("keep create failed");
    }
  } else if ((await store.unlock(PASS)) !== "ok") {
    throw new Error("keep unlock failed");
  }
  return store;
}

export interface Rig {
  readonly profile: Profile;
  readonly service: SyntheticService;
  readonly keep: KeepStore;
  readonly controller: RunController;
}

export function controllerFor(
  profile: Profile,
  service: SyntheticService,
  keep: KeepStore,
  extra: Partial<RunDeps> = {},
): RunController {
  const read: ReadAdapter = syntheticRead(service);
  const del: DeleteAdapter = syntheticDelete(service);
  return new RunController({
    provider: "chatgpt",
    read,
    del,
    build: "distribution",
    keep,
    ledger: profile.area.view(),
    locks: profile.serviceLocks,
    clock: profile.clock,
    newId: () => webcrypto.randomUUID(),
    subtle,
    ...extra,
  });
}

export async function rig(extra: Partial<RunDeps> = {}, count = 4): Promise<Rig> {
  const profile = newProfile();
  const service = new SyntheticService(() => profile.clock.now(), count);
  const keep = await openKeep(profile, true);
  return { profile, service, keep, controller: controllerFor(profile, service, keep, extra) };
}

/** Collects, plans the given ids (default: all visible) and approves. */
export async function approved(r: Rig, ids?: readonly string[]): Promise<string> {
  const c = r.controller;
  const collected = await c.collect();
  if (!collected.ok) {
    throw new Error(`collect failed: ${collected.reason}`);
  }
  const chosen = ids ?? [...(c.snapshot?.records.keys() ?? [])];
  const planned = await c.makePlan(chosen);
  if (!planned.ok) {
    throw new Error(`plan failed: ${planned.reason}`);
  }
  const plan = c.plan;
  if (plan === null) {
    throw new Error("no plan");
  }
  const ok = await c.approve(plan.planId, plan.planDigest);
  if (!ok.ok || c.approval === null) {
    throw new Error(`approve failed: ${ok.ok ? "" : ok.reason}`);
  }
  return c.approval.approvalId;
}

export function outcomes(c: RunController): Record<string, string> {
  return Object.fromEntries(
    c.items().map((i) => [i.conversationId, `${i.outcome}:${i.reason ?? ""}`]),
  );
}
