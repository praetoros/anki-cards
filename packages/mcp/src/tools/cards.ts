import {
  CARD_TYPES,
  cardPlanView,
  EDITABLE_FIELDS,
  listCards,
  masksForCards,
  PLAN_ROW_STATUSES,
  proposeCardPlan,
  resolveRow,
  setCardStatus,
  setOcclusionMasks,
  suggestMasksFromText,
  updatePlanRow,
  upsertCard,
  type Writer,
} from "@anki-cards/core";
import { z } from "zod";

import { defineTool, type ToolContext } from "../tool.ts";

function writer(ctx: ToolContext, action: string, reviewItemId?: string): Writer {
  return {
    ctx: {
      ...ctx.change(action, { reviewItemId: reviewItemId ?? null }),
      libraryId: ctx.libraryId,
    },
    session: ctx.session,
  };
}

const fraction = z.number().min(0).max(1);
const mask = z.discriminatedUnion("shape", [
  z.object({
    shape: z.literal("rect"),
    left: fraction,
    top: fraction,
    width: fraction,
    height: fraction,
    ordinal: z.number().int().min(1).optional(),
    label: z.string().optional(),
  }),
  z.object({
    shape: z.literal("ellipse"),
    left: fraction,
    top: fraction,
    rx: fraction,
    ry: fraction,
    ordinal: z.number().int().min(1).optional(),
    label: z.string().optional(),
  }),
  z.object({
    shape: z.literal("polygon"),
    points: z.array(z.object({ x: fraction, y: fraction })).min(3),
    ordinal: z.number().int().min(1).optional(),
    label: z.string().optional(),
  }),
]);

export const getCardPlan = defineTool({
  name: "get_card_plan",
  description:
    "The current card plan of a topic: rows with their knowledge items, card type, rationale and status.",
  input: z.object({ topicId: z.string() }),
  readOnly: true,
  run: async ({ topicId }, ctx) => {
    const topic = await resolveRow(ctx.runtime.db, "topics", ctx.libraryId, topicId);
    return (await cardPlanView(ctx.runtime.db, topic.id)) ?? "No plan yet.";
  },
});

export const proposeCardPlanTool = defineTool({
  name: "propose_card_plan",
  description:
    "Propose the card plan for a topic (replaces the draft). One row per planned card: the knowledge items it tests, the card type and why.",
  input: z.object({
    topicId: z.string(),
    summary: z.string(),
    rows: z
      .array(
        z.object({
          knowledgeItemIds: z.array(z.string()).min(1),
          cardType: z.enum(CARD_TYPES),
          rationale: z.string(),
        }),
      )
      .min(1),
  }),
  run: async (a, ctx) => {
    const plan = await proposeCardPlan(ctx.runtime.db, writer(ctx, "propose_card_plan"), a);
    return {
      planId: plan.id,
      rows: a.rows.length,
      status: "draft — waiting for the user's approval",
    };
  },
});

export const updateCardPlanRowTool = defineTool({
  name: "update_card_plan_row",
  description: "Change one plan row's card type, rationale or status.",
  input: z.object({
    rowId: z.string(),
    status: z.enum(PLAN_ROW_STATUSES).optional(),
    cardType: z.enum(CARD_TYPES).optional(),
    rationale: z.string().optional(),
  }),
  run: (a, ctx) => updatePlanRow(ctx.runtime.db, writer(ctx, "update_card_plan_row"), a),
});

export const listCardsTool = defineTool({
  name: "list_cards",
  description: "Cards of a topic with their fields and status.",
  input: z.object({ topicId: z.string() }),
  readOnly: true,
  run: async ({ topicId }, ctx) => {
    const topic = await resolveRow(ctx.runtime.db, "topics", ctx.libraryId, topicId);
    return (await listCards(ctx.runtime.db, topic.id)).map((c) => ({
      id: c.id,
      displayId: c.displayId,
      version: c.version,
      cardType: c.cardType,
      status: c.status,
      fields: c.fields,
      knowledgeItemIds: c.knowledgeItemIds,
      warning: c.warning || undefined,
    }));
  },
});

export const getCard = defineTool({
  name: "get_card",
  description: "One card with its fields, media and occlusion masks.",
  input: z.object({ cardId: z.string() }),
  readOnly: true,
  run: async ({ cardId }, ctx) => {
    const card = await resolveRow(ctx.runtime.db, "cards", ctx.libraryId, cardId);
    const [masks] = await masksForCards(ctx.runtime.db, [card.id]);
    return { ...card, masks: masks?.shapes ?? [], editableFields: EDITABLE_FIELDS[card.cardType] };
  },
});

export const upsertCardTool = defineTool({
  name: "upsert_card",
  description:
    "Create or update a card. Fields by type — basic/reversed/image_question: Front, Back, Extra; cloze: Text (with {{c1::…}}), Extra; image_occlusion: Header, Back Extra, Comments (masks via propose_occlusion_masks). Image cards need mediaIds. Citation, image and ids are filled in by the app.",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: z.number().int().optional(),
    topicId: z.string(),
    planRowId: z.string().optional(),
    cardType: z.enum(CARD_TYPES),
    fields: z.record(z.string(), z.string()),
    mediaIds: z.array(z.string()).optional(),
    knowledgeItemIds: z.array(z.string()).min(1),
    reviewItemId: z.string().optional(),
  }),
  run: async (a, ctx) => {
    const card = await upsertCard(ctx.runtime.db, writer(ctx, "upsert_card", a.reviewItemId), a);
    return {
      id: card.id,
      displayId: card.displayId,
      version: card.version,
      warning: card.warning || undefined,
    };
  },
});

export const retireCard = defineTool({
  name: "retire_card",
  description:
    "Retire a card that should no longer be studied. It is exported once more with a removed tag.",
  input: z.object({ cardId: z.string(), reviewItemId: z.string().optional() }),
  run: (a, ctx) =>
    setCardStatus(
      ctx.runtime.db,
      writer(ctx, "retire_card", a.reviewItemId),
      [a.cardId],
      "retired",
    ),
});

export const suggestOcclusionMasks = defineTool({
  name: "suggest_occlusion_masks",
  description:
    "Exact mask rectangles for labels printed as text inside a PDF figure (empty when the labels are part of the image). Pick the ones to hide and pass them to propose_occlusion_masks.",
  input: z.object({ mediaId: z.string() }),
  readOnly: true,
  run: ({ mediaId }, ctx) => suggestMasksFromText(ctx.runtime.db, ctx.libraryId, mediaId),
});

export const proposeOcclusionMasks = defineTool({
  name: "propose_occlusion_masks",
  description:
    "Set the masks of an image occlusion card. Coordinates are fractions (0–1) of the image. Use origin pdf-text for masks from suggest_occlusion_masks, ai-estimate otherwise; the user corrects them in the mask editor.",
  input: z.object({
    cardId: z.string(),
    mediaId: z.string(),
    shapes: z.array(mask).min(1),
    origin: z.enum(["pdf-text", "ai-estimate"]),
  }),
  run: (a, ctx) => setOcclusionMasks(ctx.runtime.db, writer(ctx, "propose_occlusion_masks"), a),
});
