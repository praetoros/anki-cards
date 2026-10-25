import { describe, expect, it } from "vite-plus/test";
import {
  chambersDiagramJpeg,
  DIAGRAM_LABELS,
  DIAGRAM_PLACEMENT,
  generateLecturePdf,
} from "../../../tests/fixtures/lecture-pdf.ts";
import { extractSource, readImageInfo, type ExtractionResult } from "../src/index.ts";

const pdf = generateLecturePdf();
const result: ExtractionResult = await extractSource("lecture.pdf", pdf);

function unit(type: string, page: number) {
  const found = result.units.find((u) => u.unitType === type && u.location.page === page);
  if (!found) throw new Error(`no ${type} unit on page ${page}`);
  return found;
}

function image(key: string) {
  const found = result.images.find((i) => i.key === key);
  if (!found) throw new Error(`no image ${key}`);
  return found;
}

describe("PDF extraction", () => {
  it("returns one page unit per page with full text and page size", () => {
    expect(result.fileType).toBe("pdf");
    expect(result.pageCount).toBe(3);
    const pages = result.units.filter((u) => u.unitType === "page");
    expect(pages.map((p) => p.location.page)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.size?.width === 612 && p.size.height === 792)).toBe(true);
    const page1 = unit("page", 1);
    expect(page1.text).toContain("The Cardiac Cycle");
    expect(page1.text).toContain("Systole: the ventricles contract and eject blood.");
    expect(page1.text).toContain("Stroke volume: blood ejected by one ventricle per beat.");
  });

  it("gives line text blocks with top-left origin bboxes in points", () => {
    const blocks = unit("page", 1).textBlocks;
    const title = blocks.find((b) => b.text === "The Cardiac Cycle");
    const bullet = blocks.find((b) => b.text.startsWith("Diastole:"));
    expect(title).toBeDefined();
    expect(bullet).toBeDefined();
    if (!title || !bullet) return;
    // Drawn at 24 pt with its em box 72 pt from the left and top edges.
    expect(title.bbox.x0).toBeCloseTo(72, 0);
    expect(title.bbox.y0).toBeGreaterThan(66);
    expect(title.bbox.y1).toBeLessThan(106);
    expect(title.bbox.x1 - title.bbox.x0).toBeGreaterThan(150);
    // Bullet text is indented past the bullet square and lower on the page.
    expect(bullet.bbox.x0).toBeGreaterThan(90);
    expect(bullet.bbox.y0).toBeGreaterThan(title.bbox.y1);
    for (const block of blocks) {
      expect(block.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(block.bbox.x1).toBeLessThanOrEqual(612);
      expect(block.bbox.y1).toBeLessThanOrEqual(792);
      expect(block.bbox.x1).toBeGreaterThan(block.bbox.x0);
      expect(block.bbox.y1).toBeGreaterThan(block.bbox.y0);
    }
  });

  it("renders every page to PNG at 150 DPI by default, render listed first", () => {
    for (const page of [1, 2, 3]) {
      const render = image(`p${page}-render`);
      expect(render.kind).toBe("render");
      expect(render.mime).toBe("image/png");
      expect(readImageInfo(render.data)).toEqual({ mime: "image/png", width: 1275, height: 1650 });
      expect(render.provenance.dpi).toBe(150);
      expect(unit("page", page).imageKeys[0]).toBe(render.key);
    }
  });

  it("honours renderDpi", async () => {
    const low = await extractSource("lecture.pdf", pdf, { renderDpi: 72 });
    const render = low.images.find((i) => i.key === "p1-render");
    expect(render?.width).toBe(612);
    expect(render?.height).toBe(792);
  });

  it("extracts the embedded JPEG with its original bytes and placement", () => {
    const diagram = image("p2-img1");
    expect(diagram.kind).toBe("embedded");
    expect(diagram.mime).toBe("image/jpeg");
    expect(diagram.provenance.encoding).toBe("original");
    expect(typeof diagram.provenance.xref).toBe("number");
    expect(Buffer.from(diagram.data).equals(Buffer.from(chambersDiagramJpeg()))).toBe(true);
    expect(diagram.width).toBe(240);
    expect(diagram.height).toBe(180);
    expect(diagram.bbox).toEqual(DIAGRAM_PLACEMENT);
    expect(unit("page", 2).imageKeys).toEqual(["p2-render", "p2-img1"]);
  });

  it("stores Flate images as lossless PNG", () => {
    const trace = image("p3-img1");
    expect(trace.mime).toBe("image/png");
    expect(trace.provenance.encoding).toBe("png-lossless");
    expect(readImageInfo(trace.data)).toEqual({ mime: "image/png", width: 200, height: 100 });
    expect(trace.bbox).toEqual({ x0: 72, y0: 150, x1: 372, y1: 300 });
  });

  it("dedupes repeated images by content hash and skips tiny ones", () => {
    const embedded = result.images.filter((i) => i.kind === "embedded");
    expect(embedded.map((i) => i.key)).toEqual(["p2-img1", "p3-img1"]);
    expect(new Set(embedded.map((i) => i.sha256)).size).toBe(2);
    // Page 3 shows the diagram again as a separate image object with the same bytes.
    expect(unit("page", 3).imageKeys).toEqual(["p3-render", "p3-img1", "p2-img1"]);
    expect(result.limitations.some((l) => l.includes("smaller than 32 px"))).toBe(true);
  });

  it("creates one figure unit per distinct image, with nearby labels", () => {
    const figures = result.units.filter((u) => u.unitType === "figure");
    expect(figures.map((f) => f.imageKeys)).toEqual([["p2-img1"], ["p3-img1"]]);
    const diagram = unit("figure", 2);
    expect(diagram.location.label).toBe("p2-img1");
    const labels = diagram.textBlocks.map((b) => b.text);
    expect(labels).toEqual(
      expect.arrayContaining([...DIAGRAM_LABELS, "Figure 1. The four chambers of the heart."]),
    );
    expect(labels).not.toContain("2. Chambers of the heart");
    const rightAtrium = diagram.textBlocks.find((b) => b.text === "Right atrium");
    expect(rightAtrium?.bbox.x1).toBeLessThan(DIAGRAM_PLACEMENT.x0);
  });
});
