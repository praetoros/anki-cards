import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync, type Zippable } from "fflate";

import { clozeNumbers } from "./cloze.ts";
import { fieldIsEmpty, stripHtmlPreservingMediaFilenames } from "./html.ts";
import { stableNumericId } from "./ids.ts";
import { parseTemplate, renderNodes, type TemplateNode } from "./template.ts";
import type { ApkgInput, DeckDef, NoteDef, NoteTypeDef } from "./types.ts";

// Anki's legacy collection schema (rslib/src/storage/schema11.sql), without its placeholder col row.
const SCHEMA = `
CREATE TABLE col (
  id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL,
  ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL,
  conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL,
  tags text NOT NULL
);
CREATE TABLE notes (
  id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL,
  usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL,
  csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE cards (
  id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL,
  mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL,
  due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
  lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL,
  flags integer NOT NULL, data text NOT NULL
);
CREATE TABLE revlog (
  id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL,
  ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL,
  type integer NOT NULL
);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

// Anki's defaults (rslib/src/notetype/header.tex).
const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";
const LATEX_POST = "\\end{document}";

const DEFAULT_DECK_ID = 1;

const DECK_CONFIG = {
  id: 1,
  name: "Default",
  mod: 0,
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  replayq: true,
  timer: 0,
  new: { perDay: 20, delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, bury: true, order: 1 },
  rev: { perDay: 200, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, ease4: 1.3, bury: true },
  lapse: { leechFails: 8, minInt: 1, delays: [10], leechAction: 0, mult: 0 },
};

const FIELD_SEPARATOR = "\u001f";

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

function assertId(id: number, label: string): void {
  if (!Number.isSafeInteger(id) || id <= 1) {
    throw new TypeError(`${label} must be a safe integer greater than 1, got ${id}`);
  }
}

function deckJson(id: number, name: string, mod: number) {
  return {
    id,
    name,
    mod,
    usn: -1,
    desc: "",
    dyn: 0,
    conf: 1,
    collapsed: false,
    browserCollapsed: false,
    extendNew: 0,
    extendRev: 0,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
}

/** Listed decks plus any missing parents, which get `stableNumericId("deck:<name>")`. */
function resolveDecks(decks: readonly DeckDef[]): Map<string, number> {
  const byName = new Map<string, number>();
  const ids = new Set<number>([DEFAULT_DECK_ID]);
  for (const deck of decks) {
    assertId(deck.id, `Deck id for "${deck.name}"`);
    if (deck.name.split("::").some((part) => !part.trim()) || hasControlChar(deck.name)) {
      throw new TypeError(`Invalid deck name "${deck.name}"`);
    }
    if (byName.has(deck.name) || ids.has(deck.id)) {
      throw new Error(`Duplicate deck "${deck.name}" (${deck.id})`);
    }
    byName.set(deck.name, deck.id);
    ids.add(deck.id);
  }
  for (const deck of decks) {
    const parts = deck.name.split("::");
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join("::");
      if (byName.has(parent)) continue;
      const id = stableNumericId(`deck:${parent}`);
      if (ids.has(id)) throw new Error(`Generated id for parent deck "${parent}" is already used`);
      byName.set(parent, id);
      ids.add(id);
    }
  }
  return byName;
}

interface PreparedNoteType {
  def: NoteTypeDef;
  questions: TemplateNode[][];
  clozeFields: number[];
}

function fieldRefs(nodes: readonly TemplateNode[], cloze: boolean, out = new Set<string>()) {
  for (const node of nodes) {
    if (node.kind === "field" && node.filters.includes("cloze") === cloze) out.add(node.name);
    if (node.kind === "section") fieldRefs(node.children, cloze, out);
  }
  return out;
}

function prepareNoteType(def: NoteTypeDef): PreparedNoteType {
  assertId(def.id, `Note type id for "${def.name}"`);
  const names = def.fields.map((field) => field.name);
  if (!names.length || new Set(names).size !== names.length) {
    throw new TypeError(`${def.name} needs unique field names`);
  }
  if (!def.templates.length) throw new TypeError(`${def.name} needs a template`);
  if (def.kind === "cloze" && def.templates.length !== 1) {
    throw new TypeError(`${def.name} is a cloze note type and needs exactly one template`);
  }
  const sortField = def.sortField ?? 0;
  if (!Number.isInteger(sortField) || sortField < 0 || sortField >= names.length) {
    throw new TypeError(`${def.name} has an invalid sortField`);
  }
  const questions = def.templates.map((template) => parseTemplate(template.qfmt));
  for (const nodes of [...questions, ...def.templates.map((t) => parseTemplate(t.afmt))]) {
    const refs = [...fieldRefs(nodes, true), ...fieldRefs(nodes, false)];
    const unknown = refs.find((name) => name !== "FrontSide" && !names.includes(name));
    if (unknown) throw new TypeError(`${def.name} template refers to unknown field "${unknown}"`);
  }
  const clozeFields = [...fieldRefs(questions[0] ?? [], true)].map((name) => names.indexOf(name));
  if (def.kind === "cloze" && (!clozeFields.length || clozeFields.includes(-1))) {
    throw new TypeError(`${def.name} needs {{cloze:Field}} on a known field in its question`);
  }
  return { def, questions, clozeFields };
}

function noteTypeJson({ def, questions }: PreparedNoteType, deckId: number, mod: number) {
  const names = def.fields.map((field) => field.name);
  return {
    id: def.id,
    name: def.name,
    type: def.kind === "cloze" ? 1 : 0,
    mod,
    usn: -1,
    sortf: def.sortField ?? 0,
    did: deckId,
    tmpls: def.templates.map((template, ord) => ({
      name: template.name,
      ord,
      qfmt: template.qfmt,
      afmt: template.afmt,
      bqfmt: "",
      bafmt: "",
      did: null,
      bfont: "",
      bsize: 0,
    })),
    flds: def.fields.map((field, ord) => ({
      name: field.name,
      ord,
      sticky: false,
      rtl: false,
      font: "Arial",
      size: 20,
      description: "",
      plainText: false,
      collapsed: false,
      excludeFromSearch: false,
      ...(field.tag === undefined ? {} : { tag: field.tag }),
      preventDeletion: field.preventDeletion ?? false,
      media: [],
    })),
    css: def.css,
    latexPre: LATEX_PRE,
    latexPost: LATEX_POST,
    latexsvg: false,
    req: questions.map((question, ord) => {
      const refs = [...fieldRefs(question, def.kind === "cloze")]
        .map((name) => names.indexOf(name))
        .filter((index) => index >= 0);
      return [ord, refs.length ? "any" : "none", refs];
    }),
    tags: [],
    vers: [],
    ...(def.originalStockKind === undefined ? {} : { originalStockKind: def.originalStockKind }),
  };
}

/** Card ords a note generates: Anki's rule is that the question must render non-empty. */
function cardOrds(type: PreparedNoteType, fields: readonly string[]): number[] {
  if (type.def.kind === "cloze") {
    const numbers = new Set<number>();
    for (const index of type.clozeFields) {
      for (const n of clozeNumbers(fields[index] ?? "")) numbers.add(n);
    }
    return [...numbers].sort((a, b) => a - b).map((n) => n - 1);
  }
  const names = type.def.fields.map((field) => field.name);
  const render = (values: readonly string[], question: TemplateNode[], cardOrd: number) =>
    renderNodes(question, {
      fields: new Map(names.map((name, index) => [name, values[index] ?? ""])),
      frontSide: undefined,
      cardOrd,
    });
  const blank = names.map(() => "");
  const nonEmpty = fields.map((field) => (fieldIsEmpty(field) ? "" : field));
  return type.questions.flatMap((question, ord) =>
    render(nonEmpty, question, ord) !== render(blank, question, ord) ? [ord] : [],
  );
}

function formatTags(tags: readonly string[]): string {
  const normalized = [...new Set(tags.map((tag) => tag.trim().replace(/\s+/g, "_")))].filter(
    Boolean,
  );
  return normalized.length ? ` ${normalized.join(" ")} ` : "";
}

/** Anki's `field_checksum`: the first 4 bytes of the SHA-1 of the stripped first field. */
function fieldChecksum(field: string): number {
  return createHash("sha1").update(field).digest().readUInt32BE(0);
}

function validateNote(note: NoteDef, type: PreparedNoteType | undefined, decks: Set<number>) {
  if (!note.guid) throw new TypeError("Note guid must not be empty");
  if (!type) throw new Error(`Note ${note.guid} uses unknown note type ${note.noteTypeId}`);
  if (!decks.has(note.deckId))
    throw new Error(`Note ${note.guid} uses unknown deck ${note.deckId}`);
  if (note.fields.length !== type.def.fields.length) {
    throw new TypeError(
      `Note ${note.guid} has ${note.fields.length} fields; ${type.def.name} has ${type.def.fields.length}`,
    );
  }
  if (note.fields.some((field) => field.includes("\u0000") || field.includes(FIELD_SEPARATOR))) {
    throw new TypeError(`Note ${note.guid} has a field containing NUL or the field separator`);
  }
}

function validateMedia(media: ApkgInput["media"]): void {
  const names = new Set<string>();
  for (const { name } of media) {
    if (!name.trim() || name.startsWith(".") || /[/\\:*?"<>|]/.test(name) || hasControlChar(name)) {
      throw new TypeError(`Media filename must be a plain filename: "${name}"`);
    }
    if (names.has(name)) throw new Error(`Duplicate media filename "${name}"`);
    names.add(name);
  }
}

/** Builds a legacy `.apkg` (schema-11 `collection.anki2`, `media` map and numbered files). */
export function buildApkg(input: ApkgInput): Uint8Array {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const decks = resolveDecks(input.decks);
  const deckIds = new Set(decks.values());
  const types = new Map<number, PreparedNoteType>();
  for (const def of input.noteTypes) {
    if (types.has(def.id)) throw new Error(`Duplicate note type id ${def.id}`);
    types.set(def.id, prepareNoteType(def));
  }
  validateMedia(input.media);
  const guids = new Set<string>();
  for (const note of input.notes) {
    validateNote(note, types.get(note.noteTypeId), deckIds);
    if (guids.has(note.guid)) throw new Error(`Duplicate note guid ${note.guid}`);
    guids.add(note.guid);
  }

  const firstDeck = input.decks[0]?.id ?? DEFAULT_DECK_ID;
  const decksJson: Record<string, ReturnType<typeof deckJson>> = {
    [DEFAULT_DECK_ID]: deckJson(DEFAULT_DECK_ID, "Default", now),
  };
  for (const [name, id] of decks) decksJson[id] = deckJson(id, name, now);
  const modelsJson = Object.fromEntries(
    [...types.values()].map((type) => [type.def.id, noteTypeJson(type, firstDeck, now)]),
  );

  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SCHEMA);
    db.exec("BEGIN");
    const insertNote = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const insertCard = db.prepare(
      "INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')",
    );
    let nextId = nowMs;
    let due = 1;
    for (const note of input.notes) {
      const type = types.get(note.noteTypeId);
      if (!type) continue;
      const ords = cardOrds(type, note.fields);
      if (!ords.length) throw new TypeError(`Note ${note.guid} generates no cards`);
      const noteId = nextId++;
      const sortField = note.fields[type.def.sortField ?? 0] ?? "";
      insertNote.run(
        noteId,
        note.guid,
        note.noteTypeId,
        now,
        formatTags(note.tags),
        note.fields.join(FIELD_SEPARATOR),
        stripHtmlPreservingMediaFilenames(sortField),
        fieldChecksum(stripHtmlPreservingMediaFilenames(note.fields[0] ?? "")),
      );
      for (const ord of ords) insertCard.run(nextId++, noteId, note.deckId, ord, now, due++);
    }
    const conf = {
      nextPos: due,
      estTimes: true,
      activeDecks: [firstDeck],
      sortType: "noteFld",
      timeLim: 0,
      sortBackwards: false,
      addToCur: true,
      curDeck: firstDeck,
      newSpread: 0,
      dueCounts: true,
      curModel: String(input.noteTypes[0]?.id ?? ""),
      collapseTime: 1200,
    };
    db.prepare("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')").run(
      now,
      nowMs,
      nowMs,
      JSON.stringify(conf),
      JSON.stringify(modelsJson),
      JSON.stringify(decksJson),
      JSON.stringify({ 1: DECK_CONFIG }),
    );
    db.exec("COMMIT");

    const files: Zippable = { "collection.anki2": db.serialize() };
    const mediaMap: Record<string, string> = {};
    input.media.forEach((item, index) => {
      mediaMap[index] = item.name;
      files[String(index)] = [item.data, { level: 0 }];
    });
    files.media = strToU8(JSON.stringify(mediaMap));
    return zipSync(files);
  } finally {
    db.close();
  }
}
