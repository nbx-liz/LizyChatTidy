// Descriptor validation (P-0009 item 1). Read and Delete are judged
// independently: a faulty or missing delete descriptor never blocks reads.
import type { DeleteDescriptor, ReadDescriptor } from "./contracts";
import { isToken } from "./validate";

/** Framework floor for request spacing; the real value comes from DEV03. */
export const MIN_INTERVAL_FLOOR_MS = 1_000;
export const MIN_INTERVAL_CEILING_MS = 60_000;

export function validReadDescriptor(d: ReadDescriptor): boolean {
  const interval =
    Number.isSafeInteger(d.minIntervalMs) &&
    d.minIntervalMs >= MIN_INTERVAL_FLOOR_MS &&
    d.minIntervalMs <= MIN_INTERVAL_CEILING_MS;
  const kinds =
    d.listedKinds.length > 0 && d.listedKinds.every(isToken) && d.excludedKinds.every(isToken);
  const listing =
    !d.listing.stableSnapshot || (d.listing.evidenceRef !== null && isToken(d.listing.evidenceRef));
  return interval && kinds && listing && isToken(d.adapterId) && isToken(d.version);
}

/**
 * Delete needs a verified update detector inside the fingerprint, verified
 * time semantics for any timestamp used, and a verification rule that holds
 * a positive deletion marker plus at least one other kind of evidence.
 */
export function validDeleteDescriptor(d: DeleteDescriptor, read: ReadDescriptor): boolean {
  if (d.adapterId !== read.adapterId || d.version !== read.version) {
    return false;
  }
  const fields = new Set(d.fingerprintFields);
  if (fields.size !== d.fingerprintFields.length) {
    return false;
  }
  const detector = fields.has(d.updateDetector.field) && isToken(d.updateDetector.evidenceRef);
  const time = !fields.has("updatedAt") || read.timeFields.updatedAt;
  const rule = new Set(d.verificationRule);
  const evidence =
    rule.size === d.verificationRule.length &&
    rule.size >= 2 &&
    rule.has("item-deleted-marker") &&
    isToken(d.verificationEvidenceRef);
  return detector && time && evidence;
}
