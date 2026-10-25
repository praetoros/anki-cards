import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { guidFor, noteTypes, occlusionsToCloze, type NoteTypeDef } from "@anki-cards/apkg/preview";
import { renderPdfRegion } from "@anki-cards/ingest";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tCard,
  tCardPlan,
  tCardPlanRow,
  tConcept,
  tEvidence,
  tKnowledgeItem,
  tMediaAsset,
  tOcclusionMask,
  tSource,
  tSourceUnit,
  tSubtopic,
  tTopic,
  type OcclusionShape,
  type TCardS,
  type TKnowledgeItemS,
} from "./db/schema/index.ts";
import { nextDisplayId } from "./display-ids.ts";
import type { CardType, PlanRowStatus } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change, type ChangeContext } from "./history.ts";
import type { AppPaths } from "./paths.ts";
import type { Writer } from "./knowledge.ts";
import { enqueueJob } from "./jobs.ts";
import { resolveIds, resolveRow } from "./resolve.ts";
import { assertTopicInScope } from "./sessions.ts";
import { getSetting } from "./settings.ts";
import { latestSnapshot } from "./snapshots.ts";
import { ensureSession } from "./workflow-actions.ts";

export const NOTE_TYPE_FOR: Record<CardType, NoteTypeDef> = {
  basic: noteTypes.basic,
  reversed: noteTypes.basicReversed,
  cloze: noteTypes.cloze,
  image_occlusion: noteTypes.imageOcclusion,
  image_question: noteTypes.imageQuestion,
};

/** Fields the worker or user writes; the rest are filled from media, masks and evidence. */
export const EDITABLE_FIELDS: Record<CardType, string[]> = {
  basic: ["Front", "Back", "Extra"],
  reversed: ["Front", "Back", "Extra"],
  cloze: ["Text", "Extra"],
  image_occlusion: ["Header", "Back Extra", "Comments"],
  image_question: ["Front", "Back", "Extra"],
};

function assertTopicScope(w: Writer, topicId: string) {
  if (w.session) assertTopicInScope(w.session, topicId, "This topic");
}

// ---------- planning ----------

export interface PlanRowInput {
  knowledgeItemIds: string[];
  cardType: CardType;
  rationale: string;
}

/** Replaces the topic's draft plan with a new one. Planning reads the approved synthesis. */
export async function proposeCardPlan(
  db: TDatabase,
  w: Writer,
  input: { topicId: string; summary: string; rows: PlanRowInput[] },
) {
  const lib = w.ctx.libraryId;
  const snapshot = await latestSnapshot(db, lib, "synthesis");
  if (!snapshot)
    throw new DomainError("gate_blocked", "Approve the synthesis before planning cards.");
  const allowedTypes = await getSetting(db, "cards.types", lib);
  const { result } = await change(db, w.ctx, async (c) => {
    const topic = await resolveRow(c.tx, "topics", lib, input.topicId);
    assertTopicScope(w, topic.id);
    const drafts = await c.tx
      .select()
      .from(tCardPlan)
      .where(and(eq(tCardPlan.topicId, topic.id), eq(tCardPlan.status, "draft")));
    for (const d of drafts) await c.update("card_plans", d.id, { status: "superseded" });
    const plan = await c.insert("card_plans", {
      topicId: topic.id,
      status: "draft",
      summary: input.summary,
      snapshotId: snapshot.id,
    });
    for (const row of input.rows) {
      if (!allowedTypes.includes(row.cardType)) {
        throw new DomainError("invalid", `Card type ${row.cardType} is turned off in settings.`);
      }
      await c.insert("card_plan_rows", {
        planId: plan.id,
        knowledgeItemIds: await resolveIds(c.tx, "knowledge_items", lib, row.knowledgeItemIds),
        cardType: row.cardType,
        rationale: row.rationale,
        status: "proposed",
      });
    }
    return plan;
  });
  return result;
}

export async function updatePlanRow(
  db: TDatabase,
  w: Writer,
  input: { rowId: string; status?: PlanRowStatus; cardType?: CardType; rationale?: string },
) {
  const { result } = await change(db, w.ctx, async (c) => {
    const row = await resolveRow(c.tx, "card_plan_rows", w.ctx.libraryId, input.rowId);
    return c.update("card_plan_rows", row.id, {
      status: input.status ?? row.status,
      cardType: input.cardType ?? row.cardType,
      rationale: input.rationale ?? row.rationale,
    });
  });
  return result;
}

