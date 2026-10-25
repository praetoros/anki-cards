import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { strFromU8, unzipSync } from "fflate";

export interface FieldJson {
  name: string;
  ord: number;
  sticky: boolean;
  rtl: boolean;
  font: string;
  size: number;
  tag?: number | null;
  preventDeletion?: boolean;
}

export interface TemplateJson {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  bqfmt: string;
  bafmt: string;
  did: number | null;
}

export interface ModelJson {
  id: number;
  name: string;
  type: number;
  mod: number;
  usn: number;
  sortf: number;
  did: number | null;
  tmpls: TemplateJson[];
  flds: FieldJson[];
  css: string;
  latexPre: string;
  latexPost: string;
  req: [number, string, number[]][];
  originalStockKind?: number;
}

export interface DeckJson {
  id: number;
  name: string;
  mod: number;
  usn: number;
  collapsed: boolean;
  desc: string;
  dyn: number;
  conf: number;
  newToday: [number, number];
  revToday: [number, number];
  lrnToday: [number, number];
  timeToday: [number, number];
}

export interface DeckConfigJson {
  id: number;
  name: string;
  new: { perDay: number };
  rev: { perDay: number };
  lapse: { delays: number[] };
}

export interface CollectionConf {
  nextPos: number;
  curModel: string;
  curDeck: number;
  activeDecks: number[];
}

export interface ColRow {
  id: number;
  crt: number;
  mod: number;
  scm: number;
  ver: number;
  dty: number;
  usn: number;
  ls: number;
  tags: string;
}

export interface NoteRow {
  id: number;
  guid: string;
  mid: number;
  mod: number;
  usn: number;
  tags: string;
  flds: string;
  sfld: string;
  csum: number;
  flags: number;
  data: string;
}

export interface CardRow {
  id: number;
  nid: number;
  did: number;
  ord: number;
  usn: number;
  type: number;
  queue: number;
  due: number;
}

export interface ParsedApkg {
  files: Record<string, Uint8Array>;
  /** Media map: numbered zip entry → filename. */
  media: Record<string, string>;
  tables: string[];
  col: ColRow;
  conf: CollectionConf;
  models: Record<string, ModelJson>;
  decks: Record<string, DeckJson>;
  dconf: Record<string, DeckConfigJson>;
  notes: NoteRow[];
  cards: CardRow[];
  revlogCount: number;
  gravesCount: number;
  /** SQLite storage classes, to check ids are stored as integers. */
  storage: { noteId: string; cardId: string; csum: string; mid: string }[];
  db: DatabaseSync;
}

type Row = Record<string, SQLOutputValue>;

function json<T>(value: SQLOutputValue): T {
  const parsed: unknown = JSON.parse(String(value));
  return parsed as T;
}

const num = (row: Row, key: string): number => Number(row[key]);
const str = (row: Row, key: string): string => String(row[key]);

export function parseApkg(bytes: Uint8Array): ParsedApkg {
  const files = unzipSync(bytes);
  const collection = files["collection.anki2"];
  const mediaFile = files["media"];
  if (!collection) throw new Error("Package has no collection.anki2");
  if (!mediaFile) throw new Error("Package has no media map");
  const db = new DatabaseSync(":memory:");
  db.deserialize(collection);
  const all = (sql: string): Row[] => db.prepare(sql).all();
  const colRow = all("SELECT * FROM col")[0];
  if (!colRow) throw new Error("col table is empty");
  return {
    files,
    media: JSON.parse(strFromU8(mediaFile)) as Record<string, string>,
    tables: all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) =>
      str(r, "name"),
    ),
    col: {
      id: num(colRow, "id"),
      crt: num(colRow, "crt"),
      mod: num(colRow, "mod"),
      scm: num(colRow, "scm"),
      ver: num(colRow, "ver"),
      dty: num(colRow, "dty"),
      usn: num(colRow, "usn"),
      ls: num(colRow, "ls"),
      tags: str(colRow, "tags"),
    },
    conf: json<CollectionConf>(colRow["conf"] ?? "{}"),
    models: json<Record<string, ModelJson>>(colRow["models"] ?? "{}"),
    decks: json<Record<string, DeckJson>>(colRow["decks"] ?? "{}"),
    dconf: json<Record<string, DeckConfigJson>>(colRow["dconf"] ?? "{}"),
    notes: all("SELECT * FROM notes ORDER BY id").map((r) => ({
      id: num(r, "id"),
      guid: str(r, "guid"),
      mid: num(r, "mid"),
      mod: num(r, "mod"),
      usn: num(r, "usn"),
      tags: str(r, "tags"),
      flds: str(r, "flds"),
      sfld: str(r, "sfld"),
      csum: num(r, "csum"),
      flags: num(r, "flags"),
      data: str(r, "data"),
    })),
    cards: all("SELECT * FROM cards ORDER BY id").map((r) => ({
      id: num(r, "id"),
      nid: num(r, "nid"),
      did: num(r, "did"),
      ord: num(r, "ord"),
      usn: num(r, "usn"),
      type: num(r, "type"),
      queue: num(r, "queue"),
      due: num(r, "due"),
    })),
    revlogCount: num(all("SELECT count(*) AS n FROM revlog")[0] ?? {}, "n"),
    gravesCount: num(all("SELECT count(*) AS n FROM graves")[0] ?? {}, "n"),
    storage: all(
      "SELECT typeof(n.id) AS noteId, typeof(c.id) AS cardId, typeof(n.csum) AS csum, typeof(n.mid) AS mid FROM notes n JOIN cards c ON c.nid = n.id",
    ).map((r) => ({
      noteId: str(r, "noteId"),
      cardId: str(r, "cardId"),
      csum: str(r, "csum"),
      mid: str(r, "mid"),
    })),
    db,
  };
}
