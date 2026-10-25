import * as mupdf from "mupdf";

import type { BBox } from "./types.ts";

/**
 * Renders one rectangle of a PDF page (in page points, origin top-left) to PNG. Used to make
 * an Image Occlusion image that includes labels printed next to a figure.
 */
export function renderPdfRegion(bytes: Uint8Array, pageNumber: number, region: BBox, dpi = 200) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const page = doc.loadPage(pageNumber - 1);
    const scale = dpi / 72;
    const left = Math.floor(region.x0 * scale);
    const top = Math.floor(region.y0 * scale);
    // The pixmap starts at 0,0, so the page is shifted so the region's corner lands there.
    const matrix = mupdf.Matrix.concat(
      mupdf.Matrix.scale(scale, scale),
      mupdf.Matrix.translate(-left, -top),
    );
    const box: mupdf.Rect = [
      0,
      0,
      Math.ceil(region.x1 * scale) - left,
      Math.ceil(region.y1 * scale) - top,
    ];
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, box, false);
    pixmap.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    page.run(device, matrix);
    device.close();
    const png = pixmap.asPNG();
    return { png, width: box[2] - box[0], height: box[3] - box[1] };
  } finally {
    doc.destroy();
  }
}
