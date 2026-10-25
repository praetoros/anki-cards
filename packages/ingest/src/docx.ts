import { figureUnit, ImageSet, isTiny } from "./images.ts";
import { mediaInfo, OoxmlPackage } from "./ooxml.ts";
import { extractPdf } from "./pdf.ts";
import { convertToPdf } from "./tools.ts";
import type { ExtractedUnit, ExtractionResult, ExtractOptions } from "./types.ts";
import { child, children, descendants, numAttr, path, type XmlElement } from "./xml.ts";

interface Block {
  text: string;
  /** Heading level 1-6, when the paragraph is a heading. */
  level?: number;
  imageRIds: string[];
}

interface Section {
  heading?: string;
  lines: string[];
  imageRIds: string[];
}

function headingStyles(pkg: OoxmlPackage): Map<string, number> {
  const levels = new Map<string, number>();
  for (const style of children(pkg.xml("word/styles.xml"), "w:style")) {
    const id = style.attrs["w:styleId"];
    const name = child(style, "w:name")?.attrs["w:val"]?.toLowerCase() ?? "";
    const outline = numAttr(path(style, "w:pPr", "w:outlineLvl"), "w:val");
    const heading = /^heading (\d)$/.exec(name);
    const level =
      name === "title"
        ? 1
        : heading
          ? Number(heading[1])
          : outline !== undefined
            ? outline + 1
            : undefined;
    if (id && level !== undefined) levels.set(id, level);
  }
  return levels;
}

/** Visible text of a paragraph in reading order, plus the images drawn inside it. */
function paragraphContent(paragraph: XmlElement): { text: string; imageRIds: string[] } {
  let text = "";
  const imageRIds: string[] = [];
  const visit = (node: XmlElement) => {
    for (const part of node.children) {
      switch (part.name) {
        case "w:t":
          text += part.text;
          break;
        case "w:tab":
          text += "\t";
          break;
        case "w:br":
        case "w:cr":
          text += "\n";
          break;
        case "w:pPr":
        case "w:rPr":
        case "w:del":
          break;
        case "a:blip": {
          const rId = part.attrs["r:embed"];
          if (rId) imageRIds.push(rId);
          break;
        }
        default:
          visit(part);
      }
    }
  };
  visit(paragraph);
  return { text, imageRIds };
}

function readBlocks(body: XmlElement, styles: Map<string, number>): Block[] {
  const blocks: Block[] = [];
  for (const node of body.children) {
    if (node.name === "w:p") {
      const styleId = path(node, "w:pPr", "w:pStyle")?.attrs["w:val"];
      const outline = numAttr(path(node, "w:pPr", "w:outlineLvl"), "w:val");
      const level =
        (styleId ? styles.get(styleId) : undefined) ??
        (outline !== undefined ? outline + 1 : undefined);
      const { text, imageRIds } = paragraphContent(node);
      blocks.push({ text, imageRIds, ...(level !== undefined && level <= 6 ? { level } : {}) });
    } else if (node.name === "w:tbl") {
      const rows = children(node, "w:tr").map((row) =>
        children(row, "w:tc")
          .map((cell) =>
            children(cell, "w:p")
              .map((p) => paragraphContent(p).text)
              .join(" "),
          )
          .join("\t"),
      );
      const imageRIds = descendants(node, "a:blip").flatMap((blip) => blip.attrs["r:embed"] ?? []);
      blocks.push({ text: rows.join("\n"), imageRIds });
    } else if (node.name === "w:sdt") {
      const content = child(node, "w:sdtContent");
      if (content) blocks.push(...readBlocks(content, styles));
    }
  }
  return blocks;
}

function extractDocxXml(bytes: Uint8Array, limitation: string): ExtractionResult {
  const pkg = new OoxmlPackage(bytes);
  const documentPath = "word/document.xml";
  const body = path(pkg.xml(documentPath), "w:body");
  if (!body) throw new Error("DOCX has no word/document.xml body");
  const blocks = readBlocks(body, headingStyles(pkg));

  const sections: Section[] = [{ lines: [], imageRIds: [] }];
  for (const block of blocks) {
    if (block.level !== undefined && block.text.trim()) {
      sections.push({ heading: block.text.trim(), lines: [], imageRIds: [] });
    }
    const current = sections[sections.length - 1];
    if (!current) continue;
    const line =
      block.level !== undefined ? `${"#".repeat(block.level)} ${block.text.trim()}` : block.text;
    if (line.trim()) current.lines.push(line);
    current.imageRIds.push(...block.imageRIds);
  }

  const rels = pkg.rels(documentPath);
  const imageSet = new ImageSet();
  const keyByPath = new Map<string, string>();
  const units: ExtractedUnit[] = [];
  const figures: ExtractedUnit[] = [];
  const addMedia = (mediaPath: string): string | undefined => {
    const known = keyByPath.get(mediaPath);
    if (known) return known;
    const data = pkg.get(mediaPath);
    if (!data) return undefined;
    const info = mediaInfo(mediaPath, data);
    if (info.hasSize && isTiny(info.width, info.height)) {
      imageSet.skippedTiny++;
      return undefined;
    }
    const { image, isNew } = imageSet.add({
      key: `media${imageSet.images.length + 1}`,
      kind: "embedded",
      mime: info.mime,
      width: info.width,
      height: info.height,
      data,
      location: {},
      provenance: { path: mediaPath },
    });
    keyByPath.set(mediaPath, image.key);
    if (isNew && info.hasSize) figures.push(figureUnit(image, {}, []));
    return image.key;
  };

  for (const section of sections) {
    const imageKeys = [
      ...new Set(
        section.imageRIds.flatMap((rId) => {
          const target = rels.get(rId)?.target;
          return target ? (addMedia(target) ?? []) : [];
        }),
      ),
    ];
    const text = section.lines.join("\n").trim();
    if (!text && imageKeys.length === 0) continue;
    units.push({
      unitType: "text",
      location: section.heading ? { label: section.heading } : {},
      text,
      textBlocks: [],
      imageKeys,
    });
  }
  for (const mediaPath of pkg
    .paths()
    .filter((p) => p.startsWith("word/media/"))
    .sort()) {
    addMedia(mediaPath);
  }

  return {
    fileType: "docx",
    pageCount: 1,
    units: [...units, ...figures],
    images: imageSet.images,
    limitations: [limitation, ...imageSet.limitations()],
  };
}

/** Converts a DOCX to PDF with LibreOffice when available, otherwise reads its XML. */
export async function extractDocx(
  bytes: Uint8Array,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  if (!options.libreOfficePath) {
    return extractDocxXml(
      bytes,
      "page renders, layout and text positions unavailable: LibreOffice not installed; text and media read from the DOCX XML",
    );
  }
  try {
    const pdf = await convertToPdf(options.libreOfficePath, "docx", bytes, options.tempDir);
    return extractPdf(pdf, options, "docx");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return extractDocxXml(
      bytes,
      `page renders, layout and text positions unavailable: LibreOffice conversion failed (${message}); text and media read from the DOCX XML`,
    );
  }
}
