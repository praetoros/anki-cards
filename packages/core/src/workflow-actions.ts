import { and, asc, eq, inArray, ne } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tCoverageEntry,
  tJob,
  tReviewItem,
  tSession,
  tSource,
  tSourceUnit,
  type SessionScope,
  type TReviewItemS,
} from "./db/schema/index.ts";
import type { JobKind, JobStatus, SessionKind } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { ACTIVE_JOB_STATUSES, enqueueJob, updateJob } from "./jobs.ts";
import { createSession } from "./sessions.ts";
import { getSetting, providerForStage, type ProviderStage } from "./settings.ts";

const STAGE_FOR_JOB: Partial<Record<JobKind, ProviderStage>> = {
  synthesis: "synthesis",
  feedback: "feedback",
  enrichment: "enrichment",
  planning: "planning",
  generation: "generation",
  card_review: "feedback",
  chat: "chat",
};

function sameScope(a: SessionScope, b: SessionScope) {
  return a.kind === b.kind && [...a.topicIds].sort().join() === [...b.topicIds].sort().join();
}

/** The live session for this kind and scope, or a new one using the stage's provider setting. */
export async function ensureSession(
  db: TDb,
  input: {
    libraryId: string;
    kind: SessionKind;
    scope: SessionScope;
    title: string;
    jobKind: JobKind;
  },
) {
  const sessions = await db
    .select()
    .from(tSession)
    .where(
      and(
        eq(tSession.libraryId, input.libraryId),
        eq(tSession.kind, input.kind),
        ne(tSession.status, "archived"),
      ),
    );
  const found = sessions.find((s) => sameScope(s.scope, input.scope));
  if (found) return found;
  const provider = await providerForStage(
    db,
    STAGE_FOR_JOB[input.jobKind] ?? "default",
    input.libraryId,
  );
  return createSession(db, {
    libraryId: input.libraryId,
    kind: input.kind,
    title: input.title,
    scope: input.scope,
    provider: provider.provider,
    model: provider.model,
    effort: provider.effort,
  });
}

/** Extracted sources with their unit count and how many of those units have coverage. */
export async function sourceCoverage(db: TDb, libraryId: string) {
  const sources = await db
    .select()
    .from(tSource)
    .where(and(eq(tSource.libraryId, libraryId), eq(tSource.extractionStatus, "extracted")));
  const out = [];
  for (const s of sources) {
    const units = await db
      .select({ id: tSourceUnit.id })
      .from(tSourceUnit)
      .where(eq(tSourceUnit.sourceId, s.id));
    if (units.length === 0) continue;
    const entries = await db
      .select({ unitId: tCoverageEntry.sourceUnitId })
      .from(tCoverageEntry)
      .where(
        inArray(
          tCoverageEntry.sourceUnitId,
          units.map((u) => u.id),
        ),
      );
    out.push({ ...s, units: units.length, covered: new Set(entries.map((e) => e.unitId)).size });
  }
  return out;
}

/** Sources that have units without any coverage entry yet. */
export async function unsynthesisedSources(db: TDb, libraryId: string) {
  return (await sourceCoverage(db, libraryId)).filter((s) => s.covered < s.units);
}

/**
 * Queues a synthesis job. By default it takes the sources with uncovered units; `again` also
 * accepts fully covered sources, which the AI re-reads against the existing library.
 */
export async function startSynthesis(
  db: TDatabase,
  libraryId: string,
  sourceIds?: string[],
  options: { again?: boolean } = {},
) {
  const candidates = options.again
    ? await sourceCoverage(db, libraryId)
    : await unsynthesisedSources(db, libraryId);
  const selected = sourceIds?.length
    ? candidates.filter((s) => sourceIds.includes(s.id))
    : candidates;
  if (selected.length === 0)
    throw new DomainError("invalid", "Every extracted source is already covered.");
  const again = selected.some((s) => s.covered > 0);
  const session = await ensureSession(db, {
    libraryId,
    kind: "ingest",
    scope: { kind: "library", topicIds: [] },
    title: "Ingest",
    jobKind: "synthesis",
  });
  const list = selected
    .map(
      (s) =>
        `- ${s.displayId} "${s.title}" (${s.fileType}, ${s.units} units, ${s.covered} already covered)`,
    )
    .join("\n");
  return enqueueJob(db, {
    sessionId: session.id,
    kind: "synthesis",
    trigger: "button",
    prompt: `Synthesise these sources into the library, following the synthesis instructions.\n\n${list}\n\nWork through every source unit. Merge with existing topics and concepts where the meaning matches; do not duplicate.${
      again
        ? " Some units are already covered: re-read them against the existing knowledge items, correct or complete those items in place, and add only what is missing. Do not change items the user edited without raising a review item."
        : ""
    } When finished, call complete_job.`,
  });
}

/**
 * Sends review items waiting for the AI to the session that owns their topic (the ingest
 * session when no topic session exists). Merges into a queued feedback job when there is one.
 */
