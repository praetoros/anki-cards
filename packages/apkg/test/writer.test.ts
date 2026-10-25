// Checks for our writer only: things anki-apkg-export can't express (Image Occlusion note type
// JSON) and the exact schema-11 layout from Anki's rslib/src/storage/schema11.sql.

import { describe, expect, test } from "vite-plus/test";

import { buildApkg, guidFor, stableNumericId } from "../src/index.ts";
import { basic, basicReversed, cloze, imageOcclusion, imageQuestion } from "../src/note-types.ts";
import type { ApkgInput, NoteDef } from "../src/types.ts";
import { findNote } from "./support/checks.ts";
import { parseApkg, type ParsedApkg } from "./support/parse.ts";
import { imageOcclusionScenario, mediaScenario, scenarios } from "./support/scenarios.ts";

const SCHEMA11_COLUMNS: Record<string, string[]> = {
  col: [
    "id",
    "crt",
    "mod",
    "scm",
    "ver",
    "dty",
    "usn",
    "ls",
    "conf",
    "models",
    "decks",
    "dconf",
    "tags",
  ],
  notes: ["id", "guid", "mid", "mod", "usn", "tags", "flds", "sfld", "csum", "flags", "data"],
  cards: [
    "id",
    "nid",
    "did",
    "ord",
    "mod",
    "usn",
    "type",
    "queue",
    "due",
    "ivl",
    "factor",
    "reps",
    "lapses",
    "left",
    "odue",
    "odid",
    "flags",
    "data",
  ],
  revlog: ["id", "cid", "usn", "ease", "ivl", "lastIvl", "factor", "time", "type"],
  graves: ["usn", "oid", "type"],
};

const SCHEMA11_INDEXES = [
  "ix_cards_nid",
  "ix_cards_sched",
  "ix_cards_usn",
  "ix_notes_csum",
  "ix_notes_usn",
  "ix_revlog_cid",
  "ix_revlog_usn",
];

const parse = (input: ApkgInput): ParsedApkg => parseApkg(buildApkg(input));

