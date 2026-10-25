import { and, eq, sql } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import { tDisplayCounter } from "./db/schema/index.ts";

export const DISPLAY_PREFIX = {
  sources: "SRC",
  source_units: "SU",
  media_assets: "MED",
  topics: "TOP",
  subtopics: "SUB",
  concepts: "CON",
  knowledge_items: "KI",
  learning_objectives: "LO",
  review_items: "R",
  cards: "CARD",
} as const;

export type DisplayTable = keyof typeof DISPLAY_PREFIX;

/** Next short per-library id such as `CON-013`. Call inside a changeset so it is serialised. */
export async function nextDisplayId(
  db: TDb,
  libraryId: string,
  table: DisplayTable,
): Promise<string> {
  const prefix = DISPLAY_PREFIX[table];
  const [row] = await db
    .insert(tDisplayCounter)
    .values({ libraryId, prefix, next: 2 })
    .onConflictDoUpdate({
      target: [tDisplayCounter.libraryId, tDisplayCounter.prefix],
      set: { next: sql`${tDisplayCounter.next} + 1` },
    })
    .returning();
  const n = (row?.next ?? 2) - 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

export async function peekDisplayCounter(db: TDb, libraryId: string, table: DisplayTable) {
  const [row] = await db
    .select()
    .from(tDisplayCounter)
    .where(
      and(
        eq(tDisplayCounter.libraryId, libraryId),
        eq(tDisplayCounter.prefix, DISPLAY_PREFIX[table]),
      ),
    );
  return row?.next ?? 1;
}