export async function sendFeedback(
  db: TDatabase,
  libraryId: string,
  reviewItemIds?: string[],
  trigger: "button" | "auto" = "button",
) {
  const items = await db
    .select()
    .from(tReviewItem)
    .where(
      and(
        eq(tReviewItem.libraryId, libraryId),
        eq(tReviewItem.status, "awaiting_ai"),
        reviewItemIds?.length ? inArray(tReviewItem.id, reviewItemIds) : undefined,
      ),
    );
  const withAi = await reviewItemsWithAi(db, libraryId, ["running", "waiting", "paused"]);
  const unsent = items.filter((i) => !withAi.has(i.id));
  if (items.length > 0 && unsent.length === 0)
    throw new DomainError("conflict", "The AI is already working on these items.");
  if (unsent.length === 0)
    throw new DomainError("invalid", "No review items are waiting for the AI.");
  return queueFeedback(db, libraryId, unsent, trigger);
}

/** Review items handed to a feedback job that has not finished (by default including queued). */
export async function reviewItemsWithAi(
  db: TDb,
  libraryId: string,
  statuses: JobStatus[] = ACTIVE_JOB_STATUSES,
) {
  const jobs = await db
    .select({ ids: tJob.reviewItemIds })
    .from(tJob)
    .where(
      and(eq(tJob.libraryId, libraryId), eq(tJob.kind, "feedback"), inArray(tJob.status, statuses)),
    );
  return new Set(jobs.flatMap((j) => j.ids));
}

async function queueFeedback(
  db: TDatabase,
  libraryId: string,
  items: TReviewItemS[],
  trigger: "button" | "auto",
) {
  const sessions = await db
    .select()
    .from(tSession)
    .where(
      and(
        eq(tSession.libraryId, libraryId),
        eq(tSession.kind, "topic"),
        ne(tSession.status, "archived"),
      ),
    );
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const owner = item.topicId
      ? sessions.find((s) => s.scope.topicIds.includes(item.topicId!))
      : undefined;
    const sessionId =
      owner?.id ??
      (
        await ensureSession(db, {
          libraryId,
          kind: "ingest",
          scope: { kind: "library", topicIds: [] },
          title: "Ingest",
          jobKind: "feedback",
        })
      ).id;
    groups.set(sessionId, [...(groups.get(sessionId) ?? []), item.id]);
  }
  const jobs = [];
  for (const [sessionId, ids] of groups) {
    const [queued] = await db
      .select()
      .from(tJob)
      .where(
        and(eq(tJob.sessionId, sessionId), eq(tJob.kind, "feedback"), eq(tJob.status, "queued")),
      );
    const labels = items.filter((i) => ids.includes(i.id)).map((i) => `${i.displayId} ${i.title}`);
    if (queued) {
      const merged = [...new Set([...queued.reviewItemIds, ...ids])];
      jobs.push(await updateJob(db, queued.id, { reviewItemIds: merged }));
      continue;
    }
    jobs.push(
      await enqueueJob(db, {
        sessionId,
        kind: "feedback",
        trigger,
        reviewItemIds: ids,
        prompt: `Process the user's feedback on these review items:\n${labels.map((l) => `- ${l}`).join("\n")}\n\nFor each one: read it with get_review_item, make the change it asks for, then reply_to_review_item saying what you changed. Then call complete_job.`,
      }),
    );
  }
  return jobs;
}

const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** With automatic triggering on, feedback is sent once the user has paused for a while. */
export async function scheduleAutoFeedback(db: TDatabase, libraryId: string) {
  if (!(await getSetting(db, "jobs.autoTrigger", libraryId))) return;
  const delay = (await getSetting(db, "jobs.autoSendDelaySec")) * 1000;
  clearTimeout(autoTimers.get(libraryId));
  autoTimers.set(
    libraryId,
    setTimeout(() => {
      autoTimers.delete(libraryId);
      void sendFeedback(db, libraryId, undefined, "auto").catch(() => undefined);
    }, delay),
  );
}

/** A chat message becomes a job in the library's chat session, with the same tools and rules. */
export async function sendChatMessage(
  db: TDatabase,
  libraryId: string,
  text: string,
  context?: string,
) {
  const message = text.trim();
  if (!message) throw new DomainError("invalid", "Write a message.");
  const session = await ensureSession(db, {
    libraryId,
    kind: "chat",
    scope: { kind: "library", topicIds: [] },
    title: "Library chat",
    jobKind: "chat",
  });
  const prompt = context ? `${message}\n\n(The user is looking at: ${context})` : message;
  return enqueueJob(db, { sessionId: session.id, kind: "chat", trigger: "chat", prompt });
}

export async function chatHistory(db: TDb, libraryId: string, limit = 30) {
  const sessions = await db
    .select()
    .from(tSession)
    .where(and(eq(tSession.libraryId, libraryId), eq(tSession.kind, "chat")));
  if (sessions.length === 0) return [];
  return db
    .select()
    .from(tJob)
    .where(
      and(
        inArray(
          tJob.sessionId,
          sessions.map((s) => s.id),
        ),
        eq(tJob.kind, "chat"),
      ),
    )
    .orderBy(asc(tJob.createdAt))
    .limit(limit);
}