export async function cardPlanView(db: TDb, topicId: string) {
  const plans = await db
    .select()
    .from(tCardPlan)
    .where(and(eq(tCardPlan.topicId, topicId), inArray(tCardPlan.status, ["draft", "approved"])))
    .orderBy(asc(tCardPlan.createdAt));
  const plan = plans.at(-1);
  if (!plan) return null;
  const rows = await db
    .select()
    .from(tCardPlanRow)
    .where(eq(tCardPlanRow.planId, plan.id))
    .orderBy(asc(tCardPlanRow.createdAt));
  const kiIds = [...new Set(rows.flatMap((r) => r.knowledgeItemIds))];
  const kis = kiIds.length
    ? await db.select().from(tKnowledgeItem).where(inArray(tKnowledgeItem.id, kiIds))
    : [];
  return {
    plan,
    rows: rows.map((r) => ({ ...r, items: kis.filter((k) => r.knowledgeItemIds.includes(k.id)) })),
  };
}

// ---------- cards ----------

async function checkUncertain(db: TDb, lib: string, kis: TKnowledgeItemS[]) {
  const uncertain = kis.filter((k) => k.interpretationStatus !== "supported");
  if (uncertain.length === 0) return "";
  const rule = await getSetting(db, "cards.uncertainKnowledge", lib);
  const ids = uncertain.map((k) => k.displayId).join(", ");
  if (rule === "exclude") {
    throw new DomainError(
      "forbidden",
      `${ids} is ${uncertain[0]?.interpretationStatus}; uncertain knowledge is not carded (setting). Raise a review item instead.`,
    );
  }
  return `Based on ${uncertain[0]?.interpretationStatus} knowledge (${ids}); check before relying on it.`;
}

function validateFields(cardType: CardType, fields: Record<string, string>, maxCloze: number) {
  const allowed = EDITABLE_FIELDS[cardType];
  const unknown = Object.keys(fields).filter((f) => !allowed.includes(f));
  if (unknown.length)
    throw new DomainError(
      "invalid",
      `Unknown fields for ${cardType}: ${unknown.join(", ")}. Use ${allowed.join(", ")}.`,
    );
  if (cardType === "cloze") {
    const text = fields["Text"] ?? "";
    const ords = new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => m[1]));
    if (ords.size === 0)
      throw new DomainError("invalid", "Cloze text needs at least one {{c1::…}} deletion.");
    if (ords.size > maxCloze)
      throw new DomainError("invalid", `At most ${maxCloze} cloze deletions per note (setting).`);
  } else if (cardType !== "image_occlusion" && !fields["Front"]?.trim()) {
    throw new DomainError("invalid", "The card needs a Front.");
  }
}

export async function upsertCard(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    topicId: string;
    planRowId?: string;
    cardType: CardType;
    fields: Record<string, string>;
    mediaIds?: string[];
    knowledgeItemIds: string[];
    reviewItemId?: string;
  },
) {
  const lib = w.ctx.libraryId;
  const allowedTypes = await getSetting(db, "cards.types", lib);
  if (!allowedTypes.includes(input.cardType)) {
    throw new DomainError("invalid", `Card type ${input.cardType} is turned off in settings.`);
  }
  validateFields(input.cardType, input.fields, await getSetting(db, "cards.maxClozePerNote", lib));
  const { result } = await change(db, w.ctx, async (c) => {
    const topic = await resolveRow(c.tx, "topics", lib, input.topicId);
    assertTopicScope(w, topic.id);
    const kiIds = await resolveIds(c.tx, "knowledge_items", lib, input.knowledgeItemIds);
    if (kiIds.length === 0)
      throw new DomainError("invalid", "A card must come from at least one knowledge item.");
    const kis = await c.tx.select().from(tKnowledgeItem).where(inArray(tKnowledgeItem.id, kiIds));
    const excluded = kis.filter((k) => k.excluded);
    if (excluded.length)
      throw new DomainError(
        "forbidden",
        `${excluded.map((k) => k.displayId).join(", ")} is excluded.`,
      );
    const warning = await checkUncertain(c.tx, lib, kis);
    const mediaIds = await resolveIds(c.tx, "media_assets", lib, input.mediaIds ?? []);
    if (
      (input.cardType === "image_occlusion" || input.cardType === "image_question") &&
      mediaIds.length === 0
    ) {
      throw new DomainError("invalid", "Image cards need mediaIds.");
    }
    const row = input.planRowId
      ? await resolveRow(c.tx, "card_plan_rows", lib, input.planRowId)
      : null;
    if (row) await c.update("card_plan_rows", row.id, { status: "generated" });
    if (input.id) {
      const card = await resolveRow(c.tx, "cards", lib, input.id);
      return c.update(
        "cards",
        card.id,
        {
          cardType: input.cardType,
          fields: input.fields,
          mediaIds,
          knowledgeItemIds: kiIds,
          warning,
          status: w.ctx.actor === "user" ? card.status : "draft",
        },
        input.expectedVersion,
      );
    }
    const id = `card_${crypto.randomUUID().replaceAll("-", "")}`;
    return c.insert("cards", {
      id,
      displayId: await nextDisplayId(c.tx, lib, "cards"),
      topicId: topic.id,
      planRowId: row?.id ?? null,
      cardType: input.cardType,
      fields: input.fields,
      mediaIds,
      tags: [],
      knowledgeItemIds: kiIds,
      guid: guidFor(id),
      status: "draft",
      warning,
    });
  });
  return result;
}

