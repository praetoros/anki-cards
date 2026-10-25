import { and, eq, inArray } from "drizzle-orm";

import { cardPlanView, listCards } from "./cards.ts";
import type { TDb } from "./db/client.ts";
import { tJob, tReviewItem, tSession, tSource } from "./db/schema/index.ts";
import { WORKFLOW_STEPS, type JobKind, type WorkflowStepId } from "./domain/enums.ts";
import { listExports } from "./export.ts";
import { gateStatus } from "./gates.ts";
import { ACTIVE_JOB_STATUSES } from "./jobs.ts";
import { libraryOutline } from "./knowledge.ts";
import { latestSnapshot } from "./snapshots.ts";
import { reviewItemsWithAi, sourceCoverage } from "./workflow-actions.ts";

export interface TopicProgress {
  id: string;
  displayId: string;
  title: string;
  plan: "draft" | "approved" | null;
  planRows: number;
  cards: number;
  drafts: number;
  setApprovedAt: string | null;
  /** A planning or generation job queued or running for this topic. */
  activeJob: JobKind | null;
}

export interface LibraryProgress {
  sources: {
    total: number;
    extracting: number;
    failed: number;
    extracted: number;
    /** Extracted sources with units the library does not cover yet. */
    pending: { displayId: string; covered: number; units: number }[];
  };
  knowledge: { topics: number; concepts: number; knowledgeItems: number };
  /** `awaitingAi` counts items not yet handed to a feedback job; `withAi` those already sent. */
  review: { open: number; decisions: number; awaitingAi: number; withAi: number };
  /** Kinds of library-wide jobs (synthesis, feedback, enrichment) queued or running. */
  activeJobs: JobKind[];
  synthesis: { approvedAt: string | null; blockers: string[] };
  topics: TopicProgress[];
  lastExport: { at: string; total: number } | null;
}

export type NextStepAction =
  | { kind: "link"; to: string; label: string }
  | { kind: "intent"; intent: string; label: string };

