// JSON.parse has no nesting limit, so the decoded text is scanned first
// (P-0005 item 4). The scan only tracks the closed lexical structure that
// decides depth: string boundaries, backslash escapes inside strings, and the
// four bracket characters outside strings. It is not a validator; JSON.parse
// still rejects malformed text afterwards.

/** True when array/object nesting goes deeper than `limit`; stops at the first excess. */
export function jsonDepthExceeds(text: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) {
        i++; // Skip the escaped character, whatever it is.
      } else if (c === 0x22) {
        inString = false;
      }
      continue;
    }
    if (c === 0x22) {
      inString = true;
    } else if (c === 0x5b || c === 0x7b) {
      depth++;
      if (depth > limit) {
        return true;
      }
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }
  }
  return false;
}
