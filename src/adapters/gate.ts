// Feature gate evaluation (P-0009 item 1; BLUEPRINT §10). Pure.
import type { BuildKind, FeatureGate, GateStatus } from "./contracts";

const STATUSES: ReadonlySet<string> = new Set<GateStatus>([
  "unreviewed",
  "allowed",
  "blocked",
  "ownerAcceptedRisk",
  "notApplicable",
]);

/** The HISTORY entry recording the owner's acceptance of the terms risk. */
export const OWNER_RISK_RECORD = "HISTORY.md#P-0003";

function wellPlaced(gate: FeatureGate): boolean {
  const all = [gate.technical, gate.termsAndPermission, gate.storePolicy, gate.safety];
  if (!all.every((s) => STATUSES.has(s))) {
    return false;
  }
  // Each special value belongs to exactly one judgement (P-0003).
  const misplacedRisk = [gate.technical, gate.storePolicy, gate.safety].includes(
    "ownerAcceptedRisk",
  );
  const misplacedNa = [gate.technical, gate.termsAndPermission, gate.safety].includes(
    "notApplicable",
  );
  return !misplacedRisk && !misplacedNa && Array.isArray(gate.evidenceRefs);
}

/**
 * Distribution builds need all four judgements allowed (INV-15). A personal
 * build also accepts ownerAcceptedRisk (with the recorded decision) for terms
 * and notApplicable for the store policy; technical and safety never relax.
 */
export function capabilityEnabled(gate: FeatureGate, build: BuildKind): boolean {
  if (!wellPlaced(gate)) {
    return false;
  }
  if (gate.technical !== "allowed" || gate.safety !== "allowed") {
    return false;
  }
  if (build === "distribution") {
    return gate.termsAndPermission === "allowed" && gate.storePolicy === "allowed";
  }
  const terms =
    gate.termsAndPermission === "allowed" ||
    (gate.termsAndPermission === "ownerAcceptedRisk" &&
      gate.evidenceRefs.includes(OWNER_RISK_RECORD));
  const store = gate.storePolicy === "allowed" || gate.storePolicy === "notApplicable";
  return terms && store;
}
