// A reader for a closed subset of the ZIP format (P-0005 item 1). Anything
// outside the subset fails with a code; nothing is skipped silently. Only the
// end of the file, the central directory, every local header and the entries
// being read are loaded, through Blob.slice. Inflation uses the platform's
// DecompressionStream("deflate-raw"), with output bytes counted as they
// arrive: declared sizes are never trusted to bound memory.
//
// Layout rules (each violation fails):
// - exactly one end-of-central-directory record whose comment ends at the end
//   of the file; no ZIP64, no multi-disk;
// - the central directory ends exactly at that record and is fully consumed;
// - the local records tile the bytes before the directory exactly: the first
//   starts at offset 0, and each record (header, name, extra field, data and,
//   with flag bit 3, a 12- or 16-byte data descriptor) ends exactly where the
//   next one, or the directory, starts. No byte is left unaccounted for, so
//   no unlisted record can hide between them;
// - every local header matches the directory: name bytes, flags, method, and
//   CRC and sizes unless flag bit 3 defers them to the descriptor (which is
//   checked when the entry is read).
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
  /** Where the compressed data starts, from the verified local header. */
  readonly dataStart: number;
  /** 0, or 12 / 16 for an unsigned / signed data descriptor after the data. */
  readonly descriptorLength: 0 | 12 | 16;
}

export interface ZipDirectory {
  readonly entries: readonly ZipEntry[];
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
const CHECK_EVERY = 256;

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
  const entries = await verifyRecords(file, parsed, cdOffset, guard);
  return { entries, directoryOffset: cdOffset };
}

type DirectoryEntry = Omit<ZipEntry, "dataStart" | "descriptorLength">;

function rejectDuplicateNames(entries: readonly DirectoryEntry[]): void {
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

function parseCentralDirectory(cd: DataView, total: number): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
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
  entry: DirectoryEntry,
  crc: number,
  compressed: number,
  uncompressed: number,
): void {
  if (compressed === MARKER_32 || uncompressed === MARKER_32) {
    throw new ImportFailure("zip-zip64", entry.name);
  }
  if (
    crc !== entry.crc ||
    compressed !== entry.compressedSize ||
    uncompressed !== entry.uncompressedSize
  ) {
    throw new ImportFailure("zip-local-header-mismatch", entry.name);
  }
}

/**
 * Checks every local record against the directory and requires the records
 * to tile [0, cdOffset) exactly, in offset order.
 */
async function verifyRecords(
  file: Blob,
  parsed: readonly DirectoryEntry[],
  cdOffset: number,
  guard: Guard,
): Promise<ZipEntry[]> {
  const order = [...parsed.keys()].sort(
    (a, b) =>
      (parsed[a] as DirectoryEntry).localHeaderOffset -
      (parsed[b] as DirectoryEntry).localHeaderOffset,
  );
  const verified = new Array<ZipEntry>(parsed.length);
  let expectedStart = 0;
  for (let k = 0; k < order.length; k++) {
    if (k % CHECK_EVERY === 0) {
      guard.check();
    }
    const index = order[k] as number;
    const entry = parsed[index] as DirectoryEntry;
    if (entry.localHeaderOffset !== expectedStart) {
      // Bytes before the first record, between records, or an overlap.
      throw new ImportFailure(
        entry.localHeaderOffset > expectedStart ? "zip-unsupported-layout" : "zip-bad-directory",
        entry.name,
      );
    }
    const next = order[k + 1];
    const limit =
      next === undefined ? cdOffset : (parsed[next] as DirectoryEntry).localHeaderOffset;
    const record = await verifyRecord(file, entry, limit);
    verified[index] = record;
    expectedStart = limit;
  }
  if (order.length === 0 && cdOffset !== 0) {
    throw new ImportFailure("zip-unsupported-layout");
  }
  return verified;
}

/** Verifies one local record that must end exactly at `limit`. */
async function verifyRecord(file: Blob, entry: DirectoryEntry, limit: number): Promise<ZipEntry> {
  const label = entry.name;
  const offset = entry.localHeaderOffset;
  const nameEnd = offset + LOCAL_HEADER_SIZE + entry.nameBytes.length;
  if (nameEnd > limit) {
    throw new ImportFailure("zip-bad-directory", label);
  }
  const header = await slice(file, offset, nameEnd);
  const flags = header.getUint16(6, true);
  const localName = new Uint8Array(header.buffer, LOCAL_HEADER_SIZE, entry.nameBytes.length);
  if (
    header.getUint32(0, true) !== SIG_LOCAL ||
    flags !== entry.flags ||
    header.getUint16(8, true) !== entry.method ||
    header.getUint16(26, true) !== entry.nameBytes.length ||
    !sameBytes(localName, entry.nameBytes)
  ) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
  const crc = header.getUint32(14, true);
  const compressed = header.getUint32(18, true);
  const uncompressed = header.getUint32(22, true);
  const hasDescriptor = (flags & FLAG_DESCRIPTOR) !== 0;
  if (!(hasDescriptor && crc === 0 && compressed === 0 && uncompressed === 0)) {
    checkSizes(entry, crc, compressed, uncompressed);
  }
  const dataStart = nameEnd + header.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > limit) {
    throw new ImportFailure("zip-bad-directory", label);
  }
  const rest = limit - dataEnd;
  if (!hasDescriptor) {
    if (rest !== 0) {
      throw new ImportFailure("zip-unsupported-layout", label);
    }
    return { ...entry, dataStart, descriptorLength: 0 };
  }
  // The layout decides the descriptor form, so an unsigned descriptor whose
  // CRC happens to equal the signature is still read as unsigned.
  if (rest === 12) {
    return { ...entry, dataStart, descriptorLength: 12 };
  }
  if (rest === 16) {
    const signature = await slice(file, dataEnd, dataEnd + 4);
    if (signature.getUint32(0, true) !== SIG_DESCRIPTOR) {
      throw new ImportFailure("zip-unsupported-layout", label);
    }
    return { ...entry, dataStart, descriptorLength: 16 };
  }
  throw new ImportFailure(rest < 12 ? "zip-truncated" : "zip-unsupported-layout", label);
}

async function checkDescriptor(file: Blob, entry: ZipEntry): Promise<void> {
  const at = entry.dataStart + entry.compressedSize;
  const view = await slice(file, at, at + entry.descriptorLength);
  const base = entry.descriptorLength === 16 ? 4 : 0;
  checkSizes(
    entry,
    view.getUint32(base, true),
    view.getUint32(base + 4, true),
    view.getUint32(base + 8, true),
  );
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
  if (entry.descriptorLength > 0) {
    await checkDescriptor(file, entry);
  }
  const raw = file.slice(entry.dataStart, entry.dataStart + entry.compressedSize).stream();
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
