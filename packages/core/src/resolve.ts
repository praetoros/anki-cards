import { and, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { TDb } from "./db/client.ts";
import { trackedTables, type TrackedTableName } from "./db/schema/index.ts";
import { DomainError } from "./errors.ts";

type Row<N extends TrackedTableName> = (typeof trackedTables)[N]["$inferSelect"];

const LABEL: Partial<Record<TrackedTableName, string>> = {
  topics: "Topic",
  subtopics: "Subtopic",
  concepts: "Concept",
  knowledge_items: "Knowledge item",
  learning_objectives: "Learning objective",
  review_items: "Review item",
  source_units: "Source unit",
  media_assets: "Media",
  cards: "Card",
};

/**
 * Finds a row by long id (`con_…`) or per-library display id (`CON-013`) and checks it belongs
 * to the library.
 */
export async function resolveRow<N extends TrackedTableName>(
  db: TDb,
  table: N,
  libraryId: string,
  idOrDisplay: string,
): Promise<Row<N>> {
  const t = trackedTables[table] as unknown as SQLiteTable & Record<string, SQLiteColumn>;
  const key = idOrDisplay.trim();
  const byDisplay = /^[A-Z]+-\d+$/.test(key) && "displayId" in t;
  const column = byDisplay ? t["displayId"] : t["id"];
  if (!column) throw new DomainError("invalid", `Can't look up ${table} by ${key}.`);
  const rows = (await db
    .select()
    .from(t)
    .where(and(eq(column, key), eq(t["libraryId"] as SQLiteColumn, libraryId)))
    .limit(1)) as Row<N>[];
  const row = rows[0];
  if (!row)
    throw new DomainError(
      "not_found",
      `${LABEL[table] ?? table} ${key} not found in this library.`,
    );
  return row;
}

export async function resolveIds<N extends TrackedTableName>(
  db: TDb,
  table: N,
  libraryId: string,
  ids: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) out.push((await resolveRow(db, table, libraryId, id)).id as string);
  return out;
}
