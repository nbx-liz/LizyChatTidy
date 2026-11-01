// Deep freezing for values the controller hands out or keeps as evidence of
// a decision (plans, approvals, tickets, results). Review 1 #2: a mutable
// internal reference let callers widen an approved plan.

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** A deep copy that is frozen, for JSON-like adapter declarations. */
export function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}
