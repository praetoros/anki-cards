// Port of the cloze parser and renderer in Anki's rslib/src/cloze.rs.
// Not ported: MathJax-aware tokenizing (a `}}` inside `\(...\)` closes the cloze here).

import { escapeAttribute } from "./html.ts";

interface ClozeNode {
  kind: "cloze";
  ordinals: number[];
  nodes: Node[];
  hint: string | undefined;
}

type Node = string | ClozeNode;

type Token =
  | { kind: "open"; ordinals: number[] }
  | { kind: "close" }
  | { kind: "text"; text: string };

const OPEN = /^\{\{c([\d,]+)::/;
const IO_PREFIX = "image-occlusion:";
const MAX_NESTING = 10;

function openAt(text: string): { ordinals: number[]; length: number } | undefined {
  const match = OPEN.exec(text);
  if (!match?.[1]) return undefined;
  const ordinals = [
    ...new Set(
      match[1]
        .split(",")
        .filter((part) => part !== "")
        .map(Number),
    ),
  ].sort((a, b) => a - b);
  return ordinals.length ? { ordinals, length: match[0].length } : undefined;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let rest = text;
  while (rest) {
    const open = openAt(rest);
    if (open) {
      tokens.push({ kind: "open", ordinals: open.ordinals });
      rest = rest.slice(open.length);
    } else if (rest.startsWith("}}")) {
      tokens.push({ kind: "close" });
      rest = rest.slice(2);
    } else {
      let end = 1;
      while (end < rest.length && !rest.startsWith("}}", end) && !openAt(rest.slice(end))) end++;
      tokens.push({ kind: "text", text: rest.slice(0, end) });
      rest = rest.slice(end);
    }
  }
  return tokens;
}

function parse(text: string): Node[] {
  const open: ClozeNode[] = [];
  const output: Node[] = [];
  for (const token of tokenize(text)) {
    if (token.kind === "open") {
      if (open.length < MAX_NESTING) {
        open.push({ kind: "cloze", ordinals: token.ordinals, nodes: [], hint: undefined });
      }
    } else if (token.kind === "text") {
      const cloze = open.at(-1);
      if (!cloze) {
        output.push(token.text);
        continue;
      }
      let body = token.text;
      if (!body.startsWith(IO_PREFIX)) {
        const split = body.indexOf("::");
        if (split >= 0) {
          cloze.hint = body.slice(split + 2);
          body = body.slice(0, split);
        }
      }
      cloze.nodes.push(body);
    } else {
      const cloze = open.pop();
      if (cloze) (open.at(-1)?.nodes ?? output).push(cloze);
      else output.push("}}");
    }
  }
  return output;
}

function imageOcclusionText(cloze: ClozeNode): string | undefined {
  const first = cloze.nodes[0];
  return typeof first === "string" && first.startsWith(IO_PREFIX)
    ? first.slice(IO_PREFIX.length)
    : undefined;
}

/** Cloze numbers used in `text`, excluding 0 (Image Occlusion's always-shown text). */
export function clozeNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  const visit = (nodes: Node[]): void => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      for (const ordinal of node.ordinals) if (ordinal !== 0) numbers.add(ordinal);
      visit(node.nodes);
    }
  };
  visit(parse(text));
  return numbers;
}

export interface ImageOcclusionProperty {
  name: string;
  value: string;
}

export interface ParsedImageOcclusion {
  shape: string;
  properties: ImageOcclusionProperty[];
}

/** Port of `parse_image_cloze`: `rect:left=.1:top=.2` with `\:` and `\\` escapes. */
export function parseImageCloze(text: string): ParsedImageOcclusion | undefined {
  const colon = text.indexOf(":");
  if (colon < 0) return undefined;
  const properties: ImageOcclusionProperty[] = [];
  const pattern = /:([^=]+)=((?:[^\\:]|\\[\\:])*)/y;
  pattern.lastIndex = colon;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    properties.push({ name: match[1] ?? "", value: (match[2] ?? "").replace(/\\([\\:])/g, "$1") });
  }
  return { shape: text.slice(0, colon), properties };
}

export type ImageOcclusionState = "active" | "inactive" | "highlight";

export interface ImageOcclusionRender {
  occlusion: ParsedImageOcclusion;
  state: ImageOcclusionState;
  ordinals: number[];
}

export type ImageOcclusionRenderer = (render: ImageOcclusionRender) => string;

const CLOZE_DATA_KEYS: Record<string, string> = {
  left: "left",
  top: "top",
  angle: "angle",
  fill: "fill",
  width: "width",
  height: "height",
  rx: "rx",
  ry: "ry",
  points: "points",
  oi: "occludeInactive",
};

/** Anki's own output: a div whose data attributes `anki.imageOcclusion.setup()` reads. */
export const ankiImageOcclusionDiv: ImageOcclusionRenderer = ({ occlusion, state, ordinals }) => {
  const cls =
    state === "active" ? "cloze" : state === "inactive" ? "cloze-inactive" : "cloze-highlight";
  let data = ["rect", "ellipse", "polygon", "text"].includes(occlusion.shape)
    ? `data-shape="${occlusion.shape}" `
    : "";
  for (const { name, value } of occlusion.properties) {
    const key = CLOZE_DATA_KEYS[name];
    if (key && value !== "" && !(["width", "height", "rx", "ry"].includes(name) && value === "0")) {
      data += `data-${key}="${escapeAttribute(value)}" `;
    }
  }
  return `<div class="${cls}" data-ordinal="${ordinals.join(",")}" ${data}></div>`;
};

function renderImageOcclusion(
  text: string,
  question: boolean,
  active: boolean,
  ordinals: number[],
  renderer: ImageOcclusionRenderer,
): string {
  const occlusion = parseImageCloze(text) ?? { shape: "", properties: [] };
  if ((question && active) || ordinals.includes(0)) {
    return renderer({ occlusion, state: "active", ordinals });
  }
  if (!active) return renderer({ occlusion, state: "inactive", ordinals });
  return renderer({ occlusion, state: "highlight", ordinals });
}

/**
 * Port of `reveal_cloze_text`: `ordinal` is the cloze number (card ord + 1). Returns "" when the
 * text has no cloze with that number, as Anki does.
 */
export function revealCloze(
  text: string,
  ordinal: number,
  question: boolean,
  renderer: ImageOcclusionRenderer = ankiImageOcclusionDiv,
): string {
  let found = false;
  const reveal = (cloze: ClozeNode): string => {
    const active = cloze.ordinals.includes(ordinal);
    found ||= active;
    const io = imageOcclusionText(cloze);
    if (io !== undefined)
      return renderImageOcclusion(io, question, active, cloze.ordinals, renderer);
    const inner = (): string =>
      cloze.nodes.map((node) => (typeof node === "string" ? node : reveal(node))).join("");
    const ords = cloze.ordinals.join(",");
    if (active && question) {
      const content = inner();
      return `<span class="cloze" data-cloze="${escapeAttribute(content)}" data-ordinal="${ords}">[${cloze.hint ?? "..."}]</span>`;
    }
    if (active) return `<span class="cloze" data-ordinal="${ords}">${inner()}</span>`;
    return `<span class="cloze-inactive" data-ordinal="${ords}">${inner()}</span>`;
  };
  const html = parse(text)
    .map((node) => (typeof node === "string" ? node : reveal(node)))
    .join("");
  return found ? html : "";
}
