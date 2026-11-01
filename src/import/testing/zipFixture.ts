// Test-only builder for synthetic ZIP files (never imported by shipped code).
// It uses node:zlib as an oracle independent of the shipped reader: deflate
// comes from zlib.deflateRawSync and CRC-32 from zlib.crc32.
import { crc32, deflateRawSync } from "node:zlib";

export interface FixtureEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  readonly method?: 0 | 8 | number;
  readonly flags?: number;
  /** Override fields written to the central directory (and local header). */
  readonly crc?: number;
  readonly uncompressedSize?: number;
  readonly compressedSize?: number;
  /** Write a different name into the local header than into the directory. */
  readonly localName?: string;
  /** Override local-header fields only. */
  readonly localFlags?: number;
  readonly localCrc?: number;
  readonly localCompressedSize?: number;
  readonly localUncompressedSize?: number;
  /** Write a data descriptor after the data (sets flag bit 3, zeroes local CRC/sizes). */
  readonly descriptor?: "signed" | "unsigned";
  /** Truncate the stored compressed data to this many bytes. */
  readonly truncateTo?: number;
  /** Point the directory at another offset than where the record was written. */
  readonly directoryOffset?: number;
}

export interface FixtureOptions {
  readonly comment?: string | Uint8Array;
  readonly prefix?: Uint8Array;
  readonly diskNumber?: number;
  readonly totalEntriesOverride?: number;
  readonly zip64Locator?: boolean;
}

const encoder = new TextEncoder();

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

class Writer {
  private readonly chunks: Uint8Array[] = [];
  length = 0;

  u16(value: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value, true);
    this.bytes(b);
  }

  u32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value >>> 0, true);
    this.bytes(b);
  }

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

interface Prepared {
  readonly entry: FixtureEntry;
  readonly stored: Uint8Array;
  readonly crc: number;
  readonly usize: number;
  readonly csize: number;
  readonly flags: number;
  readonly method: number;
}

function prepare(entry: FixtureEntry): Prepared {
  const raw = toBytes(entry.data);
  const method = entry.method ?? 8;
  const deflated = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
  const stored = entry.truncateTo === undefined ? deflated : deflated.subarray(0, entry.truncateTo);
  const base = entry.flags ?? 0x0800;
  return {
    entry,
    stored,
    crc: entry.crc ?? crc32(raw),
    usize: entry.uncompressedSize ?? raw.length,
    csize: entry.compressedSize ?? stored.length,
    flags: entry.descriptor === undefined ? base : base | 0x0008,
    method,
  };
}

function writeLocal(w: Writer, p: Prepared): void {
  const { entry } = p;
  const zeroed = entry.descriptor !== undefined;
  const localName = encoder.encode(entry.localName ?? entry.name);
  w.u32(0x04034b50);
  w.u16(20);
  w.u16(entry.localFlags ?? p.flags);
  w.u16(p.method);
  w.u16(0);
  w.u16(0x21);
  w.u32(entry.localCrc ?? (zeroed ? 0 : p.crc));
  w.u32(entry.localCompressedSize ?? (zeroed ? 0 : p.csize));
  w.u32(entry.localUncompressedSize ?? (zeroed ? 0 : p.usize));
  w.u16(localName.length);
  w.u16(0);
  w.bytes(localName);
  w.bytes(p.stored);
  if (entry.descriptor === "signed") {
    w.u32(0x08074b50);
  }
  if (zeroed) {
    w.u32(p.crc);
    w.u32(p.csize);
    w.u32(p.usize);
  }
}

function writeCentral(central: Writer, p: Prepared, offset: number): void {
  const name = encoder.encode(p.entry.name);
  central.u32(0x02014b50);
  central.u16(20);
  central.u16(20);
  central.u16(p.flags);
  central.u16(p.method);
  central.u16(0);
  central.u16(0x21);
  central.u32(p.crc);
  central.u32(p.csize);
  central.u32(p.usize);
  central.u16(name.length);
  central.u16(0);
  central.u16(0);
  central.u16(0);
  central.u16(0);
  central.u32(0);
  central.u32(p.entry.directoryOffset ?? offset);
  central.bytes(name);
}

/** Central directory plus EOCD for `entries`, as `buildZip` writes them. */
export function buildZip(
  entries: readonly FixtureEntry[],
  options: FixtureOptions = {},
): Uint8Array {
  const w = new Writer();
  if (options.prefix !== undefined) {
    w.bytes(options.prefix);
  }
  const central = new Writer();
  for (const entry of entries) {
    const p = prepare(entry);
    const offset = w.length;
    writeLocal(w, p);
    writeCentral(central, p, offset);
  }
  const cdOffset = w.length;
  const cd = central.concat();
  w.bytes(cd);
  if (options.zip64Locator === true) {
    w.u32(0x07064b50);
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.u32(1);
  }
  const comment =
    options.comment instanceof Uint8Array ? options.comment : encoder.encode(options.comment ?? "");
  const total = options.totalEntriesOverride ?? entries.length;
  w.u32(0x06054b50);
  w.u16(options.diskNumber ?? 0);
  w.u16(0);
  w.u16(total);
  w.u16(total);
  w.u32(cd.length);
  w.u32(cdOffset);
  w.u16(comment.length);
  w.bytes(comment);
  return w.concat();
}

/** A Blob view of the bytes (copies, so callers may keep mutating their array). */
export function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice()]);
}
