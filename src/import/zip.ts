// A reader for a closed subset of the ZIP format (P-0005 item 1). Anything
// outside the subset fails with a code; nothing is skipped silently. Only the
// end of the file, the central directory and the entries being read are
// loaded, through Blob.slice. Inflation uses the platform's
// DecompressionStream("deflate-raw"), with output bytes counted as they
// arrive: declared sizes are never trusted to bound memory.
import { crc32Update } from "./crc32";
import { type Guard, ImportFailure } from "./guard";

export interface ZipEntry {
  /** Null when the name is not valid UTF-8 / ASCII; such an entry is never selected. */
  readonly name: string | null;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
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
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

async function slice(file: Blob, start: number, end: number): Promise<DataView> {
  const buffer = await file.slice(start, end).arrayBuffer();
  if (buffer.byteLength !== end - start) {
    throw new ImportFailure("zip-truncated");
  }
  return new DataView(buffer);
}

function findEndRecord(tail: DataView): number | null {
  // The EOCD is accepted only where its comment length ends exactly at the end
  // of the file, so a signature inside the comment cannot be mistaken for it.
  for (let pos = tail.byteLength - EOCD_SIZE; pos >= 0; pos--) {
    if (
      tail.getUint32(pos, true) === SIG_EOCD &&
      pos + EOCD_SIZE + tail.getUint16(pos + 20, true) === tail.byteLength
    ) {
      return pos;
    }
  }
  return null;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

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
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
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
  const entries = parseCentralDirectory(cd, total);
  const names = new Set<string>();
  let firstOffset = cdOffset;
  for (const entry of entries) {
    if (entry.name !== null) {
      if (names.has(entry.name)) {
        throw new ImportFailure("zip-duplicate-entry", entry.name);
      }
      names.add(entry.name);
    }
    if (entry.localHeaderOffset >= cdOffset) {
      throw new ImportFailure("zip-bad-directory", entry.name);
    }
    firstOffset = Math.min(firstOffset, entry.localHeaderOffset);
  }
  if (firstOffset !== 0) {
    // Data before the first entry (for example a self-extractor stub).
    throw new ImportFailure("zip-unsupported-layout");
  }
  return { entries, directoryOffset: cdOffset };
}

function parseCentralDirectory(cd: DataView, total: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
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
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new ImportFailure("zip-zip64");
    }
    if (diskStart !== 0) {
      throw new ImportFailure("zip-multi-disk");
    }
    const nameBytes = new Uint8Array(
      cd.buffer,
      cd.byteOffset + pos + CENTRAL_HEADER_SIZE,
      nameLength,
    );
    entries.push({
      name: decodeName(nameBytes, flags),
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

/** Locates an entry's compressed bytes after checking its local header. */
async function dataRange(
  file: Blob,
  dir: ZipDirectory,
  entry: ZipEntry,
): Promise<[number, number]> {
  const label = entry.name;
  const offset = entry.localHeaderOffset;
  if (offset + LOCAL_HEADER_SIZE > dir.directoryOffset) {
    throw new ImportFailure("zip-truncated", label);
  }
  const header = await slice(file, offset, offset + LOCAL_HEADER_SIZE);
  if (header.getUint32(0, true) !== SIG_LOCAL) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
  const method = header.getUint16(8, true);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const nameStart = offset + LOCAL_HEADER_SIZE;
  if (nameStart + nameLength > dir.directoryOffset) {
    throw new ImportFailure("zip-truncated", label);
  }
  const nameView = await slice(file, nameStart, nameStart + nameLength);
  const localName = decodeName(
    new Uint8Array(nameView.buffer),
    header.getUint16(6, true) | (entry.flags & FLAG_UTF8),
  );
  if (method !== entry.method || localName !== entry.name) {
    throw new ImportFailure("zip-local-header-mismatch", label);
  }
  const start = nameStart + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > dir.directoryOffset) {
    throw new ImportFailure("zip-truncated", label);
  }
  return [start, end];
}

/**
 * Reads and verifies one entry. The output is capped by both the declared
 * size and the guard's remaining budget; exceeding either stops inflation.
 */
export async function readEntry(
  file: Blob,
  dir: ZipDirectory,
  entry: ZipEntry,
  guard: Guard,
): Promise<Uint8Array> {
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
  const [start, end] = await dataRange(file, dir, entry);
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
