import { trackedTables, type TDb, type TrackedTableName } from "@anki-cards/core";
import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

export interface TargetView {
  table: string;
  id: string;
  displayId: string;
  label: string;
  href: string | null;
}

function labelOf(row: Record<string, unknown>): string {
  for (const key of ["title", "statement", "text", "description", "fileName"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v.length > 90 ? `${v.slice(0, 90)}…` : v;
  }
  return "";
}

/** Display ids, labels and app links for review item targets and similar references. */
export async function describeTargets(
  db: TDb,
  libraryId: string,
  targets: { targetTable: string; targetId: string }[],
): Promise<TargetView[]> {
  const out: TargetView[] = [];
  for (const t of targets) {
    const table = trackedTables[t.targetTable as TrackedTableName] as unknown as
      | (SQLiteTable & Record<string, SQLiteColumn>)
      | undefined;
    if (!table?.["id"]) continue;
    const [row] = (await db
      .select()
      .from(table)
      .where(eq(table["id"], t.targetId))
      .limit(1)) as Record<string, unknown>[];
    const base = `/libraries/${libraryId}`;
    let href: string | null = null;
    if (row) {
      if (t.targetTable === "concepts") href = `${base}/knowledge?concept=${t.targetId}`;
      if (t.targetTable === "knowledge_items") {
        href = `${base}/knowledge?concept=${String(row["conceptId"])}#${String(row["displayId"])}`;
      }
      if (t.targetTable === "source_units") {
        href = `${base}/sources/${String(row["sourceId"])}#${String(row["displayId"])}`;
      }
      if (t.targetTable === "sources") href = `${base}/sources/${t.targetId}`;
      if (t.targetTable === "cards") href = `${base}/cards?card=${t.targetId}`;
    }
    out.push({
      table: t.targetTable,
      id: t.targetId,
      displayId: row
        ? typeof row["displayId"] === "string"
          ? row["displayId"]
          : t.targetId
        : `${t.targetId} (deleted)`,
      label: row ? labelOf(row) : "",
      href,
    });
  }
  return out;
}
