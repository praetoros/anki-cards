import { mupdf, strToU8, zipSync } from "../../packages/ingest/test/fixture-deps.ts";

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function paragraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function drawing(rId: string): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1828800" cy="1371600"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chambers.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function style(id: string, name: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr></w:style>`;
}

function picturePng(): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 96, 72], false);
  pixmap.clear(200);
  const png = pixmap.asPNG().slice();
  pixmap.destroy();
  return png;
}

/** A short handout with two heading levels, a picture and a table. */
export function generateLectureDocx(): Uint8Array {
  const body = [
    paragraph("The Cardiac Cycle", "Heading1"),
    paragraph("One heartbeat consists of systole followed by diastole."),
    paragraph("Systole", "Heading2"),
    paragraph("The ventricles contract and the semilunar valves open."),
    drawing("rId2"),
    paragraph("Diastole", "Heading2"),
    paragraph("The ventricles relax and fill through the atrioventricular valves."),
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Phase</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Duration</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Systole</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>0.3 s</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
  ].join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
    ),
    "word/styles.xml": strToU8(
      `${XML_HEAD}<w:styles ${W_NS}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style("Heading1", "heading 1")}${style("Heading2", "heading 2")}</w:styles>`,
    ),
    "word/media/image1.png": picturePng(),
  };
  return zipSync(files, { level: 6 });
}
