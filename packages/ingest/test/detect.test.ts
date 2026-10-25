import { describe, expect, it } from "vite-plus/test";
import { chambersDiagramJpeg, generateLecturePdf } from "../../../tests/fixtures/lecture-pdf.ts";
import { generateLectureDocx } from "../../../tests/fixtures/lecture-docx.ts";
import { generateLecturePptx } from "../../../tests/fixtures/lecture-pptx.ts";
import { mupdf } from "./fixture-deps.ts";
import { detectFileType, extractSource, readImageInfo } from "../src/index.ts";

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function png(width: number, height: number): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  const bytes = pixmap.asPNG().slice();
  pixmap.destroy();
  return bytes;
}

const gif = new Uint8Array([...ascii("GIF89a"), 0x2c, 0x01, 0x96, 0x00, 0, 0, 0]);

function webp(chunk: string, payload: number[]): Uint8Array {
  const body = [...ascii("WEBP"), ...ascii(chunk), payload.length, 0, 0, 0, ...payload];
  return new Uint8Array([...ascii("RIFF"), body.length, 0, 0, 0, ...body]);
}

describe("readImageInfo", () => {
  it("reads PNG, JPEG and GIF dimensions from the header", () => {
    expect(readImageInfo(png(37, 21))).toEqual({ mime: "image/png", width: 37, height: 21 });
    expect(readImageInfo(chambersDiagramJpeg())).toEqual({
      mime: "image/jpeg",
      width: 240,
      height: 180,
    });
    expect(readImageInfo(gif)).toEqual({ mime: "image/gif", width: 300, height: 150 });
  });

  it("reads lossy, lossless and extended WebP dimensions", () => {
    const lossy = webp("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xc8, 0x00]);
    expect(readImageInfo(lossy)).toEqual({ mime: "image/webp", width: 320, height: 200 });
    // 14-bit width-1 and height-1 packed little-endian after the 0x2f signature.
    const bits = (100 - 1) | ((50 - 1) << 14);
    const lossless = webp("VP8L", [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      bits >>> 24,
    ]);
    expect(readImageInfo(lossless)).toEqual({ mime: "image/webp", width: 100, height: 50 });
    const extended = webp("VP8X", [0, 0, 0, 0, 0xff, 0x03, 0x00, 0x1f, 0x03, 0x00]);
    expect(readImageInfo(extended)).toEqual({ mime: "image/webp", width: 1024, height: 800 });
  });

  it("returns undefined for non-images and truncated headers", () => {
    expect(readImageInfo(new TextEncoder().encode("hello"))).toBeUndefined();
    expect(readImageInfo(png(10, 10).subarray(0, 12))).toBeUndefined();
  });
});

describe("detectFileType", () => {
  it("detects by content before extension", () => {
    expect(detectFileType("lecture.bin", generateLecturePdf())).toBe("pdf");
    expect(detectFileType("deck.zip", generateLecturePptx())).toBe("pptx");
    expect(detectFileType("handout", generateLectureDocx())).toBe("docx");
    expect(detectFileType("photo.dat", chambersDiagramJpeg())).toBe("image");
    expect(detectFileType("anim.gif", gif)).toBe("image");
  });

  it("detects media containers", () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, ...ascii("ftypisom"), 0, 0, 2, 0]);
    const m4a = new Uint8Array([0, 0, 0, 24, ...ascii("ftypM4A "), 0, 0, 2, 0]);
    const wav = new Uint8Array([...ascii("RIFF"), 36, 0, 0, 0, ...ascii("WAVEfmt ")]);
    expect(detectFileType("clip", mp4)).toBe("video");
    expect(detectFileType("clip", m4a)).toBe("audio");
    expect(detectFileType("clip", wav)).toBe("audio");
    expect(detectFileType("talk.mp3", new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe("audio");
  });

  it("falls back to extension and then to text sniffing", () => {
    const text = new TextEncoder().encode("# Heading\nBody");
    expect(detectFileType("notes.md", text)).toBe("markdown");
    expect(detectFileType("notes.markdown", text)).toBe("markdown");
    expect(detectFileType("notes.txt", text)).toBe("text");
    expect(detectFileType("README", text)).toBe("text");
  });

  it("rejects binary files it cannot read and misnamed documents", () => {
    expect(detectFileType("blob", new Uint8Array([0, 1, 2, 3, 0]))).toBeUndefined();
    expect(detectFileType("fake.pdf", new TextEncoder().encode("not a pdf"))).toBeUndefined();
    expect(
      detectFileType("archive.zip", new Uint8Array([...ascii("PK"), 3, 4, 0, 0])),
    ).toBeUndefined();
  });
});

describe("image files", () => {
  it("become one figure unit holding the original bytes", async () => {
    const bytes = png(64, 48);
    const result = await extractSource("chart.png", bytes);
    expect(result.fileType).toBe("image");
    expect(result.pageCount).toBe(1);
    expect(result.units).toEqual([
      { unitType: "figure", location: {}, text: "", textBlocks: [], imageKeys: ["image1"] },
    ]);
    expect(result.images[0]).toMatchObject({
      key: "image1",
      kind: "embedded",
      mime: "image/png",
      width: 64,
      height: 48,
    });
    expect(result.images[0]?.data).toBe(bytes);
  });

  it("rejects unsupported files", async () => {
    await expect(extractSource("blob", new Uint8Array([0, 1, 2]))).rejects.toThrow(
      "unsupported file type",
    );
  });
});
