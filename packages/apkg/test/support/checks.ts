// Assertions on a parsed package, shared by the oracle and our writer.

import { createHash } from "node:crypto";
import { expect } from "vite-plus/test";

import type { ApkgInput, DeckDef, MediaDef, NoteDef, NoteTypeDef } from "../../src/types.ts";
import type { NoteRow, ParsedApkg } from "./parse.ts";

const SEPARATOR = "\u001f";

/** Independent of the writers: how Anki strips the plain fields used in these scenarios. */
function expectedStripped(html: string): string {
  return html
    .replace(/<img[^>]*\bsrc="([^"]+)"[^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&");
}

function expectedChecksum(field: string): number {
  return Number.parseInt(
    createHash("sha1").update(expectedStripped(field)).digest("hex").slice(0, 8),
    16,
  );
}

export function findNote(pkg: ParsedApkg, note: NoteDef): NoteRow {
  const row = pkg.notes.find((candidate) => candidate.flds === note.fields.join(SEPARATOR));
  if (!row) throw new Error(`No note row with fields ${JSON.stringify(note.fields)}`);
  return row;
}

export function checkCollection(pkg: ParsedApkg): void {
  expect(Object.keys(pkg.files)).toEqual(expect.arrayContaining(["collection.anki2", "media"]));
  expect(pkg.tables).toEqual(expect.arrayContaining(["cards", "col", "graves", "notes", "revlog"]));
  expect(pkg.col).toMatchObject({ id: 1, ver: 11, dty: 0, ls: 0, tags: "{}" });
  for (const key of ["crt", "mod", "scm"] as const) expect(pkg.col[key]).toBeGreaterThan(0);
  expect(pkg.conf.nextPos).toBe(pkg.cards.length + 1);
  expect(typeof pkg.conf.curModel).toBe("string");
  expect(Object.keys(pkg.models)).toContain(pkg.conf.curModel);
  expect(Object.keys(pkg.decks)).toContain(String(pkg.conf.curDeck));
  expect(pkg.conf.activeDecks).toContain(pkg.conf.curDeck);
  expect(pkg.dconf["1"]).toMatchObject({ id: 1, name: "Default" });
  expect(pkg.dconf["1"]?.new.perDay).toBeGreaterThan(0);
  expect(pkg.dconf["1"]?.rev.perDay).toBeGreaterThan(0);
  expect(pkg.dconf["1"]?.lapse.delays.length).toBeGreaterThan(0);
  expect(pkg.decks["1"]).toMatchObject({ id: 1, name: "Default", conf: 1, dyn: 0 });
  expect(pkg.revlogCount).toBe(0);
  expect(pkg.gravesCount).toBe(0);
  for (const row of pkg.storage) {
    expect(row).toEqual({ noteId: "integer", cardId: "integer", csum: "integer", mid: "integer" });
  }
}

export function checkNoteTypes(pkg: ParsedApkg, noteTypes: readonly NoteTypeDef[]): void {
  expect(Object.keys(pkg.models).sort()).toEqual(noteTypes.map((type) => String(type.id)).sort());
  for (const type of noteTypes) {
    const model = pkg.models[String(type.id)];
    expect(model).toMatchObject({
      id: type.id,
      name: type.name,
      type: type.kind === "cloze" ? 1 : 0,
      usn: -1,
      sortf: type.sortField ?? 0,
      css: type.css,
    });
    expect(model?.mod).toBeGreaterThan(0);
    expect(model?.flds.map(({ name, ord }) => ({ name, ord }))).toEqual(
      type.fields.map((field, ord) => ({ name: field.name, ord })),
    );
    for (const field of model?.flds ?? []) {
      expect(field).toMatchObject({ sticky: false, rtl: false, font: "Arial", size: 20 });
    }
    expect(model?.tmpls.map(({ name, ord, qfmt, afmt }) => ({ name, ord, qfmt, afmt }))).toEqual(
      type.templates.map((template, ord) => ({ ...template, ord })),
    );
    for (const template of model?.tmpls ?? []) {
      expect(template).toMatchObject({ bqfmt: "", bafmt: "", did: null });
    }
    expect(model?.latexPre).toContain("\\begin{document}");
    expect(model?.latexPost).toBe("\\end{document}");
    expect(model?.req.map(([ord]) => ord)).toEqual(type.templates.map((_template, ord) => ord));
  }
}

