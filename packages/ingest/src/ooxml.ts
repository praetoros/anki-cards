import { unzipSync } from "fflate";
import * as mupdf from "mupdf";
import { posix } from "node:path";
import { readImageInfo } from "./image-header.ts";
import { children, parseXml, type XmlElement } from "./xml.ts";

export interface Relationship {
  type: string;
  /** Absolute part path inside the package, e.g. "ppt/media/image1.png". */
  target: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  emf: "image/emf",
  wmf: "image/wmf",
};

/** An unzipped OOXML package (PPTX, DOCX). */
export class OoxmlPackage {
  private readonly files: Record<string, Uint8Array>;

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
  }

  get(path: string): Uint8Array | undefined {
    return this.files[path];
  }

  paths(): string[] {
    return Object.keys(this.files);
  }

  xml(path: string): XmlElement | undefined {
    const data = this.files[path];
    return data ? parseXml(data) : undefined;
  }

  /** Relationships of a part, keyed by relationship id. Targets are resolved to part paths. */
  rels(partPath: string): Map<string, Relationship> {
    const dir = posix.dirname(partPath);
    const relsPath = posix.join(dir, "_rels", `${posix.basename(partPath)}.rels`);
    const root = this.xml(relsPath);
    const map = new Map<string, Relationship>();
    for (const rel of children(root, "Relationship")) {
      const { Id: id, Type: type, Target: target, TargetMode: mode } = rel.attrs;
      if (!id || !type || !target || mode === "External") continue;
      const resolved = target.startsWith("/")
        ? target.slice(1)
        : posix.normalize(posix.join(dir, target));
      map.set(id, { type, target: resolved });
    }
    return map;
  }

  /** The first relationship whose type ends with `/<kind>`, e.g. "slideLayout". */
  relOfKind(partPath: string, kind: string): Relationship | undefined {
    for (const rel of this.rels(partPath).values()) {
      if (rel.type.endsWith(`/${kind}`)) return rel;
    }
    return undefined;
  }
}

export function mediaInfo(path: string, data: Uint8Array) {
  const info = readImageInfo(data);
  const extension = posix.extname(path).slice(1).toLowerCase();
  return {
    mime: info?.mime ?? MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    width: info?.width ?? 0,
    height: info?.height ?? 0,
    hasSize: info !== undefined,
  };
}

/** Formats browsers and models can't show; mupdf can decode them. */
const CONVERT_TO_PNG = new Set(["image/tiff", "image/bmp"]);

/**
 * Media bytes ready to store: TIFF and BMP become lossless PNG so they can be viewed in the app,
 * by the AI and in Anki. Returns the original unchanged when it is already web-safe or can't
 * be decoded.
 */
export function webSafeMedia(path: string, data: Uint8Array) {
  const info = mediaInfo(path, data);
  if (!CONVERT_TO_PNG.has(info.mime)) return { ...info, data, convertedFrom: null };
  let image: mupdf.Image | undefined;
  let pixmap: mupdf.Pixmap | undefined;
  try {
    image = new mupdf.Image(data);
    pixmap = image.toPixmap();
    const colorspace = pixmap.getColorSpace();
    if (colorspace && !colorspace.isGray() && !colorspace.isRGB()) {
      const converted = pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
      pixmap.destroy();
      pixmap = converted;
    }
    return {
      mime: "image/png",
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
      hasSize: true,
      data: pixmap.asPNG().slice(),
      convertedFrom: info.mime,
    };
  } catch {
    return { ...info, data, convertedFrom: null };
  } finally {
    pixmap?.destroy();
    image?.destroy();
  }
}