describe("collection.anki2", () => {
  const pkg = parse(mediaScenario.input);

  test("has Anki's schema-11 tables, columns and indexes", () => {
    for (const [table, columns] of Object.entries(SCHEMA11_COLUMNS)) {
      const info = pkg.db.prepare(`PRAGMA table_info(${table})`).all();
      expect(info.map((column) => column["name"])).toEqual(columns);
    }
    const indexes = pkg.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => row["name"]);
    expect(indexes).toEqual(SCHEMA11_INDEXES);
    expect(pkg.db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  test("note type, field and template JSON has the keys Anki's schema11.rs requires", () => {
    for (const model of Object.values(pkg.models)) {
      for (const key of [
        "id",
        "name",
        "type",
        "mod",
        "usn",
        "sortf",
        "did",
        "tmpls",
        "flds",
        "css",
      ]) {
        expect(model).toHaveProperty(key);
      }
      for (const field of model.flds) {
        for (const key of ["name", "ord", "sticky", "rtl", "font", "size"]) {
          expect(field).toHaveProperty(key);
        }
      }
      for (const template of model.tmpls) {
        for (const key of ["name", "ord", "qfmt"]) expect(template).toHaveProperty(key);
      }
    }
  });

  test("notes keep the GUIDs they were given", () => {
    for (const { input } of scenarios) {
      const built = parse(input);
      for (const note of input.notes) expect(findNote(built, note).guid).toBe(note.guid);
    }
  });

  test("parent decks get ids from stableNumericId", () => {
    const built = parse({
      ...mediaScenario.input,
      decks: [{ id: 1234, name: "Lib::Topic::Sub" }],
      notes: mediaScenario.input.notes.map((note) => ({ ...note, deckId: 1234 })),
    });
    expect(built.decks[String(stableNumericId("deck:Lib"))]?.name).toBe("Lib");
    expect(built.decks[String(stableNumericId("deck:Lib::Topic"))]?.name).toBe("Lib::Topic");
  });
});

describe("Image Occlusion note type", () => {
  // Rebuilt here from Anki's rslib/src/image_occlusion/notetype.rs and ftl/core/notetypes.ftl.
  const header = "Header";
  const errLoading = "Error loading image occlusion. Is your Anki version up to date?";
  const stockQfmt = `{{#${header}}}<div>{{${header}}}</div>{{/${header}}}
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
    document.getElementById("err").innerHTML = \`${errLoading}<br><br>\${exc}\`;
}
</script>
`;
  const stockAfmt = `${stockQfmt}
<div><button id="toggle">Toggle Masks</button></div>
{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}
`;

  const pkg = parse(imageOcclusionScenario.input);
  const model = pkg.models[String(imageOcclusion.id)];

  test("is a cloze note type with originalStockKind 6", () => {
    expect(model).toMatchObject({ type: 1, originalStockKind: 6 });
  });

  test("has the stock fields with tags 0–4, then ours", () => {
    expect(
      model?.flds.map(({ name, tag, preventDeletion }) => ({ name, tag, preventDeletion })),
    ).toEqual([
      { name: "Occlusion", tag: 0, preventDeletion: true },
      { name: "Image", tag: 1, preventDeletion: true },
      { name: "Header", tag: 2, preventDeletion: true },
      { name: "Back Extra", tag: 3, preventDeletion: true },
      { name: "Comments", tag: 4, preventDeletion: false },
      { name: "Source", tag: undefined, preventDeletion: false },
      { name: "KnowledgeIds", tag: undefined, preventDeletion: false },
      { name: "CardId", tag: undefined, preventDeletion: false },
    ]);
  });

  test("uses the stock template that calls anki.imageOcclusion.setup()", () => {
    expect(model?.tmpls).toHaveLength(1);
    expect(model?.tmpls[0]?.qfmt).toBe(stockQfmt);
    expect(model?.tmpls[0]?.afmt.startsWith(stockAfmt)).toBe(true);
    expect(model?.css).toContain("--active-shape-color: #ff8e8e;");
  });

  test("puts the image tag in the Image field and one card per occlusion", () => {
    const [note] = imageOcclusionScenario.input.notes;
    if (!note) throw new Error("scenario has no note");
    const row = findNote(pkg, note);
    expect(row.flds.split("\u001f")[1]).toBe('<img src="diagram.png">');
    expect(pkg.cards.filter((card) => card.nid === row.id).map((card) => card.ord)).toEqual([0, 1]);
  });
});

describe("card generation", () => {
  const deck = { id: 5000, name: "Deck" };
  const build = (note: Omit<NoteDef, "guid" | "deckId" | "tags">): number[] => {
    const full: NoteDef = { ...note, guid: guidFor("x"), deckId: deck.id, tags: [] };
    const pkg = parse({
      noteTypes: [basic, basicReversed, cloze, imageQuestion],
      decks: [deck],
      notes: [full],
      media: [],
    });
    return pkg.cards.map((card) => card.ord).sort((a, b) => a - b);
  };
  const shared = (front: string, back: string, image = ""): string[] => [
    front,
    back,
    "",
    image,
    "",
    "",
    "id",
  ];

  test("skips a template whose question would be empty", () => {
    expect(build({ noteTypeId: basicReversed.id, fields: shared("Front only", "") })).toEqual([0]);
    expect(build({ noteTypeId: basicReversed.id, fields: shared("", "Back only") })).toEqual([1]);
    expect(
      build({ noteTypeId: imageQuestion.id, fields: shared("", "", '<img src="a.png">') }),
    ).toEqual([0]);
  });

  test("treats a field holding only <br> or whitespace as empty", () => {
    expect(build({ noteTypeId: basicReversed.id, fields: shared("Q", " <br> ") })).toEqual([0]);
  });

  test("makes one cloze card per number, including multi-number clozes", () => {
    expect(
      build({ noteTypeId: cloze.id, fields: ["{{c1,3::a}} {{c0::b}}", "", "", "", "", "id"] }),
    ).toEqual([0, 2]);
  });
});

describe("validation", () => {
  const deck = { id: 5000, name: "Deck" };
  const note: NoteDef = {
    guid: "abc",
    noteTypeId: basic.id,
    deckId: deck.id,
    fields: ["Q", "A", "", "", "", "", "id"],
    tags: [],
  };
  const input: ApkgInput = { noteTypes: [basic], decks: [deck], notes: [note], media: [] };

  test.each<[string, ApkgInput, RegExp]>([
    ["duplicate guid", { ...input, notes: [note, note] }, /Duplicate note guid/],
    ["unknown note type", { ...input, notes: [{ ...note, noteTypeId: 77 }] }, /unknown note type/],
    ["unknown deck", { ...input, notes: [{ ...note, deckId: 77 }] }, /unknown deck/],
    ["field count", { ...input, notes: [{ ...note, fields: ["Q"] }] }, /has 1 fields/],
    [
      "separator in field",
      { ...input, notes: [{ ...note, fields: ["a\u001fb", ...note.fields.slice(1)] }] },
      /separator/,
    ],
    [
      "no cards",
      { ...input, notes: [{ ...note, fields: note.fields.map(() => "") }] },
      /generates no cards/,
    ],
    [
      "cloze without clozes",
      {
        ...input,
        noteTypes: [cloze],
        notes: [{ ...note, noteTypeId: cloze.id, fields: ["plain", "", "", "", "", "id"] }],
      },
      /generates no cards/,
    ],
    [
      "unknown template field",
      {
        ...input,
        noteTypes: [
          { ...basic, templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{Answer}}" }] },
        ],
      },
      /unknown field "Answer"/,
    ],
    ["deck id 1", { ...input, decks: [{ id: 1, name: "Deck" }] }, /greater than 1/],
    ["empty deck segment", { ...input, decks: [{ id: 9, name: "A::" }] }, /Invalid deck name/],
    [
      "media path",
      { ...input, media: [{ name: "../x.png", data: new Uint8Array() }] },
      /plain filename/,
    ],
    [
      "duplicate media",
      {
        ...input,
        media: [
          { name: "a.png", data: new Uint8Array() },
          { name: "a.png", data: new Uint8Array() },
        ],
      },
      /Duplicate media/,
    ],
  ])("rejects %s", (_name, bad, message) => {
    expect(() => buildApkg(bad)).toThrow(message);
  });
});
