import { mupdf } from "../../packages/ingest/test/fixture-deps.ts";

type Rgb = [number, number, number];

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** Paints an RGB pixmap with `paint(x, y)` and returns it encoded. */
function raster(width: number, height: number, paint: (x: number, y: number) => Rgb) {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  const pixels = pixmap.getPixels();
  const stride = pixmap.getStride();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const at = y * stride + x * 3;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
    }
  }
  return pixmap;
}

/** A schematic of the four heart chambers, one colour per quadrant. */
export function chambersDiagramJpeg(): Uint8Array {
  const width = 240;
  const height = 180;
  const pixmap = raster(width, height, (x, y) => {
    const border = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
    const septum = Math.abs(x - width / 2) < 4 || Math.abs(y - 70) < 4;
    if (border || septum) return [250, 250, 250];
    const right = x < width / 2;
    const atrium = y < 70;
    if (atrium) return right ? [70, 110, 200] : [210, 70, 70];
    return right ? [40, 70, 160] : [170, 40, 40];
  });
  const jpeg = pixmap.asJPEG(90).slice();
  pixmap.destroy();
  return jpeg;
}

/** A simple pressure trace, stored losslessly (Flate) in the PDF. */
function pressureTracePng(): Uint8Array {
  const width = 200;
  const height = 100;
  const pixmap = raster(width, height, (x, y) => {
    const curve = 80 - 60 * Math.max(0, Math.sin((x / width) * Math.PI * 2));
    return Math.abs(y - curve) < 2 ? [20, 20, 20] : [255, 255, 240];
  });
  const png = pixmap.asPNG().slice();
  pixmap.destroy();
  return png;
}

function iconPng(): Uint8Array {
  const pixmap = raster(16, 16, () => [0, 150, 0]);
  const png = pixmap.asPNG().slice();
  pixmap.destroy();
  return png;
}

function escapePdfString(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Builds a page content stream using top-left coordinates. */
class Content {
  private readonly ops: string[] = [];

  text(x: number, top: number, size: number, text: string, font = "F1"): this {
    const baseline = PAGE_HEIGHT - top - size;
    this.ops.push(`BT /${font} ${size} Tf ${x} ${baseline} Td (${escapePdfString(text)}) Tj ET`);
    return this;
  }

  bullet(x: number, top: number, size: number, text: string): this {
    const square = size * 0.35;
    const y = PAGE_HEIGHT - top - size * 0.65;
    this.ops.push(`0 0 0 rg ${x} ${y} ${square} ${square} re f`);
    return this.text(x + size, top, size, text);
  }

  line(x1: number, top1: number, x2: number, top2: number): this {
    this.ops.push(
      `0.3 0.3 0.3 RG 0.75 w ${x1} ${PAGE_HEIGHT - top1} m ${x2} ${PAGE_HEIGHT - top2} l S`,
    );
    return this;
  }

  image(name: string, x: number, top: number, width: number, height: number): this {
    this.ops.push(`q ${width} 0 0 ${height} ${x} ${PAGE_HEIGHT - top - height} cm /${name} Do Q`);
    return this;
  }

  toString(): string {
    return `${this.ops.join("\n")}\n`;
  }
}

/** Where the labelled diagram sits on page 2, in points from the top-left. */
export const DIAGRAM_PLACEMENT = { x0: 180, y0: 200, x1: 420, y1: 380 } as const;

export const DIAGRAM_LABELS = ["Right atrium", "Left atrium", "Right ventricle", "Left ventricle"];

/**
 * A three-page lecture on the cardiac cycle: headings, paragraphs, a bulleted list and a
 * labelled diagram (raster image with text labels beside it). Page 3 repeats the diagram as
 * a separate image object with identical bytes, and page 2 has a 16 px icon.
 */
export function generateLecturePdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const regular = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const bold = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
  const diagram = chambersDiagramJpeg();
  const fonts = { F1: regular, F2: bold };

  const page1 = new Content()
    .text(72, 72, 24, "The Cardiac Cycle", "F2")
    .text(72, 104, 12, "Lecture 4: Cardiovascular physiology")
    .text(72, 150, 16, "1. Overview", "F2")
    .text(72, 176, 11, "The cardiac cycle is the sequence of events in one heartbeat.")
    .text(72, 192, 11, "Each cycle has a contraction phase and a relaxation phase.")
    .text(72, 224, 13, "Key terms", "F2")
    .bullet(84, 246, 11, "Systole: the ventricles contract and eject blood.")
    .bullet(84, 264, 11, "Diastole: the ventricles relax and fill with blood.")
    .bullet(84, 282, 11, "Stroke volume: blood ejected by one ventricle per beat.")
    .text(72, 316, 11, "At a resting heart rate of 75 beats per minute, one cycle lasts 0.8 s.");

  const page2 = new Content()
    .text(72, 72, 16, "2. Chambers of the heart", "F2")
    .text(72, 98, 11, "Blood enters the atria and is pumped out by the ventricles.")
    .image("Icon", 72, 130, 16, 16)
    .text(94, 132, 11, "Diagram: anterior view, simplified.")
    .image("Diagram", 180, 200, 240, 180)
    .text(80, 226, 10, DIAGRAM_LABELS[0] ?? "")
    .line(150, 232, 200, 232)
    .text(432, 226, 10, DIAGRAM_LABELS[1] ?? "")
    .line(400, 232, 430, 232)
    .text(72, 316, 10, DIAGRAM_LABELS[2] ?? "")
    .line(150, 322, 200, 322)
    .text(432, 316, 10, DIAGRAM_LABELS[3] ?? "")
    .line(400, 322, 430, 322)
    .text(180, 392, 10, "Figure 1. The four chambers of the heart.");

  const page3 = new Content()
    .text(72, 72, 16, "3. Pressure and volume", "F2")
    .text(72, 98, 11, "Valves open and close as pressure differences change.")
    .text(72, 114, 11, "The aortic valve opens when ventricular pressure exceeds aortic pressure.")
    .image("Trace", 72, 150, 300, 150)
    .text(72, 310, 10, "Figure 2. Left ventricular pressure over two cycles.")
    .image("Diagram", 400, 150, 120, 90)
    .text(400, 250, 10, "Figure 1 (repeated).");

  const pages = [
    { content: page1, xobjects: {} },
    {
      content: page2,
      xobjects: {
        Diagram: doc.addImage(new mupdf.Image(diagram)),
        Icon: doc.addImage(new mupdf.Image(iconPng())),
      },
    },
    {
      content: page3,
      xobjects: {
        Trace: doc.addImage(new mupdf.Image(pressureTracePng())),
        Diagram: doc.addImage(new mupdf.Image(diagram)),
      },
    },
  ];
  for (const { content, xobjects } of pages) {
    const resources = doc.addObject({ Font: fonts, XObject: xobjects });
    const page = doc.addPage([0, 0, PAGE_WIDTH, PAGE_HEIGHT], 0, resources, content.toString());
    doc.insertPage(-1, page);
  }
  doc.setMetaData("info:Title", "The Cardiac Cycle");
  const buffer = doc.saveToBuffer("compress");
  const bytes = buffer.asUint8Array().slice();
  buffer.destroy();
  doc.destroy();
  return bytes;
}
