import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import { nowIso, ulid } from "./db/helpers.ts";
import { tJob, tJobEvent, type TJobS } from "./db/schema/index.ts";
import type { JobKind, JobStatus, JobTrigger } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { emitChange, emitJobEvent } from "./events.ts";
import { withWriteLock } from "./lock.ts";
import { getSession } from "./sessions.ts";

export const ACTIVE_JOB_STATUSES: JobStatus[] = ["queued", "running", "waiting", "paused"];

export async function enqueueJob(
  db: TDb,
  input: {
    sessionId: string;
    kind: JobKind;
    trigger: JobTrigger;
    prompt: string;
    reviewItemIds?: string[];
  },
): Promise<TJobS> {
  const session = await getSession(db, input.sessionId);
  if (session.status === "archived") {
    throw new DomainError("invalid", "This session is archived. Start a new session.");
  }
  const job = await withWriteLock(async () => {
    const [row] = await db
      .insert(tJob)
      .values({
        id: ulid("job"),
        libraryId: session.libraryId,
        sessionId: session.id,
        kind: input.kind,
        trigger: input.trigger,
        status: "queued",
        prompt: input.prompt,
        provider: session.provider,
        model: session.model,
        effort: session.effort,
        reviewItemIds: input.reviewItemIds ?? [],
      })
      .returning();
    if (!row) throw new Error("Failed to create job");
    return row;
  });
  emitChange({ libraryId: session.libraryId, tables: ["jobs"], changesetId: null });
  return job;
}

export async function getJob(db: TDb, id: string) {
  const [row] = await db.select().from(tJob).where(eq(tJob.id, id)).limit(1);
  if (!row) throw new DomainError("not_found", `Job ${id} not found.`);
  return row;
}

export async function updateJob(db: TDb, id: string, patch: Partial<Omit<TJobS, "id">>) {
  const row = await withWriteLock(async () => {
    const [r] = await db.update(tJob).set(patch).where(eq(tJob.id, id)).returning();
    return r;
  });
  if (row) emitChange({ libraryId: row.libraryId, tables: ["jobs"], changesetId: null });
  return row;
}

export async function listJobs(
  db: TDb,
  filter: { libraryId?: string; sessionId?: string; statuses?: JobStatus[]; limit?: number },
) {
  const conditions = [];
  if (filter.libraryId) conditions.push(eq(tJob.libraryId, filter.libraryId));
  if (filter.sessionId) conditions.push(eq(tJob.sessionId, filter.sessionId));
  if (filter.statuses) conditions.push(inArray(tJob.status, filter.statuses));
  return db
    .select()
    .from(tJob)
    .where(and(...conditions))
    .orderBy(desc(tJob.createdAt))
    .limit(filter.limit ?? 50);
}

/** Queued and waiting jobs that may be started now, oldest first. */
export async function startableJobs(db: TDb) {
  const now = nowIso();
  const rows = await db
    .select()
    .from(tJob)
    .where(inArray(tJob.status, ["queued", "waiting"]))
    .orderBy(asc(tJob.createdAt));
  return rows.filter((j) => !j.resumeAfter || j.resumeAfter <= now);
}

export async function addJobEvent(
  db: TDb,
  job: TJobS,
  type: string,
  data: Record<string, unknown>,
) {
  const row = await withWriteLock(async () => {
    const [r] = await db.insert(tJobEvent).values({ jobId: job.id, type, data }).returning();
    return r;
  });
  emitJobEvent({ jobId: job.id, sessionId: job.sessionId, libraryId: job.libraryId, type, data });
  return row;
}

export async function jobEvents(db: TDb, jobId: string, afterId = 0) {
  return db
    .select()
    .from(tJobEvent)
    .where(and(eq(tJobEvent.jobId, jobId), gt(tJobEvent.id, afterId)))
    .orderBy(asc(tJobEvent.id));
}
