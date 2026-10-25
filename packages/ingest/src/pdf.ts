import * as mupdf from "mupdf";
import { figureUnit, ImageSet, isTiny } from "./images.ts";
import type { BBox, ExtractedUnit, ExtractionResult, FileType, TextBlock } from "./types.ts";

export const DEFAULT_RENDER_DPI = 150;

interface XrefImage {
  xref: number;
  object: mupdf.PDFObject;
}

interface ImageBlock {
  bbox: BBox;
  image: mupdf.Image;
}

interface EncodedImage {
  data: Uint8Array;
  mime: string;
  provenance: Record<string, string | number>;
}

function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pdf = doc.asPDF();
  if (!pdf) throw new Error("not a PDF document");
  return pdf;
}

function renderPage(page: mupdf.Page, dpi: number) {
  const scale = dpi / 72;
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false,
    true,
  );
  try {
    return { data: pixmap.asPNG().slice(), width: pixmap.getWidth(), height: pixmap.getHeight() };
  } finally {
    pixmap.destroy();
  }
}

/** Renders every page of a PDF to PNG. */
export function renderPdfPages(bytes: Uint8Array, dpi = DEFAULT_RENDER_DPI) {
  const doc = openPdf(bytes);
  try {
    const renders = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      try {
        renders.push(renderPage(page, dpi));
      } finally {
        page.destroy();
      }
    }
    return renders;
  } finally {
    doc.destroy();
  }
}

function filterNames(object: mupdf.PDFObject): string[] {
  const filter = object.get("Filter");
  if (filter.isName()) return [filter.asName()];
  if (filter.isArray()) {
    const names: string[] = [];
    filter.forEach((value) => {
      if (value.isName()) names.push(value.asName());
    });
    return names;
  }
  return [];
}

/**
 * Loads every image XObject reachable from the page resources, keyed by the fz_image
 * pointer. mupdf caches loaded images per object, so the pointer matches the image that
 * structured text reports for the same XObject.
 */
function collectXrefImages(doc: mupdf.PDFDocument, page: mupdf.PDFPage): Map<number, XrefImage> {
  const found = new Map<number, XrefImage>();
  const seen = new Set<number>();
  const visit = (resources: mupdf.PDFObject) => {
    const xobjects = resources.get("XObject");
    if (!xobjects.isDictionary()) return;
    xobjects.forEach((ref) => {
      if (!ref.isIndirect()) return;
      const xref = ref.asIndirect();
      if (seen.has(xref)) return;
      seen.add(xref);
      const subtype = ref.get("Subtype");
      if (!subtype.isName()) return;
      if (subtype.asName() === "Image") {
        const image = doc.loadImage(ref);
        found.set(Number(image.pointer), { xref, object: ref });
        // Drops only this reference; the structured text page keeps its own.
        image.destroy();
      } else if (subtype.asName() === "Form") {
        visit(ref.get("Resources"));
      }
    });
  };
  visit(page.getObject().getInheritable("Resources"));
  return found;
}

function encodeImage(image: mupdf.Image, source: XrefImage | undefined): EncodedImage {
  const provenance: Record<string, string | number> = source
    ? { xref: source.xref }
    : { xref: "inline" };
  if (source) {
    const filters = filterNames(source.object);
    const original =
      filters.length === 1
        ? ({ DCTDecode: "image/jpeg", JPXDecode: "image/jp2" } as Record<string, string>)[
            filters[0] ?? ""
          ]
        : undefined;
    if (filters.length > 0) provenance.filter = filters.join(" ");
    const smask = source.object.get("SMask");
    if (smask.isIndirect()) provenance.smaskXref = smask.asIndirect();
    if (original) {
      const raw = source.object.readRawStream();
      try {
        return {
          data: raw.asUint8Array().slice(),
          mime: original,
          provenance: { ...provenance, encoding: "original" },
        };
      } finally {
        raw.destroy();
      }
    }
  }
  let pixmap = image.toPixmap();
  const colorspace = pixmap.getColorSpace();
  if (colorspace && !colorspace.isGray() && !colorspace.isRGB()) {
    const converted = pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true);
    pixmap.destroy();
    pixmap = converted;
  }
  try {
    return {
      data: pixmap.asPNG().slice(),
      mime: "image/png",
      provenance: { ...provenance, encoding: "png-lossless" },
    };
  } finally {
    pixmap.destroy();
  }
}

