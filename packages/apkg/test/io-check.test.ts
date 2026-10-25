import { unzlibSync } from "fflate";
import { expect, test } from "vite-plus/test";

import { ioCheckInput } from "../scripts/io-check-deck.ts";
import { crc32, encodePng } from "../scripts/png.ts";
import { buildApkg } from "../src/index.ts";
import { checkPackage } from "./support/checks.ts";
import { parseApkg } from "./support/parse.ts";
import { writers } from "./support/writers.ts";

function pngChunks(png: Uint8Array): { type: string; data: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    expect(view.getUint32(offset + 8 + length)).toBe(
      crc32(png.subarray(offset + 4, offset + 8 + length)),
    );
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

test("crc32 matches the standard check value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
});

test("encodePng writes a valid RGBA PNG", () => {
  const png = encodePng(2, 1, Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 128]));
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = pngChunks(png);
  expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  const header = chunks[0]?.data ?? new Uint8Array();
  expect([...header]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  expect([...unzlibSync(chunks[1]?.data ?? new Uint8Array())]).toEqual([
    0, 255, 0, 0, 255, 0, 0, 255, 128,
  ]);
});

test.each(writers)("the IO check deck passes the package checks with $name", async (writer) => {
  const input = ioCheckInput();
  checkPackage(parseApkg(await writer.build(input)), input, [[0, 1], [0]]);
});

test("the IO check deck carries the diagram and two rect occlusions", () => {
  const input = ioCheckInput();
  const pkg = parseApkg(buildApkg(input));
  expect(pkg.media).toEqual({ "0": "anki-cards-io-check.png" });
  expect(pngChunks(pkg.files["0"] ?? new Uint8Array())[0]?.type).toBe("IHDR");
  const occlusion = input.notes[0]?.fields[0] ?? "";
  expect(occlusion.match(/\{\{c\d::image-occlusion:rect:/g)).toHaveLength(2);
});
