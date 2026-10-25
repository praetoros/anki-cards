import type { OcclusionMask } from "@anki-cards/apkg/preview";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { CardStatus, CardType, PlanRowStatus } from "../../domain/enums.ts";
import { trackedCols } from "../helpers.ts";

export const tCardPlan = sqliteTable(
  "card_plans",
  {
    ...trackedCols,
    topicId: text().notNull(),
    status: text().$type<"draft" | "approved" | "superseded">().notNull(),
    summary: text().notNull().default(""),
    snapshotId: text(),
  },
  (t) => [index("card_plans_topic_idx").on(t.topicId)],
);

export const tCardPlanRow = sqliteTable(
  "card_plan_rows",
  {
    ...trackedCols,
    planId: text().notNull(),
    knowledgeItemIds: text({ mode: "json" }).$type<string[]>().notNull(),
    cardType: text().$type<CardType>().notNull(),
    rationale: text().notNull().default(""),
    status: text().$type<PlanRowStatus>().notNull(),
  },
  (t) => [index("card_plan_rows_plan_idx").on(t.planId)],
);

export const tCard = sqliteTable(
  "cards",
  {
    ...trackedCols,
    displayId: text().notNull(),
    topicId: text().notNull(),
    planRowId: text(),
    cardType: text().$type<CardType>().notNull(),
    fields: text({ mode: "json" }).$type<Record<string, string>>().notNull(),
    mediaIds: text({ mode: "json" }).$type<string[]>().notNull(),
    tags: text({ mode: "json" }).$type<string[]>().notNull(),
    knowledgeItemIds: text({ mode: "json" }).$type<string[]>().notNull(),
    guid: text().notNull(),
    status: text().$type<CardStatus>().notNull(),
    warning: text().notNull().default(""),
  },
  (t) => [index("cards_topic_idx").on(t.topicId)],
);

export type OcclusionShape = OcclusionMask & { label?: string };

export const tOcclusionMask = sqliteTable(
  "occlusion_masks",
  {
    ...trackedCols,
    cardId: text().notNull(),
    mediaId: text().notNull(),
    shapes: text({ mode: "json" }).$type<OcclusionShape[]>().notNull(),
    origin: text().$type<"pdf-text" | "ai-estimate" | "user">().notNull(),
  },
  (t) => [index("occlusion_masks_card_idx").on(t.cardId)],
);

export type TCardPlanS = typeof tCardPlan.$inferSelect;
export type TCardPlanRowS = typeof tCardPlanRow.$inferSelect;
export type TCardS = typeof tCard.$inferSelect;
export type TOcclusionMaskS = typeof tOcclusionMask.$inferSelect;