function toBBox(rect: mupdf.Rect, origin: mupdf.Rect): BBox {
  return {
    x0: rect[0] - origin[0],
    y0: rect[1] - origin[1],
    x1: rect[2] - origin[0],
    y1: rect[3] - origin[1],
  };
}

function readStructuredText(page: mupdf.Page, bounds: mupdf.Rect) {
  const stext = page.toStructuredText("preserve-images");
  const lines: TextBlock[] = [];
  const imageBlocks: ImageBlock[] = [];
  let line: { bbox: mupdf.Rect; text: string } | undefined;
  stext.walk({
    beginLine(bbox) {
      line = { bbox, text: "" };
    },
    onChar(c) {
      if (line) line.text += c;
    },
    endLine() {
      const text = line?.text.trim();
      if (line && text) lines.push({ text, bbox: toBBox(line.bbox, bounds) });
      line = undefined;
    },
    onImageBlock(bbox, _transform, image) {
      imageBlocks.push({ bbox: toBBox(bbox, bounds), image });
    },
  });
  return { stext, text: stext.asText().trim(), lines, imageBlocks };
}

/** Extracts page text with line positions, page renders and embedded images from a PDF. */
export function extractPdf(
  bytes: Uint8Array,
  options: { renderDpi?: number } = {},
  fileType: FileType = "pdf",
): ExtractionResult {
  const dpi = options.renderDpi ?? DEFAULT_RENDER_DPI;
  const doc = openPdf(bytes);
  try {
    const pageCount = doc.countPages();
    if (doc.needsPassword()) {
      return {
        fileType,
        pageCount,
        units: [],
        images: [],
        limitations: ["PDF is password-protected; nothing extracted"],
      };
    }
    const imageSet = new ImageSet();
    const units: ExtractedUnit[] = [];
    const encoded = new Map<number, EncodedImage>();
    for (let i = 0; i < pageCount; i++) {
      const pageNumber = i + 1;
      const page = doc.loadPage(i);
      try {
        const bounds = page.getBounds();
        const size = { width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] };
        const render = renderPage(page, dpi);
        const renderImage = imageSet.add({
          key: `p${pageNumber}-render`,
          kind: "render",
          mime: "image/png",
          ...render,
          location: { page: pageNumber },
          bbox: { x0: 0, y0: 0, x1: size.width, y1: size.height },
          provenance: { dpi },
        }).image;

        const { stext, text, lines, imageBlocks } = readStructuredText(page, bounds);
        const xrefImages = collectXrefImages(doc, page);
        const imageKeys = [renderImage.key];
        const figures: ExtractedUnit[] = [];
        let imageIndex = 0;
        for (const block of imageBlocks) {
          const width = block.image.getWidth();
          const height = block.image.getHeight();
          if (isTiny(width, height)) {
            imageSet.skippedTiny++;
            continue;
          }
          const source = xrefImages.get(Number(block.image.pointer));
          const cached = source ? encoded.get(source.xref) : undefined;
          const encodedImage = cached ?? encodeImage(block.image, source);
          if (source && !cached) encoded.set(source.xref, encodedImage);
          const { image, isNew } = imageSet.add({
            key: `p${pageNumber}-img${imageIndex + 1}`,
            kind: "embedded",
            mime: encodedImage.mime,
            width,
            height,
            data: encodedImage.data,
            location: { page: pageNumber },
            bbox: block.bbox,
            provenance: encodedImage.provenance,
          });
          if (!imageKeys.includes(image.key)) imageKeys.push(image.key);
          if (isNew) {
            imageIndex++;
            figures.push(figureUnit(image, { page: pageNumber }, lines, size));
          }
        }
        for (const block of imageBlocks) block.image.destroy();
        stext.destroy();
        units.push(
          {
            unitType: "page",
            location: { page: pageNumber, label: page.getLabel() || String(pageNumber) },
            text,
            textBlocks: lines,
            imageKeys,
            size,
          },
          ...figures,
        );
      } finally {
        page.destroy();
      }
    }
    return {
      fileType,
      pageCount,
      units,
      images: imageSet.images,
      limitations: imageSet.limitations(),
    };
  } finally {
    doc.destroy();
  }
}
