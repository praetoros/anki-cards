import { unzipSync } from "fflate";
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