export function checkDecks(pkg: ParsedApkg, decks: readonly DeckDef[]): void {
  const byName = new Map(Object.values(pkg.decks).map((deck) => [deck.name, deck]));
  for (const deck of decks) {
    expect(pkg.decks[String(deck.id)]).toMatchObject({ id: deck.id, name: deck.name });
    const parts = deck.name.split("::");
    for (let depth = 1; depth < parts.length; depth++) {
      expect(byName.has(parts.slice(0, depth).join("::"))).toBe(true);
    }
  }
  for (const [key, deck] of Object.entries(pkg.decks)) {
    expect(String(deck.id)).toBe(key);
    expect(deck).toMatchObject({ usn: -1, collapsed: false, desc: "", dyn: 0, conf: 1 });
    expect(deck.mod).toBeGreaterThan(0);
    for (const today of [deck.newToday, deck.revToday, deck.lrnToday, deck.timeToday]) {
      expect(today).toEqual([0, 0]);
    }
  }
}

function formatTags(tags: readonly string[]): string {
  const normalized = [...new Set(tags.map((tag) => tag.trim().replace(/\s+/g, "_")))];
  return normalized.length ? ` ${normalized.join(" ")} ` : "";
}

export function checkNotes(pkg: ParsedApkg, input: ApkgInput): void {
  expect(pkg.notes).toHaveLength(input.notes.length);
  expect(new Set(pkg.notes.map((row) => row.id)).size).toBe(pkg.notes.length);
  expect(new Set(pkg.notes.map((row) => row.guid)).size).toBe(pkg.notes.length);
  for (const note of input.notes) {
    const type = input.noteTypes.find((candidate) => candidate.id === note.noteTypeId);
    const row = findNote(pkg, note);
    expect(row).toMatchObject({
      mid: note.noteTypeId,
      usn: -1,
      tags: formatTags(note.tags),
      flags: 0,
      data: "",
    });
    expect(row.guid).not.toBe("");
    expect(row.mod).toBeGreaterThan(0);
    expect(row.sfld).toBe(expectedStripped(note.fields[type?.sortField ?? 0] ?? ""));
    expect(row.csum).toBe(expectedChecksum(note.fields[0] ?? ""));
  }
}

export function checkCards(pkg: ParsedApkg, input: ApkgInput, expectedOrds: number[][]): void {
  expect(pkg.cards).toHaveLength(expectedOrds.flat().length);
  expect(new Set(pkg.cards.map((card) => card.id)).size).toBe(pkg.cards.length);
  expect(new Set(pkg.cards.map((card) => card.due)).size).toBe(pkg.cards.length);
  input.notes.forEach((note, index) => {
    const row = findNote(pkg, note);
    const cards = pkg.cards.filter((card) => card.nid === row.id);
    expect(cards.map((card) => card.ord).sort((a, b) => a - b)).toEqual(expectedOrds[index]);
    for (const card of cards) {
      expect(card).toMatchObject({ did: note.deckId, usn: -1, type: 0, queue: 0 });
      expect(card.due).toBeGreaterThan(0);
    }
  });
}

export function checkMedia(pkg: ParsedApkg, media: readonly MediaDef[]): void {
  expect(pkg.media).toEqual(Object.fromEntries(media.map((item, index) => [index, item.name])));
  media.forEach((item, index) => {
    expect(pkg.files[String(index)]).toEqual(item.data);
  });
  const numbered = Object.keys(pkg.files).filter((name) => /^\d+$/.test(name));
  expect(numbered).toHaveLength(media.length);
}

export function checkPackage(pkg: ParsedApkg, input: ApkgInput, expectedOrds: number[][]): void {
  checkCollection(pkg);
  checkNoteTypes(pkg, input.noteTypes);
  checkDecks(pkg, input.decks);
  checkNotes(pkg, input);
  checkCards(pkg, input, expectedOrds);
  checkMedia(pkg, input.media);
}

/** GUIDs per note (in input order): the same across builds, so re-imports update notes. */
export function guidsOf(pkg: ParsedApkg, input: ApkgInput): string[] {
  return input.notes.map((note) => findNote(pkg, note).guid);
}
