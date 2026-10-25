import { unzipSync } from "fflate";
import { sniffImageMime } from "./image-header.ts";
import type { FileType } from "./types.ts";

const EXTENSIONS: Record<string, FileType> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp4: "video",
  m4v: "video",
  mov: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  flac: "audio",
  aac: "audio",
};

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
}

function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return false;
      },
    });
  } catch {
    return names;
  }
  return names;
}

function sniffContainer(bytes: Uint8Array): FileType | undefined {
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    return brand.startsWith("M4A") || brand.startsWith("M4B") ? "audio" : "video";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "video";
  if (ascii(bytes, 0, 4) === "RIFF") {
    const form = ascii(bytes, 8, 12);
    if (form === "WAVE") return "audio";
    if (form === "AVI ") return "video";
  }
  if (ascii(bytes, 0, 3) === "ID3" || ["fLaC", "OggS"].includes(ascii(bytes, 0, 4))) return "audio";
  return undefined;
}

/** Types whose parsers need the right magic bytes, so the extension alone is not enough. */
const NEEDS_SIGNATURE = new Set<FileType>(["pdf", "pptx", "docx", "image"]);

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    // A multi-byte character cut at the sample boundary is not a decoding failure.
    return sample.length === 8192 && bytes.length > 8192;
  }
}

/** Identifies a source file from its leading bytes, falling back to the file extension. */
export function detectFileType(fileName: string, bytes: Uint8Array): FileType | undefined {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const byExtension = fileName.includes(".") ? EXTENSIONS[extension] : undefined;

  // PDF readers accept the header anywhere in the first 1024 bytes.
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return "pdf";
  if (sniffImageMime(bytes)) return "image";
  if (ascii(bytes, 0, 4) === "PK\u0003\u0004") {
    const names = zipEntryNames(bytes);
    if (names.includes("ppt/presentation.xml")) return "pptx";
    if (names.includes("word/document.xml")) return "docx";
    return undefined;
  }
  const container = sniffContainer(bytes);
  if (container)
    return byExtension === "audio" || byExtension === "video" ? byExtension : container;
  if (byExtension && NEEDS_SIGNATURE.has(byExtension)) return undefined;
  if (byExtension) return byExtension;
  return looksLikeText(bytes) ? "text" : undefined;
}
