import { guidFor, occlusionsToCloze, stableNumericId } from "../../src/preview.ts";
import {
  basic,
  basicReversed,
  cloze,
  imageOcclusion,
  imageQuestion,
} from "../../src/note-types.ts";
import type { ApkgInput, DeckDef, NoteDef, NoteTypeDef } from "../../src/types.ts";

export interface Scenario {
  name: string;
  input: ApkgInput;
  /** Card ords each note must generate, in note order. */
  expectedOrds: number[][];
}

const deck = (name: string): DeckDef => ({ id: stableNumericId(`deck:${name}`), name });

/** Shared field layout: Front, Back, Extra, Image, Source, KnowledgeIds, CardId. */
function sharedFields(
  cardId: string,
  front: string,
  back: string,
  more: { extra?: string; image?: string; source?: string } = {},
): string[] {
  return [front, back, more.extra ?? "", more.image ?? "", more.source ?? "", "k-1 k-2", cardId];
}

function note(type: NoteTypeDef, target: DeckDef, fields: string[], tags: string[] = []): NoteDef {
  const cardId = fields.at(-1) ?? "";
  return { guid: guidFor(cardId), noteTypeId: type.id, deckId: target.id, fields, tags };
}

// 1×1 transparent PNG and a few bytes standing in for audio.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

const biology = deck("Biology");

export const basicScenario: Scenario = {
  name: "Basic",
  input: {
    noteTypes: [basic],
    decks: [biology],
    notes: [
      note(basic, biology, sharedFields("card-1", "Powerhouse of the cell?", "Mitochondria")),
      note(
        basic,
        biology,
        sharedFields("card-2", "<b>Site</b> of protein synthesis?", "Ribosome &amp; ER", {
          source: "Lecture 3, slide 12",
        }),
      ),
    ],
    media: [],
  },
  expectedOrds: [[0], [0]],
};

export const reversedScenario: Scenario = {
  name: "Basic + Reversed",
  input: {
    noteTypes: [basicReversed],
    decks: [biology],
    notes: [note(basicReversed, biology, sharedFields("card-3", "ATP", "Adenosine triphosphate"))],
    media: [],
  },
  expectedOrds: [[0, 1]],
};

const clozeNote = (cardId: string, text: string, extra = ""): NoteDef =>
  note(cloze, biology, [text, extra, "", "", "k-1", cardId]);

export const clozeScenario: Scenario = {
  name: "Cloze with several ordinals",
  input: {
    noteTypes: [cloze],
    decks: [biology],
    notes: [
      clozeNote(
        "card-4",
        "{{c1::Glycolysis}} happens in the {{c2::cytoplasm}}, the {{c3::Krebs cycle::stage}} in the mitochondria",
        "Respiration",
      ),
      clozeNote("card-5", "{{c2::Na+}} out, {{c2::K+}} in, via the {{c4::sodium-potassium pump}}"),
    ],
    media: [],
  },
  expectedOrds: [
    [0, 1, 2],
    [1, 3],
  ],
};

export const mediaScenario: Scenario = {
  name: "Media",
  input: {
    noteTypes: [basic, imageQuestion],
    decks: [biology],
    notes: [
      note(
        imageQuestion,
        biology,
        sharedFields("card-6", 'Name the organelle <img src="cell.png">', "Nucleus", {
          image: '<img src="cell.png">',
        }),
      ),
      note(basic, biology, sharedFields("card-7", "Listen [sound:heart.mp3]", "Heart murmur")),
    ],
    media: [
      { name: "cell.png", data: PNG },
      { name: "heart.mp3", data: MP3 },
    ],
  },
  expectedOrds: [[0], [0]],
};

const library = deck("Library");
const subtopic = deck("Library::Cells::Organelles");

export const tagsAndDecksScenario: Scenario = {
  name: "Tags and nested decks",
  input: {
    noteTypes: [basic],
    decks: [library, subtopic],
    notes: [
      note(basic, subtopic, sharedFields("card-8", "Golgi function", "Packaging proteins"), [
        "Cells::Organelles",
        "P1",
        "external",
        "my library",
      ]),
      note(basic, library, sharedFields("card-9", "Cell theory", "All life is cells"), ["P2"]),
    ],
    media: [],
  },
  expectedOrds: [[0], [0]],
};

const anatomy = deck("Anatomy");

export const imageOcclusionScenario: Scenario = {
  name: "Image Occlusion",
  input: {
    noteTypes: [imageOcclusion, basic],
    decks: [anatomy],
    notes: [
      note(imageOcclusion, anatomy, [
        occlusionsToCloze([
          { shape: "rect", left: 0.1, top: 0.2, width: 0.3, height: 0.1 },
          { shape: "rect", left: 0.6, top: 0.2, width: 0.3, height: 0.1 },
        ]),
        '<img src="diagram.png">',
        "Label the parts",
        "",
        "",
        "Atlas p. 4",
        "k-3",
        "card-10",
      ]),
    ],
    media: [{ name: "diagram.png", data: PNG }],
  },
  expectedOrds: [[0, 1]],
};

export const scenarios = [
  basicScenario,
  reversedScenario,
  clozeScenario,
  mediaScenario,
  tagsAndDecksScenario,
  imageOcclusionScenario,
];
