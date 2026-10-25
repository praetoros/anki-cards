import {
  aiReplyToReviewItem,
  change,
  listReviewItems,
  raiseReviewItem,
  resolveRow,
  reviewItemDetail,
  REVIEW_CATEGORIES,
  REVIEW_KINDS,
  REVIEW_STATUSES,
  topicOf,
  type TrackedTableName,
} from "@anki-cards/core";
import { z } from "zod";

import { defineTool } from "../tool.ts";

const TARGET_TABLES = [
  "topics",
  "subtopics",
  "concepts",
  "knowledge_items",
  "source_units",
  "media_assets",
  "learning_objectives",
  "cards",
  "sources",
] as const;

export const listReviewItemsTool = defineTool({
  name: "list_review_items",
  description: "List review items, by default those waiting for you (awaiting_ai) and open ones.",
  input: z.object({ statuses: z.array(z.enum(REVIEW_STATUSES)).optional() }),
  readOnly: true,
  run: async ({ statuses }, ctx) =>
    (
      await listReviewItems(ctx.runtime.db, ctx.libraryId, {
        statuses: statuses ?? ["awaiting_ai", "open"],
      })
    ).map((i) => ({
      id: i.id,
      displayId: i.displayId,
      kind: i.kind,
      category: i.category,
      status: i.status,
      title: i.title,
    })),
});

export const getReviewItem = defineTool({
  name: "get_review_item",
  description:
    "A review item with its payload, targets, full message thread (the user's feedback) and approvals.",
  input: z.object({ reviewItemId: z.string() }),
  readOnly: true,
  run: (a, ctx) => reviewItemDetail(ctx.runtime.db, ctx.libraryId, a.reviewItemId),
});

export const replyToReviewItem = defineTool({
  name: "reply_to_review_item",
  description:
    "Answer the user on a review item after acting on it. outcome done resolves it; needs_user hands it back with your question and, in suggestion, a revised proposal the user can accept.",
  input: z.object({
    reviewItemId: z.string(),
    body: z.string().min(1),
    outcome: z.enum(["done", "needs_user"]),
    suggestion: z
      .string()
      .optional()
      .describe(
        "With needs_user: your revised proposal, replacing the item's suggested resolution",
      ),
  }),
  run: async (a, ctx) => {
    const item = await aiReplyToReviewItem(
      ctx.runtime.db,
      { ...ctx.change("reply_to_review_item"), libraryId: ctx.libraryId },
      a.reviewItemId,
      a,
    );
    return { displayId: item.displayId, status: item.status };
  },
});

export const raiseReviewItemTool = defineTool({
  name: "raise_review_item",
  description:
    "Ask the user to look at something: an extraction limitation, a tentative interpretation, a contradiction (with a proposed correction), a gap, an enrichment request (payload.conceptIds, purpose, missing, includeVisualSearch), a visual proposal, or a card issue.",
  input: z.object({
    kind: z.enum(REVIEW_KINDS),
    title: z.string(),
    description: z.string(),
    suggestion: z
      .string()
      .min(1)
      .describe(
        "What you propose to do about it, concretely enough to carry out as written (display ids, the new wording). The user can accept it as is or give feedback instead.",
      ),
    category: z.enum(REVIEW_CATEGORIES).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    targets: z.array(z.object({ table: z.enum(TARGET_TABLES), id: z.string() })).optional(),
  }),
  run: async (a, ctx) => {
    const db = ctx.runtime.db;
    const targets: { table: TrackedTableName; id: string }[] = [];
    let topicId: string | null = null;
    for (const t of a.targets ?? []) {
      const row = (await resolveRow(db, t.table as TrackedTableName, ctx.libraryId, t.id)) as {
        id: string;
      };
      targets.push({ table: t.table as TrackedTableName, id: row.id });
      topicId ??=
        t.table === "topics"
          ? row.id
          : await topicOf(db, {
              subtopicId: t.table === "subtopics" ? row.id : null,
              conceptId: t.table === "concepts" ? row.id : null,
              knowledgeItemId: t.table === "knowledge_items" ? row.id : null,
            });
    }
    const payload = { ...a.payload };
    if (Array.isArray(payload["conceptIds"])) {
      const ids = [];
      for (const c of payload["conceptIds"] as string[])
        ids.push((await resolveRow(db, "concepts", ctx.libraryId, c)).id);
      payload["conceptIds"] = ids;
    }
    if (Array.isArray(payload["knowledgeItemIds"])) {
      const ids = [];
      for (const k of payload["knowledgeItemIds"] as string[])
        ids.push((await resolveRow(db, "knowledge_items", ctx.libraryId, k)).id);
      payload["knowledgeItemIds"] = ids;
    }
    const { result } = await change(db, ctx.change("raise_review_item"), (c) =>
      raiseReviewItem(c, {
        libraryId: ctx.libraryId,
        kind: a.kind,
        title: a.title,
        description: a.description,
        suggestion: a.suggestion,
        category: a.category,
        payload,
        targets,
        topicId,
        raisedBy: "ai",
      }),
    );
    return { id: result.id, displayId: result.displayId, category: result.category };
  },
});