export interface NextStep {
  step: WorkflowStepId;
  title: string;
  detail: string;
  /** Null while the AI is working and the user only has to wait. */
  action: NextStepAction | null;
  /** Set when every step is complete. */
  done?: true;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function topicStep(t: TopicProgress): NextStep {
  const cardsLink = (label: string): NextStepAction => ({
    kind: "link",
    to: `cards?topic=${t.id}`,
    label,
  });
  if (t.activeJob === "planning")
    return {
      step: "cards",
      title: `The AI is planning cards for ${t.title}`,
      detail: "The plan appears on the Cards page when it is ready.",
      action: null,
    };
  if (t.activeJob === "generation")
    return {
      step: "cards",
      title: `The AI is writing cards for ${t.title}`,
      detail: "Cards appear on the Cards page as they are written.",
      action: null,
    };
  if (!t.plan)
    return {
      step: "cards",
      title: `Plan the cards for ${t.title}`,
      detail: "The AI proposes which notes to make from the approved knowledge.",
      action: cardsLink("Plan cards"),
    };
  if (t.plan === "draft")
    return {
      step: "cards",
      title: `Review the card plan for ${t.title}`,
      detail: `Accept or reject the ${plural(t.planRows, "planned note")}, then approve the plan.`,
      action: cardsLink("Review plan"),
    };
  if (t.cards === 0)
    return {
      step: "cards",
      title: `Generate the cards for ${t.title}`,
      detail: "The AI writes a card for each accepted row of the plan.",
      action: cardsLink("Generate cards"),
    };
  if (t.drafts > 0)
    return {
      step: "cards",
      title: `Review ${plural(t.drafts, "draft card")} for ${t.title}`,
      detail: "Edit, send feedback on, or approve each card.",
      action: cardsLink("Review cards"),
    };
  return {
    step: "cards",
    title: `Approve the card set for ${t.title}`,
    detail: "Every card is approved; approving the set makes it part of the next export.",
    action: cardsLink("Approve card set"),
  };
}

/** The one thing the user should do next, or what the AI is doing while they wait. */
export function nextStep(p: LibraryProgress): NextStep {
  const { sources, review } = p;
  if (sources.total === 0)
    return {
      step: "sources",
      title: "Add your lecture files",
      detail: "Slides, PDFs, documents and images. Text and pictures are extracted locally.",
      action: { kind: "link", to: "sources", label: "Add sources" },
    };
  if (sources.extracting > 0)
    return {
      step: "sources",
      title: "Extracting your sources",
      detail: "Text and images are being read from the files.",
      action: null,
    };
  if (sources.extracted === 0)
    return {
      step: "sources",
      title: "Extraction failed",
      detail: "Open Sources to see what went wrong, then upload the file again.",
      action: { kind: "link", to: "sources", label: "Open sources" },
    };
  if (p.activeJobs.includes("synthesis"))
    return {
      step: "synthesis",
      title: "The AI is synthesising your sources",
      detail: "Topics and knowledge items appear as they are written. Follow it under AI sessions.",
      action: null,
    };
  if (sources.pending.length > 0)
    return {
      step: "synthesis",
      title: `Synthesise ${plural(sources.pending.length, "source")}`,
      detail:
        "The AI reads every slide and builds a knowledge library: topics, concepts and facts with their evidence.",
      action: {
        kind: "intent",
        intent: "synthesise",
        label: `Synthesise ${plural(sources.pending.length, "source")}`,
      },
    };
  if (p.activeJobs.includes("feedback") || p.activeJobs.includes("enrichment"))
    return {
      step: "review",
      title: "The AI is working on your feedback",
      detail: "Its replies appear on each review item.",
      action: null,
    };
  if (review.awaitingAi > 0)
    return {
      step: "review",
      title: `Send ${plural(review.awaitingAi, "item")} to the AI`,
      detail: "Your feedback is waiting for the AI to act on it.",
      action: {
        kind: "intent",
        intent: "send-feedback",
        label: `Send ${plural(review.awaitingAi, "item")} to the AI`,
      },
    };
  if (review.open > 0)
    return {
      step: "review",
      title: `Review ${plural(review.open, "open item")}`,
      detail:
        review.decisions > 0
          ? `${plural(review.decisions, "item")} ${review.decisions === 1 ? "needs" : "need"} a decision before ${
              p.synthesis.approvedAt ? "the cards can be approved" : "the synthesis can be approved"
            }. Accept a suggestion or give feedback.`
          : "Accept each suggestion or give feedback.",
      action: { kind: "link", to: "review", label: "Open review" },
    };
  if (!p.synthesis.approvedAt)
    return {
      step: "approve",
      title: "Approve the synthesis",
      detail: "Fixes this version of the knowledge library; cards are planned from it.",
      action: { kind: "intent", intent: "approve-synthesis", label: "Approve synthesis" },
    };
  const unplanned = p.topics.filter((t) => !t.plan && !t.activeJob);
  if (unplanned.length > 1)
    return {
      step: "cards",
      title: `Plan the cards for ${plural(unplanned.length, "topic")}`,
      detail: "The AI proposes which notes to make from each topic's approved knowledge.",
      action: {
        kind: "intent",
        intent: "plan-all",
        label: `Plan ${plural(unplanned.length, "topic")}`,
      },
    };
  const topic = p.topics.find((t) => !t.setApprovedAt || t.activeJob);
  if (topic) return topicStep(topic);
  const exportedAt = p.lastExport?.at ?? "";
  if (p.topics.some((t) => (t.setApprovedAt ?? "") > exportedAt))
    return {
      step: "export",
      title: "Export the deck",
      detail: "Builds one .apkg with every approved card set, ready to import into Anki.",
      action: { kind: "link", to: "export", label: "Open export" },
    };
  return {
    step: "export",
    title: "Everything is exported",
    detail:
      "Import the .apkg into Anki. After changes, export again: Anki updates the notes it already has.",
    action: { kind: "link", to: "export", label: "Open exports" },
    done: true,
  };
}

export type StepState = "done" | "current" | "todo";

/**
 * Whether each step is done, the current one, or still to come. Steps are judged on their own,
 * so a review item raised while making cards reopens Review without undoing the approval.
 */
export function stepStates(p: LibraryProgress): Record<WorkflowStepId, StepState> {
  const next = nextStep(p);
  const exportedAt = p.lastExport?.at ?? "";
  const cardsDone =
    p.topics.length > 0 && p.topics.every((t) => t.setApprovedAt !== null && !t.activeJob);
  const done: Record<WorkflowStepId, boolean> = {
    sources: p.sources.extracted > 0 && p.sources.extracting === 0,
    synthesis:
      p.sources.extracted > 0 &&
      p.sources.pending.length === 0 &&
      !p.activeJobs.includes("synthesis"),
    review:
      p.review.open === 0 &&
      p.review.awaitingAi === 0 &&
      p.review.withAi === 0 &&
      !p.activeJobs.some((k) => k === "feedback" || k === "enrichment"),
    approve: p.synthesis.approvedAt !== null,
    cards: cardsDone,
    export:
      cardsDone &&
      p.lastExport !== null &&
      p.topics.every((t) => (t.setApprovedAt ?? "") <= exportedAt),
  };
  return Object.fromEntries(
    WORKFLOW_STEPS.map((s) => [
      s.id,
      s.id === next.step && !next.done ? "current" : done[s.id] ? "done" : "todo",
    ]),
  ) as Record<WorkflowStepId, StepState>;
}

export async function libraryProgress(db: TDb, libraryId: string): Promise<LibraryProgress> {
  const sources = await db.select().from(tSource).where(eq(tSource.libraryId, libraryId));
  const coverage = await sourceCoverage(db, libraryId);
  const outline = await libraryOutline(db, libraryId);
  const concepts = outline.flatMap((t) => t.subtopics.flatMap((s) => s.concepts));
  const withAi = await reviewItemsWithAi(db, libraryId);
  const review = await db
    .select({ id: tReviewItem.id, status: tReviewItem.status, category: tReviewItem.category })
    .from(tReviewItem)
    .where(
      and(
        eq(tReviewItem.libraryId, libraryId),
        inArray(tReviewItem.status, ["open", "awaiting_ai"]),
      ),
    );
  const jobs = await db
    .select({ kind: tJob.kind, scope: tSession.scope })
    .from(tJob)
    .innerJoin(tSession, eq(tSession.id, tJob.sessionId))
    .where(and(eq(tJob.libraryId, libraryId), inArray(tJob.status, ACTIVE_JOB_STATUSES)));
  const synthesis = await gateStatus(db, libraryId, "synthesis");
  const lastExport = (await listExports(db, libraryId))[0];
  const topics: TopicProgress[] = [];
  for (const t of outline.filter((x) => !x.excluded)) {
    const plan = await cardPlanView(db, t.id);
    const cards = (await listCards(db, t.id)).filter((c) => c.status !== "retired");
    topics.push({
      id: t.id,
      displayId: t.displayId,
      title: t.title,
      plan: plan?.plan.status === "approved" ? "approved" : plan ? "draft" : null,
      planRows: plan?.rows.length ?? 0,
      cards: cards.length,
      drafts: cards.filter((c) => c.status === "draft").length,
      setApprovedAt: (await latestSnapshot(db, libraryId, "card_set", t.id))?.createdAt ?? null,
      activeJob:
        jobs.find(
          (j) =>
            (j.kind === "planning" || j.kind === "generation") &&
            j.scope.kind === "topics" &&
            j.scope.topicIds.includes(t.id),
        )?.kind ?? null,
    });
  }
  return {
    sources: {
      total: sources.length,
      extracting: sources.filter(
        (s) => s.extractionStatus === "pending" || s.extractionStatus === "extracting",
      ).length,
      failed: sources.filter((s) => s.extractionStatus === "failed").length,
      extracted: sources.filter((s) => s.extractionStatus === "extracted").length,
      pending: coverage
        .filter((s) => s.covered < s.units)
        .map((s) => ({ displayId: s.displayId, covered: s.covered, units: s.units })),
    },
    knowledge: {
      topics: outline.length,
      concepts: concepts.length,
      knowledgeItems: concepts.reduce((n, c) => n + c.knowledgeItemCount, 0),
    },
    review: {
      open: review.filter((r) => r.status === "open").length,
      decisions: review.filter((r) => r.status === "open" && r.category === "requires_decision")
        .length,
      awaitingAi: review.filter((r) => r.status === "awaiting_ai" && !withAi.has(r.id)).length,
      withAi: review.filter((r) => r.status === "awaiting_ai" && withAi.has(r.id)).length,
    },
    activeJobs: [
      ...new Set(
        jobs
          .filter((j) => ["synthesis", "feedback", "enrichment"].includes(j.kind))
          .map((j) => j.kind),
      ),
    ],
    synthesis: { approvedAt: synthesis.snapshot?.createdAt ?? null, blockers: synthesis.blockers },
    topics,
    lastExport: lastExport ? { at: lastExport.createdAt, total: lastExport.counts.total } : null,
  };
}
