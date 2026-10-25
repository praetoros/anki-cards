// Image Occlusion masks in Anki's cloze syntax (ts/routes/image-occlusion/shapes/to-cloze.ts).
// Coordinates are fractions (0–1) of the image width (x) and height (y).

export interface Point {
  x: number;
  y: number;
}

interface MaskBase {
  /** Cloze number. Masks sharing a number are hidden and revealed together. */
  ordinal?: number;
}

export interface RectMask extends MaskBase {
  shape: "rect";
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `left`/`top` are the bounding box corner; `rx` is a fraction of width, `ry` of height. */
export interface EllipseMask extends MaskBase {
  shape: "ellipse";
  left: number;
  top: number;
  rx: number;
  ry: number;
}

export interface PolygonMask extends MaskBase {
  shape: "polygon";
  points: Point[];
}

export type OcclusionMask = RectMask | EllipseMask | PolygonMask;

export interface OcclusionsToClozeOptions {
  /** Anki's "Hide all, guess one" (`oi=1`). Default true. */
  occludeInactive?: boolean;
}

/** Port of Anki's `floatToDisplay`: up to 4 fraction digits, leading and trailing zeros dropped. */
export function floatToDisplay(value: number): string {
  if (Number.isNaN(value) || value === 0) return ".0000";
  return value.toFixed(4).replace(/^0+|0+$/g, "");
}

function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function maskProperties(mask: OcclusionMask): [string, string][] {
  switch (mask.shape) {
    case "rect":
      return [
        ["left", floatToDisplay(mask.left)],
        ["top", floatToDisplay(mask.top)],
        ["width", floatToDisplay(mask.width)],
        ["height", floatToDisplay(mask.height)],
      ];
    case "ellipse":
      return [
        ["left", floatToDisplay(mask.left)],
        ["top", floatToDisplay(mask.top)],
        ["rx", floatToDisplay(mask.rx)],
        ["ry", floatToDisplay(mask.ry)],
      ];
    case "polygon":
      return [
        ["left", floatToDisplay(Math.min(...mask.points.map((p) => p.x)))],
        ["top", floatToDisplay(Math.min(...mask.points.map((p) => p.y)))],
        [
          "points",
          mask.points.map((p) => `${floatToDisplay(p.x)},${floatToDisplay(p.y)}`).join(" "),
        ],
      ];
  }
}

/** Masks without an ordinal take the lowest unused numbers first, as Anki's editor does. */
function assignOrdinals(masks: readonly OcclusionMask[]): number[] {
  const used = new Set(masks.flatMap((mask) => (mask.ordinal === undefined ? [] : [mask.ordinal])));
  let candidate = 1;
  return masks.map((mask) => {
    if (mask.ordinal !== undefined) return mask.ordinal;
    while (used.has(candidate)) candidate++;
    used.add(candidate);
    return candidate;
  });
}

/** Text for the Occlusion field, e.g. `{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4:oi=1}}<br>`. */
export function occlusionsToCloze(
  masks: readonly OcclusionMask[],
  { occludeInactive = true }: OcclusionsToClozeOptions = {},
): string {
  const ordinals = assignOrdinals(masks);
  return masks
    .map((mask, index) => {
      const properties = maskProperties(mask);
      if (occludeInactive) properties.push(["oi", "1"]);
      const data = properties.map(([key, value]) => `:${key}=${escapeValue(value)}`).join("");
      return `{{c${ordinals[index]}::image-occlusion:${mask.shape}${data}}}<br>`;
    })
    .join("");
}
