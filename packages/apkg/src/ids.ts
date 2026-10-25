// Pure TypeScript (no node:crypto) so note types and previews can load in the browser.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64 = (1n << 64n) - 1n;

const BASE91 =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & U64;
  }
  return hash;
}

/** Deterministic Anki-style GUID (base91 of a 64-bit hash, as Anki and genanki write them). */
export function guidFor(stableId: string): string {
  let n = fnv1a64(`guid:${stableId}`);
  let out = "";
  while (n > 0n) {
    out = BASE91[Number(n % 91n)] + out;
    n /= 91n;
  }
  return out || "a";
}

/** Deterministic positive safe integer (> 1) for note type and deck ids. */
export function stableNumericId(key: string): number {
  const id = Number(fnv1a64(`id:${key}`) >> 11n);
  return id > 1 ? id : id + 2;
}
