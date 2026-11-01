import type { ImportLimits } from "./types";

const LIMIT_KEYS = [
  "maxCompressedBytes",
  "maxEntries",
  "maxJsonDepth",
  "maxMillis",
  "maxUncompressedBytes",
].join();

/** Validates the Worker's start message: exact keys, a Blob, positive integer limits. */
export function parseStartMessage(data: unknown): { file: Blob; limits: ImportLimits } | null {
  if (
    typeof data !== "object" ||
    data === null ||
    Object.keys(data).sort().join() !== "file,kind,limits"
  ) {
    return null;
  }
  const { kind, file, limits } = data as Record<string, unknown>;
  if (
    kind !== "start" ||
    !(file instanceof Blob) ||
    typeof limits !== "object" ||
    limits === null
  ) {
    return null;
  }
  const entries = Object.entries(limits);
  const valid =
    entries
      .map(([key]) => key)
      .sort()
      .join() === LIMIT_KEYS &&
    entries.every(
      ([, value]) => typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    );
  return valid ? { file, limits: limits as ImportLimits } : null;
}
