import { describe, expect, test } from "vite-plus/test";

import { occlusionsToCloze } from "../src/image-occlusion.ts";
import {
  basic,
  basicReversed,
  cloze,
  imageOcclusion,
  imageQuestion,
  noteTypes,
} from "../src/note-types.ts";
import { renderCard } from "../src/render.ts";
import type { NoteTypeDef } from "../src/types.ts";

const shared = (front: string, back: string, extra = "", image = "", source = ""): string[] => [
  front,
  back,
  extra,
  image,
  source,
  "knowledge-42",
  "card-id-99",
];

describe("standard note types", () => {
  test("Basic front and back", () => {
    const fields = shared("Capital of France?", "Paris");
    expect(renderCard(basic, fields, 0, "front")).toBe("Capital of France?");
    expect(renderCard(basic, fields, 0, "back")).toBe(
      "Capital of France?\n\n<hr id=answer>\n\nParis",
    );
  });

  test("optional blocks render only when their field is filled", () => {
    const back = renderCard(
      basic,
      shared("Q", "A", "More detail", '<img src="a.png">', "<b>Lecture 3</b>, slide 4"),
      0,
      "back",
    );
    expect(back).toContain('<div class="image"><img src="a.png"></div>');
    expect(back).toContain('<div class="extra">More detail</div>');
    expect(back).toContain('<div class="source">Lecture 3, slide 4</div>');
    expect(renderCard(basic, shared("Q", "A", "<br>"), 0, "back")).not.toContain("extra");
  });

  test("Basic + Reversed card 2 asks the Back", () => {
    const fields = shared("ATP", "Adenosine triphosphate");
    expect(renderCard(basicReversed, fields, 1, "front")).toBe("Adenosine triphosphate");
    expect(renderCard(basicReversed, fields, 1, "back")).toContain("<hr id=answer>\n\nATP");
  });

  test("Image + Question shows the image on the front", () => {
    const front = renderCard(
      imageQuestion,
      shared("Which bone?", "Femur", "", '<img src="leg.png">'),
      0,
      "front",
    );
    expect(front).toBe(
      '<div class="image"><img src="leg.png"></div><div class="question">Which bone?</div>',
    );
  });

  test("hidden id fields never render", () => {
    for (const type of Object.values(noteTypes)) {
      const fields = type.fields.map((field) => `value of ${field.name}`);
      const ords = type.kind === "cloze" ? [0] : type.templates.map((_template, ord) => ord);
      for (const ord of ords) {
        for (const side of ["front", "back"] as const) {
          const html = renderCard(type, fields, ord, side);
          expect(html).not.toContain("value of KnowledgeIds");
          expect(html).not.toContain("value of CardId");
        }
      }
    }
  });
});

describe("cloze", () => {
  const fields = [
    "{{c1::Paris}} is the capital of {{c2::France::country}}",
    "Extra",
    "",
    "",
    "k",
    "c",
  ];

  test("hides the active cloze on the front and shows the others", () => {
    expect(renderCard(cloze, fields, 1, "front")).toBe(
      '<span class="cloze-inactive" data-ordinal="1">Paris</span> is the capital of ' +
        '<span class="cloze" data-cloze="France" data-ordinal="2">[country]</span>',
    );
  });

  test("reveals the active cloze on the back", () => {
    expect(renderCard(cloze, fields, 0, "back")).toBe(
      '<span class="cloze" data-ordinal="1">Paris</span> is the capital of ' +
        '<span class="cloze-inactive" data-ordinal="2">France</span><div class="extra">Extra</div>',
    );
  });
});

