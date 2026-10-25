import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  Actor,
  ApprovalKind,
  ReviewCategory,
  ReviewKind,
  ReviewStatus,
} from "../../domain/enums.ts";
import { trackedCols } from "../helpers.ts";

export const tReviewItem = sqliteTable(
  "review_items",
  {
    ...trackedCols,
    displayId: text().notNull(),
    kind: text().$type<ReviewKind>().notNull(),
    category: text().$type<ReviewCategory>().notNull(),
    status: text().$type<ReviewStatus>().notNull(),
    title: text().notNull(),
    description: text().notNull().default(""),
    /** What the raiser proposes to do about it; the user can accept it or give feedback. */
    suggestion: text().notNull().default(""),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
    topicId: text(),
    raisedBy: text().$type<Actor>().notNull(),
    resolution: text().notNull().default(""),
  },
  (t) => [index("review_items_library_status_idx").on(t.libraryId, t.status)],
);

export const tReviewItemTarget = sqliteTable(
  "review_item_targets",
  {
    ...trackedCols,
    reviewItemId: text().notNull(),
    targetTable: text().notNull(),
    targetId: text().notNull(),
  },
  (t) => [
    index("review_item_targets_item_idx").on(t.reviewItemId),
    index("review_item_targets_target_idx").on(t.targetId),
  ],
);

export const tReviewMessage = sqliteTable(
  "review_messages",
  {
    ...trackedCols,
    reviewItemId: text().notNull(),
    author: text().$type<Actor>().notNull(),
    action: text(),
    body: text().notNull(),
    jobId: text(),
    processed: text().$type<"pending" | "processed" | "n/a">().notNull().default("n/a"),
  },
  (t) => [index("review_messages_item_idx").on(t.reviewItemId)],
);

export interface ApprovalScope {
  conceptIds: string[];
  subtopicId?: string;
  knowledgeItemIds?: string[];
}

export const tApproval = sqliteTable(
  "approvals",
  {
    ...trackedCols,
    reviewItemId: text().notNull(),
    kind: text().$type<ApprovalKind>().notNull(),
    scope: text({ mode: "json" }).$type<ApprovalScope>().notNull(),
    purpose: text().notNull().default(""),
    status: text().$type<"active" | "revoked" | "used">().notNull(),
  },
  (t) => [index("approvals_library_idx").on(t.libraryId)],
);

export type TReviewItemS = typeof tReviewItem.$inferSelect;
export type TReviewItemTargetS = typeof tReviewItemTarget.$inferSelect;
export type TReviewMessageS = typeof tReviewMessage.$inferSelect;
export type TApprovalS = typeof tApproval.$inferSelect;
