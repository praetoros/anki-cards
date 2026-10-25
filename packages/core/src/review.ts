import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tApproval,
  tConcept,
  tReviewItem,
  tReviewItemTarget,
  tReviewMessage,
  type ApprovalScope,
  type TrackedTableName,
  type TReviewItemS,
} from "./db/schema/index.ts";
import { nextDisplayId } from "./display-ids.ts";
import type {
  ApprovalKind,
  ReviewAction,
  ReviewCategory,
  ReviewKind,
  ReviewStatus,
} from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change, type ChangeContext, type Changes } from "./history.ts";
import { resolveRow } from "./resolve.ts";

export interface ReviewTarget {
  table: TrackedTableName;
  id: string;
}

/** Default category per kind; callers may raise the category but not lower decision kinds. */
export const KIND_CATEGORY: Record<ReviewKind, ReviewCategory> = {
  extraction_limitation: "recommended_review",
  interpretation: "recommended_review",
  contradiction: "requires_decision",
  correction: "requires_decision",
  gap: "recommended_review",
  enrichment_request: "requires_decision",
  visual_proposal: "requires_decision",
  duplicate_consolidated: "informational",
  card_issue: "recommended_review",
  card_plan: "requires_decision",
  feedback: "recommended_review",
  stage_gate: "requires_decision",
  job_failure: "recommended_review",
  repeated_tool_error: "requires_decision",
  untrusted_source: "requires_decision",
};

const DECISION_KINDS: ReviewKind[] = [
  "contradiction",
  "correction",
  "enrichment_request",
  "visual_proposal",
  "card_plan",
  "untrusted_source",
];

/** Suggestions for items the app raises itself, where no worker proposes one. */
const DEFAULT_SUGGESTION: Partial<Record<ReviewKind, string>> = {
  untrusted_source: "Keep the fact with this citation.",
  visual_proposal: "Embed this image in the proposed concepts with the stated attribution.",
  job_failure: "Ask the AI to look at what went wrong and finish the job.",
  repeated_tool_error: "Ask the AI to look at the error and finish the job another way.",
};

/** Accepting these needs no further AI work: the server applies them directly. */
const ACCEPT_WITHOUT_AI: ReviewKind[] = [
  "untrusted_source",
  "visual_proposal",
  "duplicate_consolidated",
  "stage_gate",
];

export async function raiseReviewItem(
  c: Changes,
  input: {
    libraryId: string;
    kind: ReviewKind;
    title: string;
    description?: string;
    suggestion?: string;
    category?: ReviewCategory;
    payload?: Record<string, unknown>;
    targets?: ReviewTarget[];
    topicId?: string | null;
    raisedBy: "user" | "ai" | "system";
  },
): Promise<TReviewItemS> {
  const category = DECISION_KINDS.includes(input.kind)
    ? "requires_decision"
    : (input.category ?? KIND_CATEGORY[input.kind]);
  const item = await c.insert(
    "review_items",
    {
      displayId: await nextDisplayId(c.tx, input.libraryId, "review_items"),
      kind: input.kind,
      category,
      status: category === "informational" ? "resolved" : "open",
      title: input.title,
      description: input.description ?? "",
      suggestion: input.suggestion?.trim() || DEFAULT_SUGGESTION[input.kind] || "",
      payload: input.payload ?? {},
      topicId: input.topicId ?? null,
      raisedBy: input.raisedBy,
    },
    input.libraryId,
  );
  for (const t of input.targets ?? []) {
    await c.insert(
      "review_item_targets",
      { reviewItemId: item.id, targetTable: t.table, targetId: t.id },
      input.libraryId,
    );
  }
  return item;
}

export async function listReviewItems(
  db: TDb,
  libraryId: string,
  filter: { statuses?: ReviewStatus[]; kinds?: ReviewKind[]; topicId?: string } = {},
) {
  const conditions = [eq(tReviewItem.libraryId, libraryId)];
  if (filter.statuses?.length) conditions.push(inArray(tReviewItem.status, filter.statuses));
  if (filter.kinds?.length) conditions.push(inArray(tReviewItem.kind, filter.kinds));
  if (filter.topicId) conditions.push(eq(tReviewItem.topicId, filter.topicId));
  return db
    .select()
    .from(tReviewItem)
    .where(and(...conditions))
    .orderBy(desc(tReviewItem.createdAt));
}

export async function reviewItemDetail(db: TDb, libraryId: string, idOrDisplay: string) {
  const item = await resolveRow(db, "review_items", libraryId, idOrDisplay);
  const targets = await db
    .select()
    .from(tReviewItemTarget)
    .where(eq(tReviewItemTarget.reviewItemId, item.id));
  const messages = await db
    .select()
    .from(tReviewMessage)
    .where(eq(tReviewMessage.reviewItemId, item.id))
    .orderBy(asc(tReviewMessage.createdAt));
  const approvals = await db.select().from(tApproval).where(eq(tApproval.reviewItemId, item.id));
  return { item, targets, messages, approvals };
}

