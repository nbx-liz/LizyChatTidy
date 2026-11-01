// Captures the caller's dependencies once (review 2 #2). The controller keeps
// its own frozen object whose methods are bound to the instances given at
// construction, so replacing a field of the caller's deps object, or a method
// on one of its instances, never redirects a later call. The adapters'
// declarations are read through getters from those same instances, so the
// declarations that are validated are always the ones of the instance that is
// called (AdapterBinding compares them against its frozen copies).
import type { DeleteAdapter, ReadAdapter } from "../adapters/contracts";
import type { Clock, LedgerStorage, ServiceLockManager } from "./environment";
import type { KeepPort, RunDeps } from "./types";

type AnyFn = (...args: never[]) => unknown;

/** Binds `name` of `owner` now; a missing method becomes one that always fails (DC1). */
function bound<T extends object, K extends keyof T>(owner: T, name: K): T[K] {
  const fn = owner[name];
  if (typeof fn !== "function") {
    return (() => {
      throw new Error(`lizychattidy: dependency method ${String(name)} is missing`);
    }) as T[K];
  }
  return (fn as unknown as AnyFn).bind(owner) as T[K];
}

function captureRead(read: ReadAdapter): ReadAdapter {
  return Object.freeze({
    get descriptor() {
      return read.descriptor;
    },
    get gate() {
      return read.gate;
    },
    inspectScope: bound(read, "inspectScope"),
    listPage: bound(read, "listPage"),
  });
}

function captureDelete(del: DeleteAdapter): DeleteAdapter {
  return Object.freeze({
    get descriptor() {
      return del.descriptor;
    },
    get gate() {
      return del.gate;
    },
    preflight: bound(del, "preflight"),
    prepareCommit: bound(del, "prepareCommit"),
    reconcileOne: bound(del, "reconcileOne"),
  });
}

function captureClock(clock: Clock): Clock {
  return Object.freeze({
    now: bound(clock, "now"),
    sleep: bound(clock, "sleep"),
    deadline: bound(clock, "deadline"),
  });
}

export function captureDeps(deps: RunDeps): RunDeps {
  const keep: KeepPort = Object.freeze({
    binding: bound(deps.keep, "binding"),
    withOrderedSnapshot: bound(deps.keep, "withOrderedSnapshot"),
  });
  const ledger: LedgerStorage = Object.freeze({
    get: bound(deps.ledger, "get"),
    set: bound(deps.ledger, "set"),
  });
  const locks: ServiceLockManager | null =
    deps.locks === null ? null : Object.freeze({ request: bound(deps.locks, "request") });
  return Object.freeze({
    provider: deps.provider,
    read: captureRead(deps.read),
    del: deps.del === null ? null : captureDelete(deps.del),
    build: deps.build,
    keep,
    ledger,
    locks,
    clock: captureClock(deps.clock),
    newId: deps.newId,
    subtle: deps.subtle,
  });
}
