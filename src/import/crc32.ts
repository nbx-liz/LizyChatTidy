// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320) as used by ZIP.

const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Folds `bytes` into a running CRC; start with 0 and pass the previous result. */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = ~crc >>> 0;
  for (const byte of bytes) {
    c = (TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return ~c >>> 0;
}
