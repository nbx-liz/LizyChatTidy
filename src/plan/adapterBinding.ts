// The validated, frozen copies of the adapters' declarations (review 1 #5,
// #6, #7). Every decision reads the copies; every Read or Delete call first
// confirms the live declarations still equal them, so an adapter that changes
// its identity, rule or gate after validation is refused rather than obeyed.
import type {
  BuildKind,
  DeleteAdapter,
  DeleteDescriptor,
  FeatureGate,
  ReadAdapter,
  ReadDescriptor,
} from "../adapters/contracts";
import { validDeleteDescriptor, validReadDescriptor } from "../adapters/descriptor";
import { capabilityEnabled } from "../adapters/gate";
import { canonicalJson } from "./canonical";
import { frozenCopy } from "./freeze";

interface Declared<D> {
  readonly descriptor: D;
  readonly gate: FeatureGate;
  readonly signature: string;
}

function signatureOf(descriptor: unknown, gate: unknown): string | null {
  try {
    return canonicalJson({ descriptor, gate });
  } catch {
    return null; // Not JSON-like: never enabled (DC1: refuse, do not skip).
  }
}

function declare<D>(descriptor: D, gate: FeatureGate): Declared<D> | null {
  const signature = signatureOf(descriptor, gate);
  if (signature === null) {
    return null;
  }
  return Object.freeze({ descriptor: frozenCopy(descriptor), gate: frozenCopy(gate), signature });
}

export class AdapterBinding {
  private readonly readDecl: Declared<ReadDescriptor> | null;
  private readonly delDecl: Declared<DeleteDescriptor> | null;

  constructor(
    private readonly readAdapter: ReadAdapter,
    private readonly delAdapter: DeleteAdapter | null,
    private readonly build: BuildKind,
  ) {
    this.readDecl = declare(readAdapter.descriptor, readAdapter.gate);
    this.delDecl = delAdapter === null ? null : declare(delAdapter.descriptor, delAdapter.gate);
  }

  /** The validated read descriptor copy; null when it could not be copied. */
  get read(): ReadDescriptor | null {
    return this.readDecl?.descriptor ?? null;
  }

  get del(): DeleteDescriptor | null {
    return this.delDecl?.descriptor ?? null;
  }

  readEnabled(): boolean {
    const r = this.readDecl;
    return (
      r !== null &&
      validReadDescriptor(r.descriptor) &&
      capabilityEnabled(r.gate, this.build) &&
      signatureOf(this.readAdapter.descriptor, this.readAdapter.gate) === r.signature
    );
  }

  deleteEnabled(): boolean {
    const d = this.delDecl;
    const r = this.readDecl;
    const a = this.delAdapter;
    return (
      d !== null &&
      r !== null &&
      a !== null &&
      this.readEnabled() &&
      validDeleteDescriptor(d.descriptor, r.descriptor) &&
      capabilityEnabled(d.gate, this.build) &&
      signatureOf(a.descriptor, a.gate) === d.signature
    );
  }

  /** True when `adapter` names the identity of the validated read descriptor. */
  sameIdentity(adapter: { readonly adapterId: string; readonly version: string }): boolean {
    const r = this.readDecl?.descriptor;
    return r !== undefined && r.adapterId === adapter.adapterId && r.version === adapter.version;
  }
}
