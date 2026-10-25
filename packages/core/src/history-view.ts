import { and, count, desc, eq, inArray, lt } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import { tChangeset, tJob, tRowVersion } from "./db/schema/index.ts";
import { changesetDiff } from "./history.ts";

const SYSTEM_FIELDS = new Set(["version", "changesetId", "updatedAt", "createdAt"]);

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Changesets of a library, newest first, with how many rows each touched and its job kind. */
export async function changesetSummaries(
  db: TDb,
  libraryId: string,
  limit = 50,
  beforeSeq?: number,
) {
  const conditions = [eq(tChangeset.libraryId, libraryId)];
  if (beforeSeq) conditions.push(lt(tChangeset.seq, beforeSeq));
  const sets = await db
    .select()
    .from(tChangeset)
    .where(and(...conditions))
    .orderBy(desc(tChangeset.seq))
    .limit(limit);
  const ids = sets.map((s) => s.id);
  const counts = ids.length
    ? await db
        .select({ id: tRowVersion.changesetId, n: count() })
        .from(tRowVersion)
        .where(inArray(tRowVersion.changesetId, ids))
        .groupBy(tRowVersion.changesetId)
    : [];
  const jobIds = sets.map((s) => s.jobId).filter((j): j is string => Boolean(j));
  const jobs = jobIds.length
    ? await db.select({ id: tJob.id, kind: tJob.kind }).from(tJob).where(inArray(tJob.id, jobIds))
    : [];
  return sets.map((s) => ({
    ...s,
    rows: counts.find((c) => c.id === s.id)?.n ?? 0,
    jobKind: jobs.find((j) => j.id === s.jobId)?.kind ?? null,
  }));
}

/** Per-row field differences of one changeset, ignoring bookkeeping columns. */
export async function changesetFieldDiff(db: TDb, changesetId: string) {
  const rows = await changesetDiff(db, changesetId);
  return rows.map((r) => {
    const keys = new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})]);
    const changes: FieldChange[] = [];
    for (const key of keys) {
      if (SYSTEM_FIELDS.has(key)) continue;
      const before = r.before?.[key];
      const after = r.after?.[key];
      if (JSON.stringify(before) !== JSON.stringify(after))
        changes.push({ field: key, before, after });
    }
    const label = r.after ?? r.before ?? {};
    return {
      table: r.table,
      rowId: r.rowId,
      op: r.op,
      version: r.version,
      displayId: typeof label["displayId"] === "string" ? label["displayId"] : null,
      changes,
    };
  });
}
