import { stableNumericId } from "./ids.ts";
import type { NoteTypeDef, NoteTypeField } from "./types.ts";

export const IMAGE_OCCLUSION_STOCK_KIND = 6;

/** Shared by every note type, in the `.apkg` and in the preview. */
export const CARD_CSS = `.card {
  font-family: arial, sans-serif;
  font-size: 20px;
  line-height: 1.4;
  text-align: center;
  color: black;
  background-color: white;
}
.cloze {
  font-weight: bold;
  color: blue;
}
.nightMode .cloze {
  color: lightblue;
}
.image img {
  max-width: 100%;
  height: auto;
}
.extra {
  margin-top: 1em;
  font-size: 0.9em;
}
.source {
  margin-top: 1.5em;
  font-size: 0.6em;
  font-style: italic;
  opacity: 0.6;
}
`;

// Verbatim from Anki's rslib/src/image_occlusion/notetype.css.
const STOCK_IMAGE_OCCLUSION_CSS = `#image-occlusion-canvas {
    --inactive-shape-color: #ffeba2;
    --active-shape-color: #ff8e8e;
    --inactive-shape-border: 1px #212121;
    --active-shape-border: 1px #212121;
    --highlight-shape-color: #ff8e8e00;
    --highlight-shape-border: 1px #ff8e8e;
}
`;

const IMAGE = `{{#Image}}<div class="image">{{Image}}</div>{{/Image}}`;
const EXTRA = `{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}`;
const SOURCE = `{{#Source}}<div class="source">{{text:Source}}</div>{{/Source}}`;
const ANSWER = (field: string): string => `{{FrontSide}}\n\n<hr id=answer>\n\n{{${field}}}`;

const fields = (...names: string[]): NoteTypeField[] => names.map((name) => ({ name }));
const SHARED_FIELDS = ["Front", "Back", "Extra", "Image", "Source", "KnowledgeIds", "CardId"];
const HIDDEN_FIELDS = ["KnowledgeIds", "CardId"];

export const basic: NoteTypeDef = {
  id: stableNumericId("anki-cards:note-type:basic"),
  name: "Anki Cards: Basic",
  kind: "standard",
  fields: fields(...SHARED_FIELDS),
  templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: ANSWER("Back") + IMAGE + EXTRA + SOURCE }],
  css: CARD_CSS,
  sortField: 0,
};

export const basicReversed: NoteTypeDef = {
  id: stableNumericId("anki-cards:note-type:basic-reversed"),
  name: "Anki Cards: Basic + Reversed",
  kind: "standard",
  fields: fields(...SHARED_FIELDS),
  templates: [
    { name: "Card 1", qfmt: "{{Front}}", afmt: ANSWER("Back") + IMAGE + EXTRA + SOURCE },
    { name: "Card 2", qfmt: "{{Back}}", afmt: ANSWER("Front") + IMAGE + EXTRA + SOURCE },
  ],
  css: CARD_CSS,
  sortField: 0,
};

export const cloze: NoteTypeDef = {
  id: stableNumericId("anki-cards:note-type:cloze"),
  name: "Anki Cards: Cloze",
  kind: "cloze",
  fields: fields("Text", "Extra", "Image", "Source", ...HIDDEN_FIELDS),
  templates: [
    {
      name: "Cloze",
      qfmt: `{{cloze:Text}}${IMAGE}`,
      afmt: `{{cloze:Text}}${IMAGE}${EXTRA}${SOURCE}`,
    },
  ],
  css: CARD_CSS,
  sortField: 0,
};

export const imageQuestion: NoteTypeDef = {
  id: stableNumericId("anki-cards:note-type:image-question"),
  name: "Anki Cards: Image + Question",
  kind: "standard",
  fields: fields(...SHARED_FIELDS),
  templates: [
    {
      name: "Card 1",
      qfmt: `${IMAGE}<div class="question">{{Front}}</div>`,
      afmt: ANSWER("Back") + EXTRA + SOURCE,
    },
  ],
  css: CARD_CSS,
  sortField: 0,
};

// Template and fields follow Anki's stock note type (rslib/src/image_occlusion/notetype.rs) with
// the English strings from ftl/core/notetypes.ftl; only the Source line and our fields are added.
const IO_QFMT = `{{#Header}}<div>{{Header}}</div>{{/Header}}
<div style="display: none">{{cloze:Occlusion}}</div>
<div id="err"></div>
<div id="image-occlusion-container">
    {{Image}}
    <canvas id="image-occlusion-canvas"></canvas>
</div>
<script>
try {
    anki.imageOcclusion.setup();
} catch (exc) {
    document.getElementById("err").innerHTML = \`Error loading image occlusion. Is your Anki version up to date?<br><br>\${exc}\`;
}
</script>
`;

const IO_AFMT = `${IO_QFMT}
<div><button id="toggle">Toggle Masks</button></div>
{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}
${SOURCE}`;

export const imageOcclusion: NoteTypeDef = {
  id: stableNumericId("anki-cards:note-type:image-occlusion"),
  name: "Anki Cards: Image Occlusion",
  kind: "cloze",
  originalStockKind: IMAGE_OCCLUSION_STOCK_KIND,
  fields: [
    { name: "Occlusion", tag: 0, preventDeletion: true },
    { name: "Image", tag: 1, preventDeletion: true },
    { name: "Header", tag: 2, preventDeletion: true },
    { name: "Back Extra", tag: 3, preventDeletion: true },
    { name: "Comments", tag: 4 },
    { name: "Source" },
    ...fields(...HIDDEN_FIELDS),
  ],
  templates: [{ name: "Image Occlusion", qfmt: IO_QFMT, afmt: IO_AFMT }],
  css: STOCK_IMAGE_OCCLUSION_CSS + CARD_CSS,
  sortField: 0,
};

export const noteTypes = { basic, basicReversed, cloze, imageOcclusion, imageQuestion } as const;

export type NoteTypeKey = keyof typeof noteTypes;
