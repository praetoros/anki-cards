import { detectFileType } from "./detect.ts";
import { extractDocx } from "./docx.ts";
import { readImageInfo, sniffImageMime } from "./image-header.ts";
import { ImageSet } from "./images.ts";
import { extractMedia } from "./media.ts";
import { extractPdf } from "./pdf.ts";
import { extractPptx } from "./pptx.ts";
import { extractMarkdown, extractText } from "./text.ts";
import type { ExtractionResult, ExtractOptions } from "./types.ts";

function extractImage(bytes: Uint8Array): ExtractionResult {
  const info = readImageInfo(bytes);
  const imageSet = new ImageSet();
  const { image } = imageSet.add({
    key: "image1",
    kind: "embedded",
    mime: info?.mime ?? sniffImageMime(bytes) ?? "application/octet-stream",
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    data: bytes,
    location: {},
    provenance: { source: "file" },
  });
  return {
    fileType: "image",
    pageCount: 1,
    units: [{ unitType: "figure", location: {}, text: "", textBlocks: [], imageKeys: [image.key] }],
    images: imageSet.images,
    limitations: info ? [] : ["image dimensions could not be read from the file header"],
  };
}

/**
 * Extracts text, positions and images from a source file. Pure extraction: nothing is stored
 * and document content is never interpreted as instructions.
 */
export async function extractSource(
  fileName: string,
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const fileType = detectFileType(fileName, bytes);
  switch (fileType) {
    case "pdf":
      return extractPdf(bytes, options);
    case "pptx":
      return extractPptx(bytes, options);
    case "docx":
      return extractDocx(bytes, options);
    case "markdown":
      return extractMarkdown(bytes);
    case "text":
      return extractText(bytes);
    case "image":
      return extractImage(bytes);
    case "video":
    case "audio":
      return extractMedia(fileName, bytes, fileType, options);
    case undefined:
      throw new Error(`unsupported file type: ${fileName}`);
  }
}
