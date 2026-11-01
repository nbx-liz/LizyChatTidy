// The run ledger: a persisted count of dispatched writes whose outcome is not
// yet confirmed (P-0009 item 3). It holds no conversation id, title or
// subject (AT28). Every read and write happens under the service lock.
import type { Provider } from "../adapters/contracts";
import { hasExactKeys, isPlain } from "../adapters/validate";
import type { LedgerStorage } from "./environment";

export const LEDGER_FORMAT = "lizychattidy-run-ledger";

export function ledgerKey(provider: Provider): string {
  return `lizychattidy.run-ledger.${provider}`;
}

export interface Pending {
  readonly barrierId: string;
  readonly count: number;
  readonly firstDispatchedAt: number;
  readonly lastDispatchedAt: number;
}

export interface RunLedger {
  readonly format: typeof LEDGER_FORMAT;
  readonly schemaVersion: 1;
  readonly provider: Provider;
  readonly epoch: number;
  readonly pending: Pending | null;
}

export type LedgerRead =
  | { readonly kind: "ok"; readonly ledger: RunLedger; readonly token: string }
  | { readonly kind: "malformed"; readonly token: string }
  | { readonly kind: "read-failed" };

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parsePending(value: unknown): Pending | null | undefined {
  if (value === null) {
    return null;
  }
  if (!hasExactKeys(value, ["barrierId", "count", "firstDispatchedAt", "lastDispatchedAt"])) {
    return undefined;
  }
  const { barrierId, count, firstDispatchedAt, lastDispatchedAt } = value;
  if (
    typeof barrierId !== "string" ||
    !UUID.test(barrierId) ||
    !isCount(count) ||
    count < 1 ||
    !isCount(firstDispatchedAt) ||
    !isCount(lastDispatchedAt) ||
    lastDispatchedAt < firstDispatchedAt
  ) {
    return undefined;
  }
  return { barrierId, count, firstDispatchedAt, lastDispatchedAt };
}

export function parseLedger(value: unknown, provider: Provider): RunLedger | null {
  if (!hasExactKeys(value, ["format", "schemaVersion", "provider", "epoch", "pending"])) {
    return null;
  }
  const pending = parsePending(value["pending"]);
  const epoch = value["epoch"];
  if (
    value["format"] !== LEDGER_FORMAT ||
    value["schemaVersion"] !== 1 ||
    value["provider"] !== provider ||
    !isCount(epoch) ||
    epoch < 0 ||
    pending === undefined
  ) {
    return null;
  }
  return { format: LEDGER_FORMAT, schemaVersion: 1, provider, epoch, pending };
}

function tokenOf(value: unknown): string {
  try {
    return `raw:${JSON.stringify(value) ?? String(value)}`;
  } catch {
    return "raw:(unserializable)";
  }
}

export async function readLedger(storage: LedgerStorage, provider: Provider): Promise<LedgerRead> {
  const key = ledgerKey(provider);
  let items: Record<string, unknown>;
  try {
    items = await storage.get(key);
  } catch {
    return { kind: "read-failed" };
  }
  if (!isPlain(items) || !Object.hasOwn(items, key) || items[key] === undefined) {
    const ledger: RunLedger = {
      format: LEDGER_FORMAT,
      schemaVersion: 1,
      provider,
      epoch: 0,
      pending: null,
    };
    return { kind: "ok", ledger, token: "absent" };
  }
  const raw = items[key];
  const ledger = parseLedger(raw, provider);
  return ledger === null
    ? { kind: "malformed", token: tokenOf(raw) }
    : { kind: "ok", ledger, token: tokenOf(raw) };
}

export async function writeLedger(storage: LedgerStorage, ledger: RunLedger): Promise<boolean> {
  try {
    await storage.set({ [ledgerKey(ledger.provider)]: ledger });
    return true;
  } catch {
    return false;
  }
}

/** Reads the ledger and writes `change` of it; false when it is not readable or the write fails. */
export async function updateLedger(
  storage: LedgerStorage,
  provider: Provider,
  change: (ledger: RunLedger) => RunLedger,
): Promise<boolean> {
  const read = await readLedger(storage, provider);
  return read.kind === "ok" ? writeLedger(storage, change(read.ledger)) : false;
}

/** Write-ahead before a dispatch: one more pending write. */
export function withOneMorePending(
  ledger: RunLedger,
  now: number,
  newBarrierId: () => string,
): RunLedger {
  const p = ledger.pending;
  const pending: Pending =
    p === null
      ? { barrierId: newBarrierId(), count: 1, firstDispatchedAt: now, lastDispatchedAt: now }
      : { ...p, count: p.count + 1, lastDispatchedAt: Math.max(now, p.lastDispatchedAt) };
  return { ...ledger, pending };
}

/** After a write was verified, or a write-ahead was not followed by a dispatch. */
export function withOneLessPending(ledger: RunLedger): RunLedger {
  const p = ledger.pending;
  if (p === null) {
    return ledger;
  }
  return { ...ledger, pending: p.count <= 1 ? null : { ...p, count: p.count - 1 } };
}
