import { figureUnit, ImageSet, isTiny } from "./images.ts";
import { mediaInfo, OoxmlPackage } from "./ooxml.ts";
import { DEFAULT_RENDER_DPI, renderPdfPages } from "./pdf.ts";
import { convertToPdf } from "./tools.ts";
import type { BBox, ExtractedUnit, ExtractionResult, ExtractOptions, TextBlock } from "./types.ts";
import { child, children, descendants, numAttr, path, type XmlElement } from "./xml.ts";

const EMU_PER_POINT = 12700;

/** A rectangle in EMU. */
interface Rect {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

type RectMapper = (rect: Rect) => Rect;

interface Placeholder {
  type: string;
  idx?: string;
  rect?: Rect;
}

type SlideItem =
  | { kind: "text"; text: string; rect?: Rect; isTitle: boolean }
  | { kind: "picture"; rId: string; rect?: Rect };

function readRect(xfrm: XmlElement | undefined): Rect | undefined {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return undefined;
  return {
    x: numAttr(off, "x") ?? 0,
    y: numAttr(off, "y") ?? 0,
    cx: numAttr(ext, "cx") ?? 0,
    cy: numAttr(ext, "cy") ?? 0,
  };
}

function toBBox(rect: Rect): BBox {
  return {
    x0: rect.x / EMU_PER_POINT,
    y0: rect.y / EMU_PER_POINT,
    x1: (rect.x + rect.cx) / EMU_PER_POINT,
    y1: (rect.y + rect.cy) / EMU_PER_POINT,
  };
}

function readPlaceholder(nvPr: XmlElement | undefined): Placeholder | undefined {
  const ph = child(nvPr, "p:ph");
  if (!ph) return undefined;
  // The schema default for a placeholder without a type is "obj".
  return { type: ph.attrs.type ?? "obj", idx: ph.attrs.idx };
}

function placeholderFamily(type: string): string {
  if (type === "ctrTitle") return "title";
  if (type === "subTitle" || type === "obj") return "body";
  return type;
}

function placeholdersOf(root: XmlElement | undefined): Placeholder[] {
  if (!root) return [];
  return [...descendants(root, "p:sp"), ...descendants(root, "p:pic")].flatMap((shape) => {
    const nv = child(shape, "p:nvSpPr") ?? child(shape, "p:nvPicPr");
    const ph = readPlaceholder(child(nv, "p:nvPr"));
    return ph ? [{ ...ph, rect: readRect(path(shape, "p:spPr", "a:xfrm")) }] : [];
  });
}

/** Placement of a placeholder that has no xfrm of its own: from the layout, then the master. */
function inheritedRect(
  ph: Placeholder,
  layout: Placeholder[],
  master: Placeholder[],
): Rect | undefined {
  if (ph.idx !== undefined) {
    const byIdx = layout.find((candidate) => candidate.idx === ph.idx && candidate.rect);
    if (byIdx) return byIdx.rect;
  }
  const family = placeholderFamily(ph.type);
  const sameFamily = (candidate: Placeholder) =>
    placeholderFamily(candidate.type) === family && candidate.rect !== undefined;
  return (layout.find(sameFamily) ?? master.find(sameFamily))?.rect;
}

function paragraphText(paragraph: XmlElement): string {
  let text = "";
  for (const part of paragraph.children) {
    if (part.name === "a:r" || part.name === "a:fld") text += child(part, "a:t")?.text ?? "";
    else if (part.name === "a:br") text += "\n";
  }
  return text;
}

function textBodyText(txBody: XmlElement | undefined): string {
  return children(txBody, "a:p")
    .map(paragraphText)
    .filter((line) => line.trim() !== "")
    .join("\n");
}

function tableText(table: XmlElement): string {
  return children(table, "a:tr")
    .map((row) =>
      children(row, "a:tc")
        .map((cell) => textBodyText(child(cell, "a:txBody")).replace(/\n/g, " "))
        .join("\t"),
    )
    .join("\n");
}

function groupMapper(grpSpPr: XmlElement | undefined, parent: RectMapper): RectMapper {
  const xfrm = child(grpSpPr, "a:xfrm");
  const outer = readRect(xfrm);
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  if (!outer || !chOff || !chExt) return parent;
  const cx = numAttr(chOff, "x") ?? 0;
  const cy = numAttr(chOff, "y") ?? 0;
  const sx = (numAttr(chExt, "cx") ?? 0) > 0 ? outer.cx / (numAttr(chExt, "cx") ?? 1) : 1;
  const sy = (numAttr(chExt, "cy") ?? 0) > 0 ? outer.cy / (numAttr(chExt, "cy") ?? 1) : 1;
  return (rect) =>
    parent({
      x: outer.x + (rect.x - cx) * sx,
      y: outer.y + (rect.y - cy) * sy,
      cx: rect.cx * sx,
      cy: rect.cy * sy,
    });
}

/** Collects text shapes, tables and pictures from a shape tree in document order. */
function readShapeTree(
  tree: XmlElement,
  mapper: RectMapper,
  inherit: (ph: Placeholder) => Rect | undefined,
  items: SlideItem[],
): void {
  for (const node of tree.children) {
    switch (node.name) {
      case "p:sp": {
        const ph = readPlaceholder(path(node, "p:nvSpPr", "p:nvPr"));
        const own = readRect(path(node, "p:spPr", "a:xfrm"));
        const rect = own ? mapper(own) : ph ? inherit(ph) : undefined;
        const text = textBodyText(child(node, "p:txBody"));
        const isTitle = ph ? placeholderFamily(ph.type) === "title" : false;
        if (text) items.push({ kind: "text", text, rect, isTitle });
        break;
      }
      case "p:pic": {
        const rId = path(node, "p:blipFill", "a:blip")?.attrs["r:embed"];
        const ph = readPlaceholder(path(node, "p:nvPicPr", "p:nvPr"));
        const own = readRect(path(node, "p:spPr", "a:xfrm"));
        const rect = own ? mapper(own) : ph ? inherit(ph) : undefined;
        if (rId) items.push({ kind: "picture", rId, rect });
        break;
      }
      case "p:graphicFrame": {
        const table = path(node, "a:graphic", "a:graphicData", "a:tbl");
        const own = readRect(child(node, "p:xfrm"));
        if (table) {
          const text = tableText(table);
          if (text.trim())
            items.push({ kind: "text", text, rect: own && mapper(own), isTitle: false });
        }
        break;
      }
      case "p:grpSp":
        readShapeTree(node, groupMapper(child(node, "p:grpSpPr"), mapper), inherit, items);
        break;
      case "mc:AlternateContent": {
        const branch = child(node, "mc:Fallback") ?? child(node, "mc:Choice");
        if (branch) readShapeTree(branch, mapper, inherit, items);
        break;
      }
    }
  }
}

function notesText(pkg: OoxmlPackage, slidePath: string): string {
  const notesRel = pkg.relOfKind(slidePath, "notesSlide");
  const root = notesRel && pkg.xml(notesRel.target);
  if (!root) return "";
  return descendants(root, "p:sp")
    .filter((shape) => readPlaceholder(path(shape, "p:nvSpPr", "p:nvPr"))?.type === "body")
    .map((shape) => textBodyText(child(shape, "p:txBody")))
    .filter(Boolean)
    .join("\n");
}

interface SlideRender {
  data: Uint8Array;
  width: number;
  height: number;
  pdfPage: number;
}

async function renderSlides(
  bytes: Uint8Array,
  visibleSlides: number[],
  options: ExtractOptions,
  limitations: string[],
): Promise<Map<number, SlideRender>> {
  const renders = new Map<number, SlideRender>();
  if (!options.libreOfficePath) {
    limitations.push("slide renders unavailable: LibreOffice not installed");
    return renders;
  }
  let pages;
  try {
    const pdf = await convertToPdf(options.libreOfficePath, "pptx", bytes, options.tempDir);
    pages = renderPdfPages(pdf, options.renderDpi ?? DEFAULT_RENDER_DPI);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    limitations.push(`slide renders unavailable: LibreOffice conversion failed: ${message}`);
    return renders;
  }
  if (pages.length !== visibleSlides.length) {
    limitations.push(
      `LibreOffice produced ${pages.length} page(s) for ${visibleSlides.length} visible slide(s); renders were matched in order`,
    );
  }
  pages.forEach((page, i) => {
    const slide = visibleSlides[i];
    if (slide !== undefined) renders.set(slide, { ...page, pdfPage: i + 1 });
  });
  return renders;
}

/** Extracts slide text, speaker notes and placed media from a PPTX, plus renders via LibreOffice. */
export async function extractPptx(
  bytes: Uint8Array,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const pkg = new OoxmlPackage(bytes);
  const presentationPath = "ppt/presentation.xml";
  const presentation = pkg.xml(presentationPath);
  if (!presentation) throw new Error("PPTX has no ppt/presentation.xml");
  const sldSz = child(presentation, "p:sldSz");
  const size = {
    width: (numAttr(sldSz, "cx") ?? 9144000) / EMU_PER_POINT,
    height: (numAttr(sldSz, "cy") ?? 6858000) / EMU_PER_POINT,
  };
  const presentationRels = pkg.rels(presentationPath);
  const slidePaths = children(child(presentation, "p:sldIdLst"), "p:sldId").flatMap((sldId) => {
    const rel = presentationRels.get(sldId.attrs["r:id"] ?? "");
    return rel ? [rel.target] : [];
  });

  const limitations: string[] = [];
  const slides = slidePaths.map((slidePath, i) => ({
    number: i + 1,
    path: slidePath,
    root: pkg.xml(slidePath),
  }));
  const hidden = slides.filter((s) => s.root?.attrs.show === "0").map((s) => s.number);
  const visible = slides.filter((s) => !hidden.includes(s.number)).map((s) => s.number);
  const renders = await renderSlides(bytes, visible, options, limitations);
  if (options.libreOfficePath && hidden.length > 0) {
    limitations.push(`hidden slide(s) ${hidden.join(", ")} have no render`);
  }

  const imageSet = new ImageSet();
  const units: ExtractedUnit[] = [];
  for (const slide of slides) {
    const location = { slide: slide.number };
    const tree = path(slide.root, "p:cSld", "p:spTree");
    if (!tree) {
      limitations.push(`slide ${slide.number}: missing or unreadable ${slide.path}`);
      continue;
    }
    const layoutRel = pkg.relOfKind(slide.path, "slideLayout");
    const masterRel = layoutRel && pkg.relOfKind(layoutRel.target, "slideMaster");
    const layoutPhs = placeholdersOf(layoutRel && pkg.xml(layoutRel.target));
    const masterPhs = placeholdersOf(masterRel && pkg.xml(masterRel.target));
    const items: SlideItem[] = [];
    readShapeTree(
      tree,
      (rect) => rect,
      (ph) => inheritedRect(ph, layoutPhs, masterPhs),
      items,
    );

    const texts = items.filter((item) => item.kind === "text");
    const ordered = [...texts.filter((t) => t.isTitle), ...texts.filter((t) => !t.isTitle)];
    const textBlocks: TextBlock[] = ordered.flatMap((t) =>
      t.rect ? [{ text: t.text, bbox: toBBox(t.rect) }] : [],
    );
    const notes = notesText(pkg, slide.path);
    const text = [ordered.map((t) => t.text).join("\n"), notes ? `Speaker notes:\n${notes}` : ""]
      .filter(Boolean)
      .join("\n\n");

    const imageKeys: string[] = [];
    const render = renders.get(slide.number);
    if (render) {
      const { image } = imageSet.add({
        key: `slide${slide.number}-render`,
        kind: "render",
        mime: "image/png",
        width: render.width,
        height: render.height,
        data: render.data,
        location,
        bbox: { x0: 0, y0: 0, x1: size.width, y1: size.height },
        provenance: {
          dpi: options.renderDpi ?? DEFAULT_RENDER_DPI,
          source: "libreoffice-pdf",
          pdfPage: render.pdfPage,
        },
      });
      imageKeys.push(image.key);
    }

    const slideRels = pkg.rels(slide.path);
    const figures: ExtractedUnit[] = [];
    let mediaIndex = 0;
    for (const picture of items.filter((item) => item.kind === "picture")) {
      const rel = slideRels.get(picture.rId);
      const data = rel && pkg.get(rel.target);
      if (!rel || !data) {
        limitations.push(`slide ${slide.number}: picture ${picture.rId} has no media part`);
        continue;
      }
      const info = mediaInfo(rel.target, data);
      if (info.hasSize && isTiny(info.width, info.height)) {
        imageSet.skippedTiny++;
        continue;
      }
      const { image, isNew } = imageSet.add({
        key: `slide${slide.number}-media${mediaIndex + 1}`,
        kind: "embedded",
        mime: info.mime,
        width: info.width,
        height: info.height,
        data,
        location,
        ...(picture.rect ? { bbox: toBBox(picture.rect) } : {}),
        provenance: { path: rel.target, rId: picture.rId },
      });
      if (!imageKeys.includes(image.key)) imageKeys.push(image.key);
      if (isNew) {
        mediaIndex++;
        if (info.hasSize) figures.push(figureUnit(image, location, textBlocks, size));
      }
    }

    const title = ordered.find((t) => t.isTitle)?.text.replace(/\n/g, " ");
    units.push(
      {
        unitType: "slide",
        location: title ? { ...location, label: title } : location,
        text,
        textBlocks,
        imageKeys,
        size,
      },
      ...figures,
    );
  }

  const unsized = imageSet.images.filter((image) => image.kind === "embedded" && image.width === 0);
  if (unsized.length > 0) {
    limitations.push(
      `${unsized.length} picture(s) in formats without readable dimensions (${[...new Set(unsized.map((i) => i.mime))].join(", ")}) kept as-is without figure units`,
    );
  }
  return {
    fileType: "pptx",
    pageCount: slides.length,
    units,
    images: imageSet.images,
    limitations: [...limitations, ...imageSet.limitations()],
  };
}