export async function setCardStatus(
  db: TDatabase,
  w: Writer,
  cardIds: string[],
  status: TCardS["status"],
) {
  const { result } = await change(db, w.ctx, async (c) => {
    for (const id of cardIds) {
      const card = await resolveRow(c.tx, "cards", w.ctx.libraryId, id);
      assertTopicScope(w, card.topicId);
      await c.update("cards", card.id, { status });
    }
    return cardIds.length;
  });
  return result;
}

/** Anki numbers occlusions from 1; models often count from 0, so shift while keeping groups. */
export function normaliseMaskOrdinals(shapes: OcclusionShape[]): OcclusionShape[] {
  const lowest = Math.min(1, ...shapes.map((s) => s.ordinal ?? 1));
  return shapes.map((s) =>
    s.ordinal === undefined ? s : { ...s, ordinal: s.ordinal + 1 - lowest },
  );
}

export async function setOcclusionMasks(
  db: TDatabase,
  w: Writer,
  input: {
    cardId: string;
    mediaId: string;
    shapes: OcclusionShape[];
    origin: "pdf-text" | "ai-estimate" | "user";
  },
) {
  for (const s of input.shapes) {
    const values = s.shape === "polygon" ? s.points.flatMap((p) => [p.x, p.y]) : [s.left, s.top];
    if (values.some((v) => v < 0 || v > 1))
      throw new DomainError("invalid", "Mask coordinates are fractions from 0 to 1.");
  }
  const shapes = normaliseMaskOrdinals(input.shapes);
  const { result } = await change(db, w.ctx, async (c) => {
    const card = await resolveRow(c.tx, "cards", w.ctx.libraryId, input.cardId);
    assertTopicScope(w, card.topicId);
    const media = await resolveRow(c.tx, "media_assets", w.ctx.libraryId, input.mediaId);
    const [existing] = await c.tx
      .select()
      .from(tOcclusionMask)
      .where(eq(tOcclusionMask.cardId, card.id));
    const values = {
      cardId: card.id,
      mediaId: media.id,
      shapes,
      origin: input.origin,
    };
    if (existing) return c.update("occlusion_masks", existing.id, values);
    return c.insert("occlusion_masks", values);
  });
  return result;
}

/**
 * Mask suggestions from labels printed as PDF text on or beside a figure. When labels sit
 * outside the image, a crop of the page covering the figure and its labels becomes the image.
 * Returns the media to use and rects in fractions of it.
 */
