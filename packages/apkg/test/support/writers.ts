import AnkiExport, { type ModelDefinition } from "anki-apkg-export";

import { buildApkg } from "../../src/index.ts";
import type { ApkgInput, NoteTypeDef } from "../../src/types.ts";

export interface Writer {
  name: string;
  build(input: ApkgInput): Promise<Uint8Array>;
}

/** Plain `{{Field}}` references in a question: the oracle's "all of these must be non-empty". */
function requiredFields(qfmt: string, fieldNames: string[]): string[] {
  const refs = [...qfmt.matchAll(/\{\{([^#^/{}:]+)\}\}/g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((name) => fieldNames.includes(name));
  return refs.length ? [...new Set(refs)] : fieldNames.slice(0, 1);
}

function oracleModel(def: NoteTypeDef): ModelDefinition {
  const names = def.fields.map((field) => field.name);
  return {
    id: def.id,
    name: def.name,
    type: def.kind === "cloze" ? "cloze" : "basic",
    fields: names,
    sortField: names[def.sortField ?? 0],
    css: def.css,
    templates: def.templates.map((template) => ({
      name: template.name,
      questionFormat: template.qfmt,
      answerFormat: template.afmt,
      requiredFields: requiredFields(template.qfmt, names),
    })),
  };
}

export const oracleWriter: Writer = {
  name: "anki-apkg-export@5.0.0",
  async build(input) {
    const decks = [...input.decks].sort(
      (a, b) => a.name.split("::").length - b.name.split("::").length,
    );
    const [top] = decks;
    const [firstType, ...otherTypes] = input.noteTypes;
    if (!top || !firstType) throw new Error("Oracle needs at least one deck and one note type");
    const apkg = await AnkiExport.create(top.name, {
      deckId: top.id,
      modelId: firstType.id,
      model: oracleModel(firstType),
    });
    try {
      for (const type of otherTypes) apkg.addModel(oracleModel(type));
      for (const deck of decks) apkg.addDeck(deck.name, { deckId: deck.id });
      for (const item of input.media) apkg.addMedia(item.name, item.data);
      const deckNames = new Map(decks.map((deck) => [deck.id, deck.name]));
      for (const note of input.notes) {
        apkg.addNote(note.fields, {
          modelId: note.noteTypeId,
          noteId: note.guid,
          deck: deckNames.get(note.deckId),
          tags: note.tags,
        });
      }
      return await apkg.save();
    } finally {
      apkg.close();
    }
  },
};

export const ownWriter: Writer = {
  name: "own writer",
  build: (input) => Promise.resolve(buildApkg(input)),
};

export const writers = [oracleWriter, ownWriter];
