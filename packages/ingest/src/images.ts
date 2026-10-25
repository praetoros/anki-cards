import { createHash } from "node:crypto";
import type { BBox, ExtractedImage, ExtractedUnit, TextBlock } from "./types.ts";

export const MIN_FIGURE_PX = 32;

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Collects images for one result, deduplicating embedded images by content hash. */
export class ImageSet {
  readonly images: ExtractedImage[] = [];
  private readonly bySha = new Map<string, ExtractedImage>();
  private readonly keys = new Set<string>();
  skippedTiny = 0;

  /** Adds an image, or returns the earlier image with the same bytes. */
  add(image: Omit<ExtractedImage, "sha256">): { image: ExtractedImage; isNew: boolean } {
    const hash = sha256(image.data);
    const existing = this.bySha.get(hash);
    if (existing && image.kind === "embedded" && existing.kind === "embedded") {
      return { image: existing, isNew: false };
    }
    if (this.keys.has(image.key)) throw new Error(`duplicate image key ${image.key}`);
    const full: ExtractedImage = { ...image, sha256: hash };
    this.images.push(full);
    this.keys.add(full.key);
    if (!existing) this.bySha.set(hash, full);
    return { image: full, isNew: true };
  }

  limitations(): string[] {
    return this.skippedTiny > 0
      ? [
          `skipped ${this.skippedTiny} embedded image(s) smaller than ${MIN_FIGURE_PX} px (icons, bullets, rules)`,
        ]
      : [];
  }
}

export function isTiny(width: number, height: number): boolean {
  return Math.min(width, height) < MIN_FIGURE_PX;
}

function intersects(a: BBox, b: BBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * Builds a figure unit for an image, with the text blocks that overlap it, sit beside it
 * within its vertical extent (diagram labels) or just above or below it (captions).
 */
export function figureUnit(
  image: ExtractedImage,
  location: ExtractedUnit["location"],
  pageBlocks: TextBlock[],
  size?: ExtractedUnit["size"],
): ExtractedUnit {
  let textBlocks: TextBlock[] = [];
  if (image.bbox) {
    const { x0, y0, x1, y1 } = image.bbox;
    const side = Math.min(144, Math.max(36, 0.5 * (x1 - x0)));
    const region = { x0: x0 - side, y0: y0 - 18, x1: x1 + side, y1: y1 + 18 };
    textBlocks = pageBlocks.filter((block) => intersects(block.bbox, region));
  }
  return {
    unitType: "figure",
    location: { ...location, label: image.key },
    text: textBlocks.map((block) => block.text).join("\n"),
    textBlocks,
    imageKeys: [image.key],
    ...(size ? { size } : {}),
  };
}
