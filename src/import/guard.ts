import type { FatalCode, ImportLimits } from "./types";

/** Ends an import. `cancelled` maps to status "cancelled", every other code to "failed". */
export class ImportFailure extends Error {
  constructor(
    readonly code: FatalCode | "cancelled",
    readonly entry: string | null = null,
  ) {
    super(code);
    this.name = "ImportFailure";
  }
}

/**
 * Cooperative limits shared by every stage of one import: cancellation, the
 * time budget and the uncompressed-byte budget. JSON.parse cannot be
 * interrupted, so the Worker client also terminates the Worker on timeout or
 * cancel (P-0005 item 7); this guard covers everything between those points.
 */
export class Guard {
  private readonly startedAt: number;
  private uncompressed = 0;

  constructor(
    readonly limits: ImportLimits,
    private readonly signal: AbortSignal,
    private readonly now: () => number,
  ) {
    this.startedAt = now();
  }

  check(): void {
    if (this.signal.aborted) {
      throw new ImportFailure("cancelled");
    }
    if (this.now() - this.startedAt > this.limits.maxMillis) {
      throw new ImportFailure("limit-time");
    }
  }

  /** Remaining uncompressed bytes this import may still inflate. */
  get uncompressedRemaining(): number {
    return this.limits.maxUncompressedBytes - this.uncompressed;
  }

  consumeUncompressed(bytes: number, entry: string): void {
    this.uncompressed += bytes;
    if (this.uncompressed > this.limits.maxUncompressedBytes) {
      throw new ImportFailure("limit-uncompressed", entry);
    }
  }
}
