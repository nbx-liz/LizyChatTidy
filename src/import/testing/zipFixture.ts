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
  /** Truncate the stored compressed data to this many bytes. */
  readonly truncateTo?: number;
}

export interface FixtureOptions {
  readonly comment?: string;
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
    const raw = toBytes(entry.data);
    const method = entry.method ?? 8;
    const deflated = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const stored =
      entry.truncateTo === undefined ? deflated : deflated.subarray(0, entry.truncateTo);
    const crc = entry.crc ?? crc32(raw);
    const usize = entry.uncompressedSize ?? raw.length;
    const csize = entry.compressedSize ?? stored.length;
    const flags = entry.flags ?? 0x0800;
    const name = encoder.encode(entry.name);
    const localName = encoder.encode(entry.localName ?? entry.name);
    const offset = w.length;

    w.u32(0x04034b50);
    w.u16(20);
    w.u16(flags);
    w.u16(method);
    w.u16(0);
    w.u16(0x21);
    w.u32(crc);
    w.u32(csize);
    w.u32(usize);
    w.u16(localName.length);
    w.u16(0);
    w.bytes(localName);
    w.bytes(stored);

    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(flags);
    central.u16(method);
    central.u16(0);
    central.u16(0x21);
    central.u32(crc);
    central.u32(csize);
    central.u32(usize);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.bytes(name);
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
  const comment = encoder.encode(options.comment ?? "");
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
