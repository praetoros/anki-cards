import { describe, expect, it } from "vite-plus/test";

import { readImageInfo } from "../src/image-header.ts";
import { webSafeMedia } from "../src/ooxml.ts";

/** A 2×2 uncompressed RGB baseline TIFF. */
function tinyTiff(): Uint8Array {
  const entries: [number, number, number, number][] = [
    [256, 3, 1, 2], // width
    [257, 3, 1, 2], // height
    [258, 3, 3, 0], // bits per sample, value at BITS
    [259, 3, 1, 1], // no compression
    [262, 3, 1, 2], // RGB
    [273, 4, 1, 0], // strip offset, value at DATA
    [277, 3, 1, 3], // samples per pixel
    [278, 3, 1, 2], // rows per strip
    [279, 4, 1, 12], // strip byte count
  ];
  const ifd = 8;
  const bits = ifd + 2 + entries.length * 12 + 4;
  const data = bits + 6;
  const bytes = new Uint8Array(data + 12);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00]);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    const resolved = tag === 258 ? bits : tag === 273 ? data : value;
    if (type === 3 && count === 1) view.setUint16(at + 8, resolved, true);
    else view.setUint32(at + 8, resolved, true);
  });
  [8, 8, 8].forEach((b, i) => view.setUint16(bits + i * 2, b, true));
  bytes.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255], data);
  return bytes;
}

describe("webSafeMedia", () => {
  it("converts TIFF to PNG", () => {
    const result = webSafeMedia("ppt/media/image1.tiff", tinyTiff());
    expect(result.convertedFrom).toBe("image/tiff");
    expect(result.mime).toBe("image/png");
    expect(readImageInfo(result.data)).toMatchObject({ mime: "image/png", width: 2, height: 2 });
  });

  it("keeps web formats unchanged", () => {
    const png = webSafeMedia("x.png", webSafeMedia("x.tiff", tinyTiff()).data);
    expect(png.convertedFrom).toBeNull();
  });
});