function approvalFor(
  item: TReviewItemS,
): { kind: ApprovalKind; scope: ApprovalScope; purpose: string }[] {
  const p = item.payload;
  const conceptIds = Array.isArray(p["conceptIds"]) ? (p["conceptIds"] as string[]) : [];
  const subtopicId = typeof p["subtopicId"] === "string" ? p["subtopicId"] : undefined;
  const purpose = typeof p["purpose"] === "string" ? p["purpose"] : item.title;
  switch (item.kind) {
    case "enrichment_request": {
      const out: { kind: ApprovalKind; scope: ApprovalScope; purpose: string }[] = [
        { kind: "text_enrichment", scope: { conceptIds, subtopicId }, purpose },
      ];
      if (p["includeVisualSearch"] === true) {
        out.push({ kind: "visual_search", scope: { conceptIds, subtopicId }, purpose });
      }
      return out;
    }
    case "visual_proposal":
      return [{ kind: "visual_embed", scope: { conceptIds }, purpose }];
    case "correction":
    case "contradiction": {
      const kis = Array.isArray(p["knowledgeItemIds"]) ? (p["knowledgeItemIds"] as string[]) : [];
      return [{ kind: "correction", scope: { conceptIds, knowledgeItemIds: kis }, purpose }];
    }
    default:
      return [];
  }
}

const EXCLUDABLE: TrackedTableName[] = ["topics", "subtopics", "concepts", "knowledge_items"];

async function excludeTargets(c: Changes, reviewItemId: string) {
  const targets = await c.tx
    .select()
    .from(tReviewItemTarget)
    .where(eq(tReviewItemTarget.reviewItemId, reviewItemId));
  for (const t of targets) {
    const table = t.targetTable as TrackedTableName;
    if (EXCLUDABLE.includes(table)) await c.update(table, t.targetId, { excluded: true } as never);
  }
}

/** Approving a visual proposal embeds the downloaded image in the proposed concepts. */
async function embedProposedVisual(c: Changes, item: TReviewItemS) {
  const mediaId = item.payload["mediaId"];
  const conceptIds = item.payload["conceptIds"];
  if (typeof mediaId !== "string" || !Array.isArray(conceptIds)) return;
  for (const conceptId of conceptIds as string[]) {
    await c.insert("media_links", {
      mediaId,
      conceptId,
      knowledgeItemId: null,
      role: "contextual",
      component: "",
      rationale: typeof item.payload["purpose"] === "string" ? item.payload["purpose"] : "",
    });
  }
  await c.update("media_assets", mediaId, { relevance: "supporting" });
}

/**
 * Applies a user's decision. Approve, reject, defer and exclude are handled here;
 * correct and comment hand the item to the AI (status `awaiting_ai`).
 */
export async function actOnReviewItem(
  db: TDatabase,
  libraryId: string,
  idOrDisplay: string,
  input: { action: ReviewAction; message?: string; expectedVersion?: number },
) {
  const item = await resolveRow(db, "review_items", libraryId, idOrDisplay);
  const ctx: ChangeContext = {
    actor: "user",
    action: `review_${input.action}`,
    libraryId,
    reviewItemId: item.id,
  };
  const message = input.message?.trim() ?? "";
  if ((input.action === "correct" || input.action === "comment") && !message) {
    throw new DomainError("invalid", "Write what you want changed.");
  }
  const acceptNeedsAi =
    input.action === "accept" && Boolean(item.suggestion) && !ACCEPT_WITHOUT_AI.includes(item.kind);
  const { result } = await change(db, ctx, async (c) => {
    if (message || input.action !== "comment") {
      await c.insert("review_messages", {
        reviewItemId: item.id,
        author: "user",
        action: input.action,
        body:
          input.action === "accept"
            ? [`Accepted the suggested resolution: ${item.suggestion}`, message]
                .filter(Boolean)
                .join("\n\n")
            : message,
        processed:
          input.action === "correct" || input.action === "comment" || acceptNeedsAi
            ? "pending"
            : "n/a",
      });
    }
    switch (input.action) {
      case "accept":
        for (const a of approvalFor(item)) {
          await c.insert("approvals", {
            reviewItemId: item.id,
            kind: a.kind,
            scope: a.scope,
            purpose: a.purpose,
            status: "active",
          });
        }
        if (item.kind === "visual_proposal") await embedProposedVisual(c, item);
        return c.update(
          "review_items",
          item.id,
          {
            status:
              acceptNeedsAi || (approvalFor(item).length > 0 && item.kind !== "visual_proposal")
                ? "awaiting_ai"
                : "resolved",
            resolution: "suggestion accepted",
          },
          input.expectedVersion,
        );
      case "approve":
        for (const a of approvalFor(item)) {
          await c.insert("approvals", {
            reviewItemId: item.id,
            kind: a.kind,
            scope: a.scope,
            purpose: a.purpose,
            status: "active",
          });
        }
        if (item.kind === "visual_proposal") await embedProposedVisual(c, item);
        return c.update(
          "review_items",
          item.id,
          {
            status:
              approvalFor(item).length > 0 && item.kind !== "visual_proposal"
                ? "awaiting_ai"
                : "resolved",
            resolution: "approved",
          },
          input.expectedVersion,
        );
      case "reject":
        if (item.kind === "untrusted_source") await excludeTargets(c, item.id);
        return c.update("review_items", item.id, { status: "resolved", resolution: "rejected" });
      case "defer":
        return c.update("review_items", item.id, { status: "deferred", resolution: "deferred" });
      case "exclude": {
        await excludeTargets(c, item.id);
        return c.update("review_items", item.id, { status: "excluded", resolution: "excluded" });
      }
      case "correct":
      case "comment":
        return c.update("review_items", item.id, { status: "awaiting_ai" });
    }
  });
  return result;
}

