import { mupdf, strToU8, zipSync } from "../../packages/ingest/test/fixture-deps.ts";

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** 16:9 slide, 960 x 540 pt. */
export const SLIDE_SIZE_EMU = { cx: 12192000, cy: 6858000 };
export const EMU_PER_POINT = 12700;

/** Picture placement on the "Phases" slide, in EMU. */
export const PICTURE_EMU = { x: 6096000, y: 1600200, cx: 4572000, cy: 3429000 };

export const SLIDE_TITLES = ["The Cardiac Cycle", "Phases of the cycle", "Pressure and volume"];

export const SPEAKER_NOTE = "Ask the class which valve closes first at the start of systole.";

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
}

function rels(entries: Array<{ id: string; type: string; target: string }>): string {
  const body = entries
    .map((e) => `<Relationship Id="${e.id}" Type="${REL}/${e.type}" Target="${e.target}"/>`)
    .join("");
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

function xfrm(x: number, y: number, cx: number, cy: number): string {
  return `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
}

function paragraphs(lines: string[]): string {
  return lines
    .map((line) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
    .join("");
}

/** A placeholder shape. Omitting `position` makes it inherit placement from the layout. */
function placeholder(
  id: number,
  ph: string,
  lines: string[],
  position?: [number, number, number, number],
): string {
  const spPr = position ? `<p:spPr>${xfrm(...position)}</p:spPr>` : "<p:spPr/>";
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${spPr}<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(lines)}</p:txBody></p:sp>`;
}

function picture(id: number, rId: string, emu: typeof PICTURE_EMU): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="Heart chambers"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(emu.x, emu.y, emu.cx, emu.cy)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function spTree(shapes: string): string {
  return `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;
}

function slide(shapes: string): string {
  return `${XML_HEAD}<p:sld ${NS}>${spTree(shapes)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const TITLE_PH = '<p:ph type="title"/>';
const BODY_PH = '<p:ph idx="1"/>';
const TITLE_POS: [number, number, number, number] = [838200, 365125, 10515600, 1325563];
const BODY_POS: [number, number, number, number] = [838200, 1825625, 10515600, 4351338];

const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture"><a:themeElements><a:clrScheme name="Fixture"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Fixture"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const MASTER = `${XML_HEAD}<p:sldMaster ${NS}>${spTree(
  placeholder(2, TITLE_PH, ["Title"], TITLE_POS) +
    placeholder(3, '<p:ph type="body" idx="1"/>', ["Body"], BODY_POS),
)}<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const LAYOUT = `${XML_HEAD}<p:sldLayout ${NS} type="obj" preserve="1">${spTree(
  placeholder(2, TITLE_PH, ["Title"], TITLE_POS) + placeholder(3, BODY_PH, ["Body"], BODY_POS),
)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const NOTES_MASTER = `${XML_HEAD}<p:notesMaster ${NS}>${spTree(
  placeholder(2, '<p:ph type="body" idx="1"/>', ["Notes"], [685800, 4400550, 5486400, 3600450]),
)}<p:clrMap ${CLR_MAP}/></p:notesMaster>`;

function notesSlide(text: string): string {
  return `${XML_HEAD}<p:notes ${NS}>${spTree(
    placeholder(2, '<p:ph type="sldImg"/>', []) +
      placeholder(3, '<p:ph type="body" idx="1"/>', [text]) +
      placeholder(4, '<p:ph type="sldNum" idx="5"/>', ["3"]),
  )}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function picturePng(): Uint8Array {
  const width = 160;
  const height = 120;
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * stride + x * 3;
      const left = x < width / 2;
      pixels[at] = left ? 60 : 200;
      pixels[at + 1] = 80;
      pixels[at + 2] = left ? 190 : 60;
    }
  }
  const png = pixmap.asPNG().slice();
  pixmap.destroy();
  return png;
}

/**
 * A three-slide deck matching the lecture PDF. presentation.xml lists the slide files out of
 * filename order (slide1, slide3, slide2), the titles inherit placement from the layout, the
 * second slide has a picture and the third has speaker notes.
 */
export function generateLecturePptx(): Uint8Array {
  const slide1 = slide(
    placeholder(2, '<p:ph type="ctrTitle"/>', [SLIDE_TITLES[0] ?? ""]) +
      placeholder(3, '<p:ph type="subTitle" idx="1"/>', ["Lecture 4: Cardiovascular physiology"]),
  );
  const phases = slide(
    placeholder(2, TITLE_PH, [SLIDE_TITLES[1] ?? ""]) +
      placeholder(
        3,
        BODY_PH,
        [
          "Systole: the ventricles contract & eject blood",
          "Diastole: the ventricles relax and fill",
        ],
        [838200, 1825625, 5000000, 4351338],
      ) +
      picture(4, "rId2", PICTURE_EMU),
  );
  const pressure = slide(
    placeholder(2, TITLE_PH, [SLIDE_TITLES[2] ?? ""]) +
      placeholder(3, BODY_PH, [
        "Valves open and close as pressure differences change",
        "The aortic valve opens when ventricular pressure exceeds aortic pressure",
      ]),
  );
  const layoutRel = { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" };

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${[1, 2, 3].map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`;

  const presentation = `${XML_HEAD}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId5"/></p:notesMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst><p:sldSz cx="${SLIDE_SIZE_EMU.cx}" cy="${SLIDE_SIZE_EMU.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(
      rels([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" }]),
    ),
    "ppt/presentation.xml": strToU8(presentation),
    "ppt/_rels/presentation.xml.rels": strToU8(
      rels([
        { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
        { id: "rId2", type: "slide", target: "slides/slide1.xml" },
        { id: "rId3", type: "slide", target: "slides/slide3.xml" },
        { id: "rId4", type: "slide", target: "slides/slide2.xml" },
        { id: "rId5", type: "notesMaster", target: "notesMasters/notesMaster1.xml" },
        { id: "rId6", type: "theme", target: "theme/theme1.xml" },
      ]),
    ),
    "ppt/slideMasters/slideMaster1.xml": strToU8(MASTER),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      rels([
        { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
        { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
      ]),
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(LAYOUT),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
      rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]),
    ),
    "ppt/notesMasters/notesMaster1.xml": strToU8(NOTES_MASTER),
    "ppt/notesMasters/_rels/notesMaster1.xml.rels": strToU8(
      rels([{ id: "rId1", type: "theme", target: "../theme/theme2.xml" }]),
    ),
    "ppt/theme/theme1.xml": strToU8(THEME),
    "ppt/theme/theme2.xml": strToU8(THEME),
    "ppt/slides/slide1.xml": strToU8(slide1),
    "ppt/slides/_rels/slide1.xml.rels": strToU8(rels([layoutRel])),
    "ppt/slides/slide3.xml": strToU8(phases),
    "ppt/slides/_rels/slide3.xml.rels": strToU8(
      rels([layoutRel, { id: "rId2", type: "image", target: "../media/image1.png" }]),
    ),
    "ppt/slides/slide2.xml": strToU8(pressure),
    "ppt/slides/_rels/slide2.xml.rels": strToU8(
      rels([
        layoutRel,
        { id: "rId2", type: "notesSlide", target: "../notesSlides/notesSlide1.xml" },
      ]),
    ),
    "ppt/notesSlides/notesSlide1.xml": strToU8(notesSlide(SPEAKER_NOTE)),
    "ppt/notesSlides/_rels/notesSlide1.xml.rels": strToU8(
      rels([
        { id: "rId1", type: "notesMaster", target: "../notesMasters/notesMaster1.xml" },
        { id: "rId2", type: "slide", target: "../slides/slide2.xml" },
      ]),
    ),
    "ppt/media/image1.png": picturePng(),
  };
  return zipSync(files, { level: 6 });
}
