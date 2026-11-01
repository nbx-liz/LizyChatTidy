// A reader for a closed subset of the ZIP format (P-0005 item 1). Anything
// outside the subset fails with a code; nothing is skipped silently. Only the
// end of the file, the central directory and the entries being read are
// loaded, through Blob.slice. Inflation uses the platform's
// DecompressionStream("deflate-raw"), with output bytes counted as they
// arrive: declared sizes are never trusted to bound memory.
//
// Layout rules (each violation fails):
// - exactly one end-of-central-directory record whose comment ends at the end
//   of the file; no ZIP64, no multi-disk;
// - the central directory ends exactly at that record and is fully consumed;
// - local records start at offset 0, in increasing order, and no record's
//   minimum extent reaches the next record or the directory;
// - a record that is read must match the directory exactly: name bytes,
//   flags, method, and CRC/sizes (in the local header, or in the data
//   descriptor when flag bit 3 is set), and must end before the next record.
import { crc32Update } from "./crc32";
import { type Guard, ImportFailure } from "./guard";

export interface ZipEntry {
  /** Null when the name is not valid UTF-8 / ASCII; such an entry is never selected. */
  readonly name: string | null;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  /** Where the next record (or the central directory) starts; this one must end before it. */
  readonly recordLimit: number;
}

export interface ZipDirectory {
  readonly entries: readonly ZipEntry[];
  /** Offset of the central directory; every entry's data must end before it. */
  readonly directoryOffset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MARKER_32 = 0xffffffff;
const MARKER_16 = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

async function slice(file: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await file.slice(start, end).arrayBuffer();
  if (buffer.byteLength !== end - start) {
    throw new ImportFailure("zip-truncated");
  }
  return new DataView(buffer);
}

/**
 * The EOCD is a record whose comment ends exactly at the end of the file.
 * Two such records (for example a second directory hidden in the comment)
 * make the archive ambiguous, so it fails rather than picking one.
 */
function findEndRecord(tail: DataView): number | null {
  let found: number | null = null;
  for (let pos = tail.byteLength - EOCD_SIZE; pos >= 0; pos--) {
    if (
      tail.getUint32(pos, true) === SIG_EOCD &&
      pos + EOCD_SIZE + tail.getUint16(pos + 20, true) === tail.byteLength
    ) {
      if (found !== null) {
        throw new ImportFailure("zip-bad-directory");
      }
      found = pos;
    }
  }
  return found;
}

// ignoreBOM keeps a leading U+FEFF in the name, so it never matches a known name.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeName(bytes: Uint8Array, flags: number): string | null {
  if ((flags & FLAG_UTF8) === 0 && bytes.some((b) => b >= 0x80)) {
    return null; // CP437 names are not interpreted.
  }
  try {
    return utf8.decode(bytes);
  } catch {
    return null; // Invalid UTF-8: kept as an unnamed entry, reported by the caller.
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export async function readZipDirectory(file: Blob, guard: Guard): Promise<ZipDirectory> {
  if (file.size > guard.limits.maxCompressedBytes) {
    throw new ImportFailure("limit-compressed");
  }
  if (file.size < EOCD_SIZE) {
    throw new ImportFailure("not-zip");
  }
  const tailStart = Math.max(0, file.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await slice(file, tailStart, file.size);
  const rel = findEndRecord(tail);
  if (rel === null) {
    throw new ImportFailure("not-zip");
  }
  const eocdOffset = tailStart + rel;
  if (rel >= 20 && tail.getUint32(rel - 20, true) === SIG_ZIP64_LOCATOR) {
    throw new ImportFailure("zip-zip64");
  }
  const disk = tail.getUint16(rel + 4, true);
  const cdDisk = tail.getUint16(rel + 6, true);
  const onDisk = tail.getUint16(rel + 8, true);
  const total = tail.getUint16(rel + 10, true);
  const cdSize = tail.getUint32(rel + 12, true);
  const cdOffset = tail.getUint32(rel + 16, true);
  if (total === MARKER_16 || cdSize === MARKER_32 || cdOffset === MARKER_32) {
    throw new ImportFailure("zip-zip64");
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) {
    throw new ImportFailure("zip-multi-disk");
  }
  if (total > guard.limits.maxEntries) {
    throw new ImportFailure("limit-entries");
  }
  if (cdOffset + cdSize !== eocdOffset) {
    throw new ImportFailure("zip-unsupported-layout");
  }
  guard.check();
  const cd = await slice(file, cdOffset, cdOffset + cdSize);
  const parsed = parseCentralDirectory(cd, total);
  rejectDuplicateNames(parsed);
  return { entries: placeRecords(parsed, cdOffset), directoryOffset: cdOffset };
}

type ParsedEntry = Omit<ZipEntry, "recordLimit">;

function rejectDuplicateNames(entries: readonly ParsedEntry[]): void {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.name !== null) {
      if (names.has(entry.name)) {
        throw new ImportFailure("zip-duplicate-entry", entry.name);
      }
      names.add(entry.name);
    }
  }
}

/** Orders records by offset and rejects prefixed data and overlapping minimum extents. */
function placeRecords(entries: readonly ParsedEntry[], cdOffset: number): ZipEntry[] {
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => {
      const ea = entries[a] as ParsedEntry;
      const eb = entries[b] as ParsedEntry;
      return ea.localHeaderOffset - eb.localHeaderOffset;
    });
  const limits = new Array<number>(entries.length);
  let expectedFirst = true;
  for (let k = 0; k < order.length; k++) {
    const entry = entries[order[k] as number] as ParsedEntry;
    const next = order[k + 1];
    const limit = next === undefined ? cdOffset : (entries[next] as ParsedEntry).localHeaderOffset;
    if (expectedFirst && entry.localHeaderOffset !== 0) {
      // Data before the first record (for example a self-extractor stub).
      throw new ImportFailure("zip-unsupported-layout");
    }
    expectedFirst = false;
    const minimumEnd =
      entry.localHeaderOffset + LOCAL_HEADER_SIZE + entry.nameBytes.length + entry.compressedSize;
    if (minimumEnd > limit) {
      throw new ImportFailure("zip-bad-directory", entry.name);
    }
    limits[order[k] as number] = limit;
  }
  return entries.map((entry, i) => ({ ...entry, recordLimit: limits[i] as number }));
}

