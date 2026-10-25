import { and, desc, eq, isNull } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import { ulid } from "./db/helpers.ts";
import { tSnapshot, type TrackedTableName } from "./db/schema/index.ts";
import type { Gate } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { latestChangesetSeq, rowsAt } from "./history.ts";
import { withWriteLock } from "./lock.ts";

export async function createSnapshot(
  db: TDb,
  input: { libraryId: string; gate: Gate; name: string; topicId?: string | null },
) {
  return withWriteLock(async () => {
    const seq = await latestChangesetSeq(db);
    const [snap] = await db
      .insert(tSnapshot)
      .values({
        id: ulid("snap"),
        libraryId: input.libraryId,
        gate: input.gate,
        topicId: input.topicId ?? null,
        name: input.name,
        changesetSeq: seq,
      })
      .returning();
    if (!snap) throw new Error("Failed to create snapshot");
    return snap;
  });
}

export async function listSnapshots(db: TDb, libraryId: string) {
  return db
    .select()
    .from(tSnapshot)
    .where(eq(tSnapshot.libraryId, libraryId))
    .orderBy(desc(tSnapshot.changesetSeq));
}

export async function getSnapshot(db: TDb, id: string) {
  const [snap] = await db.select().from(tSnapshot).where(eq(tSnapshot.id, id)).limit(1);
  if (!snap) throw new DomainError("not_found", `Snapshot ${id} not found.`);
  return snap;
}

export async function latestSnapshot(
  db: TDb,
  libraryId: string,
  gate: Gate,
  topicId?: string | null,
) {
  const [snap] = await db
    .select()
    .from(tSnapshot)
    .where(
      and(
        eq(tSnapshot.libraryId, libraryId),
        eq(tSnapshot.gate, gate),
        topicId ? eq(tSnapshot.topicId, topicId) : isNull(tSnapshot.topicId),
      ),
    )
    .orderBy(desc(tSnapshot.changesetSeq))
    .limit(1);
  return snap;
}

export async function snapshotRows<N extends TrackedTableName>(
  db: TDb,
  snapshotId: string,
  table: N,
) {
  const snap = await getSnapshot(db, snapshotId);
  return rowsAt(db, snap.libraryId, snap.changesetSeq, table);
}
