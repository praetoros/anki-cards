export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

export function sniffImageMime(bytes: Uint8Array): ImageInfo["mime"] | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return undefined;
}

/** Reads dimensions from the file header of a PNG, JPEG, GIF or WebP. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | undefined {
  const mime = sniffImageMime(bytes);
  if (!mime) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = (() => {
    switch (mime) {
      case "image/png":
        return bytes.length >= 24 && ascii(bytes, 12, 16) === "IHDR"
          ? { width: view.getUint32(16), height: view.getUint32(20) }
          : undefined;
      case "image/gif":
        return bytes.length >= 10
          ? { width: view.getUint16(6, true), height: view.getUint16(8, true) }
          : undefined;
      case "image/jpeg":
        return jpegSize(bytes, view);
      case "image/webp":
        return webpSize(bytes, view);
    }
  })();
  return size ? { mime, ...size } : undefined;
}

function jpegSize(bytes: Uint8Array, view: DataView) {
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) return undefined;
    const marker = bytes[pos + 1] ?? 0;
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const length = view.getUint16(pos + 2);
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && pos + 9 <= bytes.length) {
      return { height: view.getUint16(pos + 5), width: view.getUint16(pos + 7) };
    }
    pos += 2 + length;
  }
  return undefined;
}

function webpSize(bytes: Uint8Array, view: DataView) {
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (bytes.length < 30) return undefined;
  if (chunk === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === "VP8X") {
    const u24 = (at: number) =>
      (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  return undefined;
}