function parseCentralDirectory(cd: DataView, total: number): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let pos = 0;
  for (let i = 0; i < total; i++) {
    if (pos + CENTRAL_HEADER_SIZE > cd.byteLength || cd.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ImportFailure("zip-bad-directory");
    }
    const flags = cd.getUint16(pos + 8, true);
    const method = cd.getUint16(pos + 10, true);
    const crc = cd.getUint32(pos + 16, true);
    const compressedSize = cd.getUint32(pos + 20, true);
    const uncompressedSize = cd.getUint32(pos + 24, true);
    const nameLength = cd.getUint16(pos + 28, true);
    const extraLength = cd.getUint16(pos + 30, true);
    const commentLength = cd.getUint16(pos + 32, true);
    const diskStart = cd.getUint16(pos + 34, true);
    const localHeaderOffset = cd.getUint32(pos + 42, true);
    const end = pos + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (end > cd.byteLength) {
      throw new ImportFailure("zip-bad-directory");
    }
    if (
      compressedSize === MARKER_32 ||
      uncompressedSize === MARKER_32 ||
      localHeaderOffset === MARKER_32 ||
      diskStart === MARKER_16
    ) {
      throw new ImportFailure("zip-zip64");
    }
    if (diskStart !== 0) {
      throw new ImportFailure("zip-multi-disk");
    }
    const start = cd.byteOffset + pos + CENTRAL_HEADER_SIZE;
    const nameBytes = new Uint8Array(cd.buffer.slice(start, start + nameLength));
    entries.push({
      name: decodeName(nameBytes, flags),
      nameBytes,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    pos = end;
  }
  if (pos !== cd.byteLength) {
    throw new ImportFailure("zip-bad-directory");
  }
  return entries;
}

function checkSizes(
  entry: ZipEntry,
  crc: number,
  compressed: number,
  uncompressed: number,
  label: string | null,
): void {
  if (compressed === MARKER_32 || uncompressed === MARKER_32) {
    throw new ImportFailure("zip-zip64", label);
  }
  if (crc !== entry.crc || compressed !== entry.compressedSize) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
  if (uncompressed !== entry.uncompressedSize) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
}

/** Reads and checks the data descriptor that follows the data when flag bit 3 is set. */
async function checkDescriptor(file: Blob, entry: ZipEntry, dataEnd: number): Promise<void> {
  const label = entry.name;
  if (dataEnd + 12 > entry.recordLimit) {
    throw new ImportFailure("zip-truncated", label);
  }
  const signed = dataEnd + 16 <= entry.recordLimit;
  const view = await slice(file, dataEnd, dataEnd + (signed ? 16 : 12));
  const base = signed && view.getUint32(0, true) === SIG_DESCRIPTOR ? 4 : 0;
  if (base === 0 && view.getUint32(0, true) === SIG_DESCRIPTOR && !signed) {
    throw new ImportFailure("zip-truncated", label);
  }
  checkSizes(
    entry,
    view.getUint32(base, true),
    view.getUint32(base + 4, true),
    view.getUint32(base + 8, true),
    label,
  );
}

/** Locates an entry's compressed bytes after checking its local record against the directory. */
async function dataRange(file: Blob, entry: ZipEntry): Promise<[number, number]> {
  const label = entry.name;
  const offset = entry.localHeaderOffset;
  const nameEnd = offset + LOCAL_HEADER_SIZE + entry.nameBytes.length;
  if (nameEnd > entry.recordLimit) {
    throw new ImportFailure("zip-truncated", label);
  }
  const header = await slice(file, offset, nameEnd);
  const flags = header.getUint16(6, true);
  const nameLength = header.getUint16(26, true);
  const localName = new Uint8Array(header.buffer, LOCAL_HEADER_SIZE, entry.nameBytes.length);
  if (
    header.getUint32(0, true) !== SIG_LOCAL ||
    flags !== entry.flags ||
    header.getUint16(8, true) !== entry.method ||
    nameLength !== entry.nameBytes.length ||
    !sameBytes(localName, entry.nameBytes)
  ) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
  const crc = header.getUint32(14, true);
  const compressed = header.getUint32(18, true);
  const uncompressed = header.getUint32(22, true);
  const deferred =
    (flags & FLAG_DESCRIPTOR) !== 0 && crc === 0 && compressed === 0 && uncompressed === 0;
  if (!deferred) {
    checkSizes(entry, crc, compressed, uncompressed, label);
  }
  const start = nameEnd + header.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > entry.recordLimit) {
    throw new ImportFailure("zip-truncated", label);
  }
  if ((flags & FLAG_DESCRIPTOR) !== 0) {
    await checkDescriptor(file, entry, end);
  }
  return [start, end];
}

