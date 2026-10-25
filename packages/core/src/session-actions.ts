import { and, desc, eq, inArray } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { tJob, tSessionSummary, tTopic, type TJobS } from "./db/schema/index.ts";
import { DomainError } from "./errors.ts";
import { change } from "./history.ts";
import { enqueueJob } from "./jobs.ts";
import { raiseReviewItem } from "./review.ts";
import { archiveSession, createSession, getSession } from "./sessions.ts";
import { providerForStage } from "./settings.ts";

/** Archives a session and opens a fresh one with the same scope, optionally from a summary. */
export async function replaceSession(db: TDb, sessionId: string, withSummary: boolean) {
  const old = await getSession(db, sessionId);
  const running = await db
    .select({ id: tJob.id })
    .from(tJob)
    .where(and(eq(tJob.sessionId, sessionId), inArray(tJob.status, ["running", "queued"])));
  if (running.length > 0)
    throw new DomainError("conflict", "Wait for this session's jobs to finish first.");
  await archiveSession(db, old.id);
  return createSession(db, {
    libraryId: old.libraryId,
    kind: old.kind,
    title: old.title,
    scope: old.scope,
    provider: old.provider,
    model: old.model,
    effort: old.effort,
    parentSessionId: withSummary ? old.id : null,
  });
}

export async function compactSession(db: TDb, sessionId: string) {
  const session = await getSession(db, sessionId);
  if (!session.cliSessionId)
    throw new DomainError("invalid", "This session has no conversation to compact yet.");
  return enqueueJob(db, {
    sessionId,
    kind: "compact",
    trigger: "button",
    prompt:
      "This session is being handed over to a fresh one. Write the handoff with save_session_summary: the decisions made, items still open, the user's stated preferences, and where work stopped. Be specific (display ids). Then call complete_job.",
  });
}

/** Called when a compact job finishes: the session is replaced by one that starts from its summary. */
export async function finishCompaction(db: TDb, job: TJobS) {
  const [summary] = await db
    .select()
    .from(tSessionSummary)
    .where(eq(tSessionSummary.sessionId, job.sessionId))
    .orderBy(desc(tSessionSummary.createdAt))
    .limit(1);
  if (!summary) return null;
  return replaceSession(db, job.sessionId, true);
}

export async function sessionSummaryFor(db: TDb, session: { parentSessionId: string | null }) {
  if (!session.parentSessionId) return null;
  const [summary] = await db
    .select()
    .from(tSessionSummary)
    .where(eq(tSessionSummary.sessionId, session.parentSessionId))
    .orderBy(desc(tSessionSummary.createdAt))
    .limit(1);
  return summary ?? null;
}

export async function editSessionSummary(
  db: TDatabase,
  libraryId: string,
  summaryId: string,
  body: string,
) {
  const { result } = await change(
    db,
    { actor: "user", action: "edit_session_summary", libraryId },
    (c) => c.update("session_summaries", summaryId, { body, edited: true }),
  );
  return result;
}

/** A session working on the given topics; created with the stage's provider when missing. */
export async function startTopicSession(db: TDb, libraryId: string, topicIds: string[]) {
  if (topicIds.length === 0) throw new DomainError("invalid", "Pick at least one topic.");
  const topics = await db.select().from(tTopic).where(inArray(tTopic.id, topicIds));
  const provider = await providerForStage(db, "feedback", libraryId);
  return createSession(db, {
    libraryId,
    kind: "topic",
    title: topics.map((t) => t.title).join(", "),
    scope: { kind: "topics", topicIds },
    provider: provider.provider,
    model: provider.model,
    effort: provider.effort,
  });
}

/** Turns a failed job into a review item so it shows up in the queue. */
export async function recordJobFailure(
  db: TDatabase,
  job: TJobS,
  repeated: boolean,
  error: string,
) {
  await change(
    db,
    { actor: "system", action: "job_failed", libraryId: job.libraryId, jobId: job.id },
    (c) =>
      raiseReviewItem(c, {
        libraryId: job.libraryId,
        kind: repeated ? "repeated_tool_error" : "job_failure",
        title: repeated
          ? `A ${job.kind} job kept hitting the same error`
          : `A ${job.kind} job failed`,
        description: error,
        payload: { jobId: job.id, sessionId: job.sessionId },
        raisedBy: "system",
      }),
  );
}
