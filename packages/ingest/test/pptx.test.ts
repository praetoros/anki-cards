import { describe, expect, it } from "vite-plus/test";
import {
  EMU_PER_POINT,
  generateLecturePptx,
  PICTURE_EMU,
  SLIDE_TITLES,
  SPEAKER_NOTE,
} from "../../../tests/fixtures/lecture-pptx.ts";
import { extractSource } from "../src/index.ts";

const pptx = generateLecturePptx();
const result = await extractSource("lecture.pptx", pptx);
const slides = result.units.filter((u) => u.unitType === "slide");

function slide(n: number) {
  const found = slides.find((s) => s.location.slide === n);
  if (!found) throw new Error(`no slide ${n}`);
  return found;
}

describe("PPTX extraction", () => {
  it("follows presentation.xml slide order, not file names", () => {
    expect(result.fileType).toBe("pptx");
    expect(result.pageCount).toBe(3);
    expect(slides.map((s) => s.location.label)).toEqual(SLIDE_TITLES);
  });

  it("reads slide size and text in reading order with decoded entities", () => {
    expect(slide(1).size).toEqual({ width: 960, height: 540 });
    expect(slide(1).text).toBe("The Cardiac Cycle\nLecture 4: Cardiovascular physiology");
    expect(slide(2).text).toBe(
      "Phases of the cycle\nSystole: the ventricles contract & eject blood\nDiastole: the ventricles relax and fill",
    );
  });

  it("positions text blocks, inheriting placeholder placement from the layout", () => {
    const [title, body] = slide(2).textBlocks;
    // The title has no xfrm of its own; the layout puts it at (838200, 365125) EMU.
    expect(title?.text).toBe("Phases of the cycle");
    expect(title?.bbox.x0).toBeCloseTo(838200 / EMU_PER_POINT);
    expect(title?.bbox.y0).toBeCloseTo(365125 / EMU_PER_POINT);
    expect(body?.bbox.x1).toBeCloseTo((838200 + 5000000) / EMU_PER_POINT);
  });

  it("labels speaker notes as part of the slide text", () => {
    expect(slide(3).text).toContain(`Speaker notes:\n${SPEAKER_NOTE}`);
    expect(slide(3).text.startsWith("Pressure and volume\n")).toBe(true);
    expect(slide(3).text).not.toMatch(/\n3$/);
  });

  it("extracts media with slide placement in points", () => {
    expect(result.images).toHaveLength(1);
    const picture = result.images[0];
    expect(picture?.key).toBe("slide2-media1");
    expect(picture?.mime).toBe("image/png");
    expect(picture?.width).toBe(160);
    expect(picture?.height).toBe(120);
    expect(picture?.provenance.path).toBe("ppt/media/image1.png");
    expect(picture?.bbox).toEqual({
      x0: PICTURE_EMU.x / EMU_PER_POINT,
      y0: PICTURE_EMU.y / EMU_PER_POINT,
      x1: (PICTURE_EMU.x + PICTURE_EMU.cx) / EMU_PER_POINT,
      y1: (PICTURE_EMU.y + PICTURE_EMU.cy) / EMU_PER_POINT,
    });
    expect(slide(2).imageKeys).toEqual(["slide2-media1"]);
    const figure = result.units.find((u) => u.unitType === "figure");
    expect(figure?.imageKeys).toEqual(["slide2-media1"]);
    expect(figure?.location.slide).toBe(2);
  });

  it("records missing slide renders when LibreOffice is absent", () => {
    expect(result.limitations).toContain("slide renders unavailable: LibreOffice not installed");
    expect(result.images.some((i) => i.kind === "render")).toBe(false);
  });

  it("records a failed LibreOffice conversion and still returns slide text", async () => {
    // node rejects soffice's arguments, so the conversion produces no PDF.
    const failed = await extractSource("lecture.pptx", pptx, { libreOfficePath: process.execPath });
    expect(failed.units.filter((u) => u.unitType === "slide")).toHaveLength(3);
    expect(
      failed.limitations.some((l) =>
        l.startsWith("slide renders unavailable: LibreOffice conversion failed"),
      ),
    ).toBe(true);
  });
});
