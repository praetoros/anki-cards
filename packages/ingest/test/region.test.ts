import { describe, expect, it } from "vite-plus/test";

import { DIAGRAM_PLACEMENT, generateLecturePdf } from "../../../tests/fixtures/lecture-pdf.ts";
import { readImageInfo } from "../src/image-header.ts";
import { renderPdfRegion } from "../src/region.ts";

describe("renderPdfRegion", () => {
  it("renders only the requested rectangle of the page", () => {
    const { png, width, height } = renderPdfRegion(generateLecturePdf(), 2, DIAGRAM_PLACEMENT, 144);
    const info = readImageInfo(png);
    expect(info?.width).toBe(width);
    expect(width).toBe((DIAGRAM_PLACEMENT.x1 - DIAGRAM_PLACEMENT.x0) * 2);
    expect(height).toBe((DIAGRAM_PLACEMENT.y1 - DIAGRAM_PLACEMENT.y0) * 2);
  });
});
