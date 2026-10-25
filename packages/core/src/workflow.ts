import { and, count, eq, inArray } from "drizzle-orm";

import type { TDb } from "./db/client.ts";
import {
  tConcept,
  tKnowledgeItem,
  tReviewItem,
  tSessionSummary,
  tSource,
  tSubtopic,
  tTopic,
  type TJobS,
  type TSessionS,
} from "./db/schema/index.ts";
import type { JobKind } from "./domain/enums.ts";
import { getLibrary } from "./libraries.ts";

const NEXT_STEPS: Record<JobKind, string> = {
  ping: "Call complete_job with the summary 'pong'.",
  synthesis:
    "Synthesise the listed sources following the synthesis method. Read every source unit, build topics → subtopics → concepts → knowledge items with evidence, record coverage for every unit, map learning objectives, and raise review items for anything uncertain, contradictory or missing.",
  feedback:
    "Process each review item listed under pendingFeedback: read the user's messages, make the requested changes with the write tools, then reply_to_review_item explaining what you changed. Do not change anything the feedback does not ask for.",
  enrichment:
    "Research the approved scopes listed under activeApprovals. Add external knowledge items only inside those scopes, each with add_external_evidence (URL, title, publisher, exact passage).",
  planning:
    "Propose a card plan for the topic in scope with propose_card_plan, following the card settings (get_settings).",
  generation: "Generate cards for the accepted rows of the approved card plan with upsert_card.",
  card_review: "Process feedback on cards listed under pendingFeedback, then reply on each item.",
  chat: "Do what the user's message asks, within your scope and the approval rules.",
  compact:
    "Write a handoff summary of this session with save_session_summary: decisions, open items, the user's stated preferences and where work stopped. Then call complete_job.",
};

async function countOf(
  db: TDb,
  table: typeof tTopic | typeof tSource | typeof tReviewItem,
  libraryId: string,
) {
  const [row] = await db.select({ n: count() }).from(table).where(eq(table.libraryId, libraryId));
  return row?.n ?? 0;
}

export async function workflowState(db: TDb, session: TSessionS, job: TJobS) {
  const library = await getLibrary(db, session.libraryId);
  const [concepts] = await db
    .select({ n: count() })
    .from(tConcept)
    .where(eq(tConcept.libraryId, library.id));
  const [kis] = await db
    .select({ n: count() })
    .from(tKnowledgeItem)
    .where(eq(tKnowledgeItem.libraryId, library.id));
  const pending = await db
    .select({
      id: tReviewItem.id,
      displayId: tReviewItem.displayId,
      kind: tReviewItem.kind,
      title: tReviewItem.title,
    })
    .from(tReviewItem)
    .where(and(eq(tReviewItem.libraryId, library.id), eq(tReviewItem.status, "awaiting_ai")));
  const jobItems =
    job.reviewItemIds.length > 0
      ? pending.filter((p) => job.reviewItemIds.includes(p.id))
      : pending;
  const topics = await db
    .select({ id: tTopic.id, displayId: tTopic.displayId, title: tTopic.title })
    .from(tTopic)
    .where(
      session.scope.kind === "library"
        ? eq(tTopic.libraryId, library.id)
        : inArray(tTopic.id, session.scope.topicIds.length ? session.scope.topicIds : [""]),
    );
  const [subtopics] = await db
    .select({ n: count() })
    .from(tSubtopic)
    .where(eq(tSubtopic.libraryId, library.id));
  const [summary] = session.parentSessionId
    ? await db
        .select({ body: tSessionSummary.body })
        .from(tSessionSummary)
        .where(eq(tSessionSummary.sessionId, session.parentSessionId))
    : [];
  return {
    library: { id: library.id, name: library.name, description: library.description },
    session: {
      id: session.id,
      kind: session.kind,
      title: session.title,
      scope: session.scope,
      topics,
    },
    job: { id: job.id, kind: job.kind, task: job.prompt },
    previousSessionSummary: summary?.body ?? null,
    counts: {
      sources: await countOf(db, tSource, library.id),
      topics: await countOf(db, tTopic, library.id),
      subtopics: subtopics?.n ?? 0,
      concepts: concepts?.n ?? 0,
      knowledgeItems: kis?.n ?? 0,
      reviewItems: await countOf(db, tReviewItem, library.id),
    },
    pendingFeedback: jobItems,
    nextStep: NEXT_STEPS[job.kind],
  };
}