/** The AI's answer on an item. `done` resolves it; `needs_user` hands it back. */
export async function aiReplyToReviewItem(
  db: TDatabase,
  ctx: ChangeContext & { libraryId: string },
  idOrDisplay: string,
  input: { body: string; outcome: "done" | "needs_user"; suggestion?: string },
) {
  const item = await resolveRow(db, "review_items", ctx.libraryId, idOrDisplay);
  const { result } = await change(db, { ...ctx, reviewItemId: item.id }, async (c) => {
    const pending = await c.tx
      .select()
      .from(tReviewMessage)
      .where(
        and(eq(tReviewMessage.reviewItemId, item.id), eq(tReviewMessage.processed, "pending")),
      );
    for (const m of pending) await c.update("review_messages", m.id, { processed: "processed" });
    await c.insert("review_messages", {
      reviewItemId: item.id,
      author: "ai",
      body: input.body,
      jobId: ctx.jobId ?? null,
    });
    const status: ReviewStatus = input.outcome === "done" ? "resolved" : "open";
    return c.update("review_items", item.id, {
      status,
      resolution: input.outcome === "done" ? "resolved by AI" : item.resolution,
      suggestion: input.suggestion?.trim() || item.suggestion,
    });
  });
  return result;
}

/** Active approvals of a kind covering a concept (directly or through its knowledge item). */
export async function activeApprovals(db: TDb, libraryId: string, kind: ApprovalKind) {
  return db
    .select()
    .from(tApproval)
    .where(
      and(
        eq(tApproval.libraryId, libraryId),
        eq(tApproval.kind, kind),
        eq(tApproval.status, "active"),
      ),
    );
}

export async function assertApproved(
  db: TDb,
  libraryId: string,
  kind: ApprovalKind,
  target: { conceptId: string; knowledgeItemId?: string },
  what: string,
) {
  const approvals = await activeApprovals(db, libraryId, kind);
  const ok = approvals.some((a) =>
    target.knowledgeItemId && a.scope.knowledgeItemIds?.length
      ? a.scope.knowledgeItemIds.includes(target.knowledgeItemId)
      : a.scope.conceptIds.includes(target.conceptId),
  );
  if (!ok) {
    const [concept] = await db.select().from(tConcept).where(eq(tConcept.id, target.conceptId));
    throw new DomainError(
      "not_approved",
      `${what} needs an approved ${kind.replace("_", " ")} for concept ${concept?.displayId ?? target.conceptId}. Raise a review item asking the user instead.`,
    );
  }
  return approvals;
}

/** User feedback on library content: a `feedback` item already waiting for the AI. */
/** Ids among `targetIds` that an open or AI-pending review item is about. */
export async function targetsWithOpenReview(db: TDb, targetIds: string[]) {
  if (targetIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ targetId: tReviewItemTarget.targetId })
    .from(tReviewItemTarget)
    .innerJoin(tReviewItem, eq(tReviewItem.id, tReviewItemTarget.reviewItemId))
    .where(
      and(
        inArray(tReviewItemTarget.targetId, targetIds),
        inArray(tReviewItem.status, ["open", "awaiting_ai"]),
      ),
    );
  return new Set(rows.map((r) => r.targetId));
}

export async function createFeedbackItem(
  db: TDatabase,
  libraryId: string,
  input: { target: ReviewTarget; title: string; message: string; topicId: string | null },
) {
  const message = input.message.trim();
  if (!message) throw new DomainError("invalid", "Write what you want changed.");
  const { result } = await change(
    db,
    { actor: "user", action: "give_feedback", libraryId },
    async (c) => {
      const item = await raiseReviewItem(c, {
        libraryId,
        kind: "feedback",
        title: input.title,
        targets: [input.target],
        topicId: input.topicId,
        raisedBy: "user",
      });
      await c.insert("review_messages", {
        reviewItemId: item.id,
        author: "user",
        action: "comment",
        body: message,
        processed: "pending",
      });
      return c.update("review_items", item.id, { status: "awaiting_ai" });
    },
  );
  return result;
}