describe("template language", () => {
  const custom = (qfmt: string, afmt = "{{FrontSide}}"): NoteTypeDef => ({
    id: 99,
    name: "Custom",
    kind: "standard",
    fields: [{ name: "Front" }, { name: "Note" }],
    templates: [{ name: "Card 1", qfmt, afmt }],
    css: "",
  });

  test("negated sections render when the field is empty", () => {
    const type = custom("{{Front}}{{^Note}} (no note){{/Note}}");
    expect(renderCard(type, ["Q", ""], 0, "front")).toBe("Q (no note)");
    expect(renderCard(type, ["Q", "n"], 0, "front")).toBe("Q");
  });

  test("text filter strips HTML", () => {
    expect(renderCard(custom("{{text:Front}}"), ["<i>a</i> &amp; b", ""], 0, "front")).toBe(
      "a &amp; b",
    );
  });

  test("FrontSide is empty on the front", () => {
    expect(renderCard(custom("[{{FrontSide}}]"), ["Q", ""], 0, "front")).toBe("[]");
  });

  test.each([
    ["{{Missing}}", /unknown field/],
    ["{{hint:Front}}", /Unsupported template filter/],
    ["{{#Front}}x", /missing \{\{\/Front\}\}/],
    ["x{{/Front}}", /without a matching/],
  ])("%s throws", (qfmt, message) => {
    expect(() => renderCard(custom(qfmt), ["Q", ""], 0, "front")).toThrow(message);
  });

  test("rejects a wrong number of fields", () => {
    expect(() => renderCard(basic, ["only one"], 0, "front")).toThrow(/fields/);
  });
});

describe("Image Occlusion preview", () => {
  const occlusion = occlusionsToCloze([
    { shape: "rect", left: 0.1, top: 0.2, width: 0.3, height: 0.1 },
    { shape: "ellipse", left: 0.5, top: 0.5, rx: 0.1, ry: 0.05 },
  ]);
  const fields = [
    occlusion,
    '<img src="heart.png">',
    "Heart",
    "Back extra text",
    "",
    "Atlas",
    "k",
    "c",
  ];

  test("front draws the active mask and occludes the others, without Anki's script", () => {
    const front = renderCard(imageOcclusion, fields, 0, "front");
    expect(front).toContain("<div>Heart</div>");
    expect(front).toContain('<img src="heart.png">');
    expect(front).not.toContain("<script>");
    expect(front).not.toContain("<canvas");
    expect(front).not.toContain('style="display: none"');
    expect(front).toContain(
      '<div class="io-mask io-mask-active" style="position:absolute;box-sizing:border-box;background:#ff8e8e;border:1px solid #212121;left:10%;top:20%;width:30%;height:10%;"></div>',
    );
    expect(front).toMatch(
      /<div class="io-mask io-mask-inactive" style="[^"]*left:50%;top:50%;width:20%;height:10%;border-radius:50%;"><\/div>/,
    );
    expect(front.indexOf("io-mask")).toBeGreaterThan(front.indexOf('<img src="heart.png">'));
  });

  test("back highlights the active mask and shows Back Extra and Source", () => {
    const back = renderCard(imageOcclusion, fields, 1, "back");
    expect(back).toMatch(/io-mask-inactive" style="[^"]*left:10%/);
    expect(back).toMatch(/io-mask-highlight" style="[^"]*left:50%/);
    expect(back).not.toContain("Toggle Masks");
    expect(back).toContain("<div>Back extra text</div>");
    expect(back).toContain('<div class="source">Atlas</div>');
  });

  test("without occlude-inactive only the active mask is drawn", () => {
    const text = occlusionsToCloze(
      [
        { shape: "rect", left: 0.1, top: 0.1, width: 0.1, height: 0.1 },
        {
          shape: "polygon",
          points: [
            { x: 0.5, y: 0.5 },
            { x: 0.6, y: 0.5 },
            { x: 0.55, y: 0.6 },
          ],
        },
      ],
      { occludeInactive: false },
    );
    const front = renderCard(imageOcclusion, [text, ...fields.slice(1)], 1, "front");
    expect(front.match(/class="io-mask /g)).toHaveLength(1);
    expect(front).toContain("clip-path:polygon(50% 50%,60% 50%,55% 60%)");
  });
});
