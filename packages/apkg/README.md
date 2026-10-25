# @anki-cards/apkg

Writes Anki `.apkg` files: a legacy `collection.anki2` (schema 11) built with `node:sqlite`, a
`media` map and numbered media files, zipped with fflate. It also holds our note types, Image
Occlusion helpers and a preview renderer. See ADR 0003 and design §13.

## API

```ts
import { buildApkg, guidFor, noteTypes, stableNumericId } from "@anki-cards/apkg";

const deck = { id: stableNumericId("deck:Biology::Cells"), name: "Biology::Cells" };
const apkg: Uint8Array = buildApkg({
  noteTypes: [noteTypes.basic],
  decks: [deck], // parents ("Biology") are added with id stableNumericId("deck:Biology")
  notes: [
    {
      guid: guidFor("card_01j…"), // stable per card, so re-imports update the note
      noteTypeId: noteTypes.basic.id,
      deckId: deck.id,
      fields: [
        "Powerhouse of the cell?",
        "Mitochondria",
        "",
        "",
        "Lecture 3",
        "k1 k2",
        "card_01j…",
      ],
      tags: ["Cells::Organelles", "P1"],
    },
  ],
  media: [], // { name: "cell.png", data: Uint8Array }
});
```

- `buildApkg(input)` validates ids, decks, fields and media names and throws on errors. Cards:
  standard note types get a card per template whose question renders non-empty (Anki's rule);
  cloze note types get one per cloze number (`{{c1,2::…}}` counts for both; `c0` for none).
- `guidFor(stableId)`: deterministic Anki-style base91 GUID.
- `stableNumericId(key)`: deterministic positive safe integer for note type and deck ids.
- `renderCard(noteType, fields, ordinal, side)`: HTML for one side of a card, using the same
  templates as the export. `ordinal` is the card ord (template index, or cloze number − 1). Wrap
  the result in `<div class="card">` with `noteType.css`. Supports `{{Field}}`, `{{#Field}}`,
  `{{^Field}}`, `{{FrontSide}}`, `{{cloze:Field}}` and `{{text:Field}}`. Image Occlusion cards
  are drawn with positioned mask divs instead of Anki's script.
- `occlusionsToCloze(masks, { occludeInactive })`: Anki's Occlusion field text from
  `rect`/`ellipse`/`polygon` masks in 0–1 fractions of the image.

`@anki-cards/apkg/preview` exports everything except `buildApkg` without Node imports, for use
in the browser.

## Note types

| Note type        | Fields                                                                                                       | Cards                |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------- |
| Basic            | Front, Back, Extra, Image, Source, KnowledgeIds, CardId                                                      | 1                    |
| Basic + Reversed | same                                                                                                         | 2                    |
| Image + Question | same; Image shows on the front                                                                               | 1                    |
| Cloze            | Text, Extra, Image, Source, KnowledgeIds, CardId                                                             | one per cloze number |
| Image Occlusion  | Occlusion, Image, Header, Back Extra, Comments (Anki's stock fields, tags 0–4), Source, KnowledgeIds, CardId | one per mask number  |

`KnowledgeIds` and `CardId` are never rendered. `Source` renders as a small citation line on the
back. The shared CSS is `CARD_CSS` in `src/note-types.ts`. The Image Occlusion note type copies
Anki's stock one (kind cloze, `originalStockKind: 6`, field tags, the template that calls
`anki.imageOcclusion.setup()`) so Anki treats it as Image Occlusion.

## Tests

`vp test` from `packages/apkg`. `test/oracle.test.ts` runs the same checks
(`test/support/checks.ts`) against `anki-apkg-export@5.0.0` and against `buildApkg`.

## Image Occlusion check in Anki

```sh
vpx packages/apkg/scripts/io-check.ts io-check.apkg
```

Import `io-check.apkg` into Anki desktop (23.10 or later) and follow the checklist the script
prints: two IO cards and one Basic card, masks over "CPU" and "RAM", and the IO editor opening
from the browser.