export async function suggestMasksFromText(
  db: TDatabase,
  paths: AppPaths,
  ctx: ChangeContext & { libraryId: string },
  mediaId: string,
): Promise<{ mediaId: string; shapes: OcclusionShape[] }> {
  const libraryId = ctx.libraryId;
  const media = await resolveRow(db, "media_assets", libraryId, mediaId);
  const bbox = media.provenance.bbox;
  const page = media.provenance.detail?.["page"];
  const none = { mediaId: media.id, shapes: [] };
  if (!bbox || !media.sourceId || typeof page !== "number") return none;
  const [source] = await db.select().from(tSource).where(eq(tSource.id, media.sourceId));
  const units = await db
    .select()
    .from(tSourceUnit)
    .where(and(eq(tSourceUnit.sourceId, media.sourceId), eq(tSourceUnit.unitType, "page")));
  const unit = units.find((u) => u.location.page === page);
  if (!unit || !source) return none;
  const labels = unit.textBlocks.filter((block) => {
    const b = block.bbox;
    const text = block.text.trim();
    if (!text || text.length > 60 || /^(fig(ure)?|table)\.?\s*\d/i.test(text)) return false;
    const vertical = b.y1 >= bbox.y0 - 30 && b.y0 <= bbox.y1 + 30;
    const horizontal = b.x1 >= bbox.x0 - 160 && b.x0 <= bbox.x1 + 160;
    return vertical && horizontal;
  });
  if (labels.length === 0) return none;
  const pad = 6;
  const region = {
    x0: Math.min(bbox.x0, ...labels.map((l) => l.bbox.x0)) - pad,
    y0: Math.min(bbox.y0, ...labels.map((l) => l.bbox.y0)) - pad,
    x1: Math.max(bbox.x1, ...labels.map((l) => l.bbox.x1)) + pad,
    y1: Math.max(bbox.y1, ...labels.map((l) => l.bbox.y1)) + pad,
  };
  const outside =
    region.x0 < bbox.x0 - pad ||
    region.y0 < bbox.y0 - pad ||
    region.x1 > bbox.x1 + pad ||
    region.y1 > bbox.y1 + pad;
  const frame = outside ? region : bbox;
  let target = media.id;
  if (outside && source.fileType === "pdf") {
    const { png, width, height } = renderPdfRegion(
      new Uint8Array(await readFile(source.storagePath)),
      page,
      region,
    );
    const sha = createHash("sha256").update(png).digest("hex");
    const storagePath = join(paths.media, `${sha}.png`);
    if (!existsSync(storagePath)) await writeFile(storagePath, png);
    const { result } = await change(db, { ...ctx, action: "crop_figure" }, async (c) => {
      const [existing] = await c.tx
        .select()
        .from(tMediaAsset)
        .where(and(eq(tMediaAsset.libraryId, libraryId), eq(tMediaAsset.sha256, sha)));
      if (existing) return existing;
      return c.insert("media_assets", {
        displayId: await nextDisplayId(c.tx, libraryId, "media_assets"),
        sha256: sha,
        storagePath,
        mime: "image/png",
        width,
        height,
        origin: "source",
        sourceId: source.id,
        provenance: {
          kind: "render",
          bbox: region,
          renderDpi: 200,
          detail: { page, croppedFrom: media.id },
        },
        relevance: "essential",
        description: `Figure with its labels, page ${page}`,
      });
    });
    target = result.id;
  }
  const w = frame.x1 - frame.x0;
  const h = frame.y1 - frame.y0;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const shapes: OcclusionShape[] = labels.map((l, i) => ({
    shape: "rect",
    left: clamp((l.bbox.x0 - frame.x0) / w),
    top: clamp((l.bbox.y0 - frame.y0) / h),
    width: clamp((l.bbox.x1 - l.bbox.x0) / w),
    height: clamp((l.bbox.y1 - l.bbox.y0) / h),
    ordinal: i + 1,
    label: l.text.trim(),
  }));
  return { mediaId: target, shapes };
}

export async function listCards(db: TDb, topicId: string) {
  return db.select().from(tCard).where(eq(tCard.topicId, topicId)).orderBy(asc(tCard.displayId));
}

export async function masksForCards(db: TDb, cardIds: string[]) {
  return cardIds.length
    ? db.select().from(tOcclusionMask).where(inArray(tOcclusionMask.cardId, cardIds))
    : [];
}

// ---------- fields for preview and export ----------

/** Short citation for a card: the lecture and page/slide, or the external publisher. */
export async function citationFor(db: TDb, knowledgeItemIds: string[]): Promise<string> {
  if (knowledgeItemIds.length === 0) return "";
  const evidence = await db
    .select()
    .from(tEvidence)
    .where(inArray(tEvidence.knowledgeItemId, knowledgeItemIds));
  const unitIds = evidence.map((e) => e.sourceUnitId).filter((x): x is string => Boolean(x));
  const units = unitIds.length
    ? await db
        .select({ unit: tSourceUnit, source: tSource })
        .from(tSourceUnit)
        .innerJoin(tSource, eq(tSourceUnit.sourceId, tSource.id))
        .where(inArray(tSourceUnit.id, unitIds))
    : [];
  const parts = new Set<string>();
  for (const { unit, source } of units) {
    const where = unit.location.slide
      ? `slide ${unit.location.slide}`
      : unit.location.page
        ? `p. ${unit.location.page}`
        : "";
    parts.add(`${source.title}${where ? `, ${where}` : ""}`);
  }
  for (const e of evidence)
    if (e.external) parts.add(`${e.external.publisher}: ${e.external.title}`);
  return [...parts].join("; ");
}

