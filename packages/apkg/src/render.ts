import type { ImageOcclusionRenderer } from "./cloze.ts";
import { IMAGE_OCCLUSION_STOCK_KIND } from "./note-types.ts";
import { parseTemplate, renderNodes, type RenderContext } from "./template.ts";
import type { NoteTypeDef } from "./types.ts";

export type CardSide = "front" | "back";

// Colours from Anki's stock Image Occlusion CSS variables.
const MASK_STYLE = {
  active: "background:#ff8e8e;border:1px solid #212121;",
  inactive: "background:#ffeba2;border:1px solid #212121;",
  highlight: "background:transparent;border:1px solid #ff8e8e;",
};

const percent = (value: string | undefined): string =>
  `${Math.round(Number(value ?? 0) * 1e6) / 1e4}%`;

/**
 * Draws masks as positioned divs, standing in for the canvas that `anki.imageOcclusion.setup()`
 * draws in Anki. Inactive masks are drawn only with `oi=1`, as Anki's reviewer does.
 */
const previewMask: ImageOcclusionRenderer = ({ occlusion, state }) => {
  const props = new Map(occlusion.properties.map(({ name, value }) => [name, value]));
  if (state === "inactive" && props.get("oi") !== "1") return "";
  const fill = state !== "highlight" && props.get("fill") ? `background:${props.get("fill")};` : "";
  const style = `position:absolute;box-sizing:border-box;${MASK_STYLE[state]}${fill}`;
  const cls = `io-mask io-mask-${state}`;
  switch (occlusion.shape) {
    case "rect":
      return `<div class="${cls}" style="${style}left:${percent(props.get("left"))};top:${percent(props.get("top"))};width:${percent(props.get("width"))};height:${percent(props.get("height"))};"></div>`;
    case "ellipse": {
      const width = percent(String(Number(props.get("rx") ?? 0) * 2));
      const height = percent(String(Number(props.get("ry") ?? 0) * 2));
      return `<div class="${cls}" style="${style}left:${percent(props.get("left"))};top:${percent(props.get("top"))};width:${width};height:${height};border-radius:50%;"></div>`;
    }
    case "polygon": {
      const points = (props.get("points") ?? "")
        .split(" ")
        .map((pair) => pair.split(","))
        .map(([x, y]) => `${percent(x)} ${percent(y)}`)
        .join(",");
      return `<div class="${cls}" style="${style}inset:0;border:none;clip-path:polygon(${points});"></div>`;
    }
    default:
      return "";
  }
};

const MASK_DIV = /<div class="io-mask [^"]*" style="[^"]*"><\/div>/g;

/** Rewrites the stock IO template output so it works without Anki's script. */
function imageOcclusionPreview(html: string): string {
  const masks = (html.match(MASK_DIV) ?? []).join("");
  return html
    .replace(MASK_DIV, "")
    .replace(/<div style="display: none">(?:\s|<br\s*\/?>)*<\/div>\n?/g, "")
    .replace(/<script>[\s\S]*?<\/script>\n?/g, "")
    .replace(/<div id="err"><\/div>\n?/g, "")
    .replace(/<div><button id="toggle">[\s\S]*?<\/button><\/div>\n?/g, "")
    .replace(
      /<div id="image-occlusion-container">/g,
      '<div id="image-occlusion-container" style="position:relative;display:inline-block;line-height:0;">',
    )
    .replace(
      /<canvas id="image-occlusion-canvas"><\/canvas>/,
      `<div class="io-masks" style="position:absolute;inset:0;pointer-events:none;">${masks}</div>`,
    );
}

/**
 * Renders one side of a card as Anki would, for previews. `ordinal` is the card ord: the
 * template index for standard note types, the cloze number minus one for cloze note types.
 * Returns the template HTML only; wrap it in `<div class="card">` with `noteType.css`.
 */
export function renderCard(
  noteType: NoteTypeDef,
  fields: readonly string[],
  ordinal: number,
  side: CardSide,
): string {
  if (fields.length !== noteType.fields.length) {
    throw new Error(
      `${noteType.name} has ${noteType.fields.length} fields, got ${fields.length} values`,
    );
  }
  const template = noteType.templates[noteType.kind === "cloze" ? 0 : ordinal];
  if (!template) throw new Error(`${noteType.name} has no template for card ${ordinal}`);
  const isImageOcclusion = noteType.originalStockKind === IMAGE_OCCLUSION_STOCK_KIND;
  const context: RenderContext = {
    fields: new Map(noteType.fields.map((field, index) => [field.name, fields[index] ?? ""])),
    frontSide: undefined,
    cardOrd: ordinal,
    ...(isImageOcclusion ? { imageOcclusion: previewMask } : {}),
  };
  const finish = isImageOcclusion ? imageOcclusionPreview : (html: string) => html;
  const front = renderNodes(parseTemplate(template.qfmt), context);
  if (side === "front") return finish(front);
  return finish(renderNodes(parseTemplate(template.afmt), { ...context, frontSide: front }));
}