/**
 * Reads and verifies one entry. The output is capped by both the declared
 * size and the guard's remaining budget; exceeding either stops inflation.
 */
export async function readEntry(file: Blob, entry: ZipEntry, guard: Guard): Promise<Uint8Array> {
  const label = entry.name;
  if ((entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
    throw new ImportFailure("zip-encrypted", label);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ImportFailure("zip-unsupported-method", label);
  }
  if (entry.uncompressedSize > guard.uncompressedRemaining) {
    throw new ImportFailure("limit-uncompressed", label);
  }
  if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) {
    throw new ImportFailure("zip-size-mismatch", label);
  }
  guard.check();
  const [start, end] = await dataRange(file, entry);
  const raw = file.slice(start, end).stream();
  const stream = entry.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : raw;
  const out = await collect(stream, entry, guard);
  if (out.length !== entry.uncompressedSize) {
    throw new ImportFailure("zip-size-mismatch", label);
  }
  if (crc32Update(0, out) !== entry.crc) {
    throw new ImportFailure("zip-crc-mismatch", label);
  }
  return out;
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  entry: ZipEntry,
  guard: Guard,
): Promise<Uint8Array> {
  const label = entry.name ?? "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      guard.check();
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        throw new ImportFailure("zip-inflate-error", entry.name);
      }
      if (next.done) {
        break;
      }
      length += next.value.length;
      // Check the budget before the declared size, so a bomb that lies about
      // its size is reported as the limit it hit.
      guard.consumeUncompressed(next.value.length, label);
      if (length > entry.uncompressedSize) {
        throw new ImportFailure("zip-size-mismatch", entry.name);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    // Release the stream; the original failure is what the caller reports.
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