/**
 * The full field list of a card's note type. `imageSrc` maps a media id to the reference used
 * in the note (a /media URL for previews, the packaged file name for export).
 */
export async function noteFields(
  db: TDb,
  card: TCardS,
  imageSrc: (mediaId: string) => string,
  extraNotice = "",
): Promise<string[]> {
  const type = NOTE_TYPE_FOR[card.cardType];
  const image = card.mediaIds.map((id) => `<img src="${imageSrc(id)}">`).join("");
  const [mask] = card.cardType === "image_occlusion" ? await masksForCards(db, [card.id]) : [];
  const values: Record<string, string> = {
    ...card.fields,
    Image: image,
    Source: await citationFor(db, card.knowledgeItemIds),
    KnowledgeIds: card.knowledgeItemIds.join(" "),
    CardId: card.id,
    Occlusion: mask ? occlusionsToCloze(mask.shapes) : "",
  };
  const notice = [card.warning, extraNotice].filter(Boolean).join(" ");
  if (notice) {
    const key = card.cardType === "image_occlusion" ? "Comments" : "Extra";
    values[key] = [values[key], `<div class="notice">${notice}</div>`].filter(Boolean).join("");
  }
  return type.fields.map((f) => values[f.name] ?? "");
}

/** Topic → subtopic names for a card, from its first knowledge item. */
export async function cardPlacement(db: TDb, card: TCardS) {
  const [row] = await db
    .select({ topic: tTopic.title, subtopic: tSubtopic.title })
    .from(tKnowledgeItem)
    .innerJoin(tConcept, eq(tKnowledgeItem.conceptId, tConcept.id))
    .innerJoin(tSubtopic, eq(tConcept.subtopicId, tSubtopic.id))
    .innerJoin(tTopic, eq(tSubtopic.topicId, tTopic.id))
    .where(eq(tKnowledgeItem.id, card.knowledgeItemIds[0] ?? ""));
  return row ?? null;
}

export async function mediaFiles(db: TDb, ids: string[]) {
  return ids.length ? db.select().from(tMediaAsset).where(inArray(tMediaAsset.id, ids)) : [];
}

// ---------- jobs ----------

async function topicSession(
  db: TDb,
  libraryId: string,
  topicId: string,
  jobKind: "planning" | "generation",
) {
  const topic = await resolveRow(db, "topics", libraryId, topicId);
  return {
    topic,
    session: await ensureSession(db, {
      libraryId,
      kind: "topic",
      scope: { kind: "topics", topicIds: [topic.id] },
      title: topic.title,
      jobKind,
    }),
  };
}

export async function startPlanning(db: TDatabase, libraryId: string, topicId: string) {
  if (!(await latestSnapshot(db, libraryId, "synthesis"))) {
    throw new DomainError("gate_blocked", "Approve the synthesis before planning cards.");
  }
  const { topic, session } = await topicSession(db, libraryId, topicId, "planning");
  return enqueueJob(db, {
    sessionId: session.id,
    kind: "planning",
    trigger: "button",
    prompt: `Plan the cards for topic ${topic.displayId} "${topic.title}" following the card instructions and get_settings, then propose_card_plan and complete_job.`,
  });
}

export async function startGeneration(db: TDatabase, libraryId: string, topicId: string) {
  const { topic, session } = await topicSession(db, libraryId, topicId, "generation");
  const [plan] = await db
    .select()
    .from(tCardPlan)
    .where(and(eq(tCardPlan.topicId, topic.id), eq(tCardPlan.status, "approved")));
  if (!plan) throw new DomainError("gate_blocked", "Approve the card plan for this topic first.");
  return enqueueJob(db, {
    sessionId: session.id,
    kind: "generation",
    trigger: "button",
    prompt: `Generate cards for the accepted rows of the approved card plan of topic ${topic.displayId} "${topic.title}" (get_card_plan), following the card instructions. Then complete_job.`,
  });
}

export async function approvedPlanRows(db: TDb, topicId: string) {
  const [plan] = await db
    .select()
    .from(tCardPlan)
    .where(and(eq(tCardPlan.topicId, topicId), eq(tCardPlan.status, "approved")));
  if (!plan) return [];
  return db
    .select()
    .from(tCardPlanRow)
    .where(
      and(
        eq(tCardPlanRow.planId, plan.id),
        inArray(tCardPlanRow.status, ["accepted", "proposed", "generated"]),
      ),
    );
}
