import { and, asc, eq, inArray, like, or } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tConcept,
  tCoverageEntry,
  tEvidence,
  tKnowledgeItem,
  tLearningObjective,
  tMediaAsset,
  tMediaLink,
  tObjectiveMapping,
  tRelationship,
  tSourceUnit,
  tSubtopic,
  tTopic,
  type ExternalReference,
  type TSessionS,
} from "./db/schema/index.ts";
import { nextDisplayId } from "./display-ids.ts";
import type {
  CoverageOutcome,
  CoverageState,
  InterpretationStatus,
  KnowledgeType,
  MediaLinkRole,
  Priority,
  RelationshipKind,
  VerificationOutcome,
} from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change, type ChangeContext, type Changes } from "./history.ts";
import { resolveIds, resolveRow } from "./resolve.ts";
import { assertApproved, raiseReviewItem } from "./review.ts";
import { assertTopicInScope, topicOf } from "./sessions.ts";

/** Who is writing: the change context, plus the worker session whose scope applies. */
export interface Writer {
  ctx: ChangeContext & { libraryId: string };
  session?: TSessionS | null;
}

async function inScope(c: Changes, w: Writer, target: Parameters<typeof topicOf>[1], what: string) {
  if (!w.session) return;
  assertTopicInScope(w.session, await topicOf(c.tx, target), what);
}

/** AI edits of rows the user edited need a review item that asked for the change. */
function assertMayEditUserContent(w: Writer, row: { userEdited: boolean; displayId: string }) {
  if (w.ctx.actor === "ai" && row.userEdited && !w.ctx.reviewItemId) {
    throw new DomainError(
      "forbidden",
      `${row.displayId} was edited by the user. Change it only when processing a review item that asks for it (pass reviewItemId), or raise a review item.`,
    );
  }
}

const userEdited = (w: Writer) => (w.ctx.actor === "user" ? { userEdited: true } : {});

export async function upsertTopic(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    title: string;
    overview?: string;
    ordinal?: number;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    if (input.id) {
      const topic = await resolveRow(c.tx, "topics", lib, input.id);
      await inScope(c, w, { topicId: topic.id }, `Topic ${topic.displayId}`);
      return c.update(
        "topics",
        topic.id,
        {
          title: input.title,
          overview: input.overview ?? topic.overview,
          ordinal: input.ordinal ?? topic.ordinal,
        },
        input.expectedVersion,
      );
    }
    if (w.session && w.session.scope.kind !== "library") {
      throw new DomainError("out_of_scope", "Only library-wide sessions can create topics.");
    }
    return c.insert("topics", {
      displayId: await nextDisplayId(c.tx, lib, "topics"),
      title: input.title,
      overview: input.overview ?? "",
      ordinal: input.ordinal ?? 0,
    });
  });
  return result;
}

export async function upsertSubtopic(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    topicId: string;
    title: string;
    overview?: string;
    ordinal?: number;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const topic = await resolveRow(c.tx, "topics", lib, input.topicId);
    await inScope(c, w, { topicId: topic.id }, `Topic ${topic.displayId}`);
    if (input.id) {
      const sub = await resolveRow(c.tx, "subtopics", lib, input.id);
      await inScope(c, w, { subtopicId: sub.id }, `Subtopic ${sub.displayId}`);
      return c.update(
        "subtopics",
        sub.id,
        {
          topicId: topic.id,
          title: input.title,
          overview: input.overview ?? sub.overview,
          ordinal: input.ordinal ?? sub.ordinal,
        },
        input.expectedVersion,
      );
    }
    return c.insert("subtopics", {
      displayId: await nextDisplayId(c.tx, lib, "subtopics"),
      topicId: topic.id,
      title: input.title,
      overview: input.overview ?? "",
      ordinal: input.ordinal ?? 0,
    });
  });
  return result;
}

export async function upsertConcept(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    subtopicId: string;
    title: string;
    explanation?: string;
    interpretationStatus?: InterpretationStatus;
    ordinal?: number;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const sub = await resolveRow(c.tx, "subtopics", lib, input.subtopicId);
    await inScope(c, w, { subtopicId: sub.id }, `Subtopic ${sub.displayId}`);
    if (input.id) {
      const concept = await resolveRow(c.tx, "concepts", lib, input.id);
      await inScope(c, w, { conceptId: concept.id }, `Concept ${concept.displayId}`);
      assertMayEditUserContent(w, concept);
      return c.update(
        "concepts",
        concept.id,
        {
          subtopicId: sub.id,
          title: input.title,
          explanation: input.explanation ?? concept.explanation,
          interpretationStatus: input.interpretationStatus ?? concept.interpretationStatus,
          ordinal: input.ordinal ?? concept.ordinal,
          ...userEdited(w),
        },
        input.expectedVersion,
      );
    }
    return c.insert("concepts", {
      displayId: await nextDisplayId(c.tx, lib, "concepts"),
      subtopicId: sub.id,
      title: input.title,
      explanation: input.explanation ?? "",
      interpretationStatus: input.interpretationStatus ?? "supported",
      ordinal: input.ordinal ?? 0,
      ...userEdited(w),
    });
  });
  return result;
}

export interface SourceEvidenceInput {
  sourceUnitId: string;
  note?: string;
}

export interface ExternalEvidenceInput extends ExternalReference {
  verification?: VerificationOutcome;
}

async function addSourceEvidence(c: Changes, lib: string, kiId: string, ev: SourceEvidenceInput) {
  const unit = await resolveRow(c.tx, "source_units", lib, ev.sourceUnitId);
  return c.insert("evidence", {
    knowledgeItemId: kiId,
    kind: "source",
    sourceUnitId: unit.id,
    external: null,
    note: ev.note ?? "",
    verification: "directly_supported",
  });
}

async function addExternal(
  c: Changes,
  w: Writer,
  conceptId: string,
  kiId: string,
  ev: ExternalEvidenceInput,
) {
  if (!ev.url || !ev.title || !ev.publisher || !ev.passage?.trim()) {
    throw new DomainError(
      "invalid",
      "External evidence needs url, title, publisher and the exact passage that supports the statement.",
    );
  }
  const approvals = await assertApproved(
    c.tx,
    w.ctx.libraryId,
    "text_enrichment",
    { conceptId },
    "External knowledge",
  );
  const approval = approvals.find((a) => a.scope.conceptIds.includes(conceptId));
  return c.insert("evidence", {
    knowledgeItemId: kiId,
    kind: "external",
    sourceUnitId: null,
    external: {
      url: ev.url,
      title: ev.title,
      publisher: ev.publisher,
      date: ev.date,
      passage: ev.passage,
      figure: ev.figure,
      trusted: ev.trusted,
    },
    note: "",
    verification: ev.verification ?? "directly_supported",
    approvalId: approval?.id ?? null,
  });
}

export async function upsertKnowledgeItem(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    conceptId: string;
    statement: string;
    types: KnowledgeType[];
    priority: Priority;
    origin: "source" | "external";
    interpretationStatus: InterpretationStatus;
    ordinal?: number;
    sourceEvidence?: SourceEvidenceInput[];
    externalEvidence?: ExternalEvidenceInput[];
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const concept = await resolveRow(c.tx, "concepts", lib, input.conceptId);
    await inScope(c, w, { conceptId: concept.id }, `Concept ${concept.displayId}`);
    if (input.origin === "external") {
      await assertApproved(
        c.tx,
        lib,
        "text_enrichment",
        { conceptId: concept.id },
        "External knowledge",
      );
      if (!input.id && !input.externalEvidence?.length) {
        throw new DomainError(
          "invalid",
          "External knowledge items need externalEvidence with the exact passage.",
        );
      }
    } else if (!input.id && !input.sourceEvidence?.length && w.ctx.actor === "ai") {
      throw new DomainError(
        "invalid",
        "Source knowledge items need sourceEvidence (the source unit ids they come from).",
      );
    }
    let ki;
    if (input.id) {
      const existing = await resolveRow(c.tx, "knowledge_items", lib, input.id);
      await inScope(c, w, { knowledgeItemId: existing.id }, `Knowledge item ${existing.displayId}`);
      assertMayEditUserContent(w, existing);
      ki = await c.update(
        "knowledge_items",
        existing.id,
        {
          conceptId: concept.id,
          statement: input.statement,
          types: input.types,
          priority: input.priority,
          origin: input.origin,
          interpretationStatus: input.interpretationStatus,
          ordinal: input.ordinal ?? existing.ordinal,
          ...userEdited(w),
        },
        input.expectedVersion,
      );
    } else {
      ki = await c.insert("knowledge_items", {
        displayId: await nextDisplayId(c.tx, lib, "knowledge_items"),
        conceptId: concept.id,
        statement: input.statement,
        types: input.types,
        priority: input.priority,
        origin: input.origin,
        interpretationStatus: input.interpretationStatus,
        ordinal: input.ordinal ?? 0,
        ...userEdited(w),
      });
    }
    for (const ev of input.sourceEvidence ?? []) await addSourceEvidence(c, lib, ki.id, ev);
    for (const ev of input.externalEvidence ?? []) await addExternal(c, w, concept.id, ki.id, ev);
    return ki;
  });
  return result;
}

export async function addEvidence(
  db: TDatabase,
  w: Writer,
  input: {
    knowledgeItemId: string;
    source?: SourceEvidenceInput;
    external?: ExternalEvidenceInput;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const ki = await resolveRow(c.tx, "knowledge_items", lib, input.knowledgeItemId);
    await inScope(c, w, { knowledgeItemId: ki.id }, `Knowledge item ${ki.displayId}`);
    if (input.source) return addSourceEvidence(c, lib, ki.id, input.source);
    if (input.external) return addExternal(c, w, ki.conceptId, ki.id, input.external);
    throw new DomainError("invalid", "Give either source or external evidence.");
  });
  return result;
}

export async function linkMedia(
  db: TDatabase,
  w: Writer,
  input: {
    mediaId: string;
    conceptId?: string;
    knowledgeItemId?: string;
    role: MediaLinkRole;
    component?: string;
    rationale?: string;
    relevance?: "essential" | "supporting" | "decorative" | "uncertain";
    description?: string;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const media = await resolveRow(c.tx, "media_assets", lib, input.mediaId);
    const concept = input.conceptId
      ? await resolveRow(c.tx, "concepts", lib, input.conceptId)
      : null;
    const ki = input.knowledgeItemId
      ? await resolveRow(c.tx, "knowledge_items", lib, input.knowledgeItemId)
      : null;
    if (!concept && !ki)
      throw new DomainError("invalid", "Link media to a concept or a knowledge item.");
    await inScope(c, w, { conceptId: concept?.id, knowledgeItemId: ki?.id }, "Media link");
    if (media.origin === "external") {
      await assertApproved(
        c.tx,
        lib,
        "visual_embed",
        { conceptId: concept?.id ?? ki?.conceptId ?? "" },
        "External image",
      );
    }
    if (input.role === "supports_claim" && (!input.component || !input.rationale)) {
      throw new DomainError(
        "invalid",
        "supports_claim links need the component shown and a rationale.",
      );
    }
    if (input.relevance || input.description) {
      await c.update("media_assets", media.id, {
        relevance: input.relevance ?? media.relevance,
        description: input.description ?? media.description,
      });
    }
    return c.insert("media_links", {
      mediaId: media.id,
      conceptId: concept?.id ?? null,
      knowledgeItemId: ki?.id ?? null,
      role: input.role,
      component: input.component ?? "",
      rationale: input.rationale ?? "",
    });
  });
  return result;
}

const TABLE_BY_PREFIX: Record<string, "concepts" | "knowledge_items" | "learning_objectives"> = {
  CON: "concepts",
  con: "concepts",
  KI: "knowledge_items",
  ki: "knowledge_items",
  LO: "learning_objectives",
  lo: "learning_objectives",
};

async function resolveAny(c: Changes, lib: string, id: string) {
  const prefix = id.split(/[-_]/)[0] ?? "";
  const table = TABLE_BY_PREFIX[prefix];
  if (!table)
    throw new DomainError(
      "invalid",
      `Expected a concept, knowledge item or objective id, got ${id}.`,
    );
  return (await resolveRow(c.tx, table, lib, id)).id;
}

export async function addRelationship(
  db: TDatabase,
  w: Writer,
  input: { fromId: string; toId: string; kind: RelationshipKind; note?: string },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) =>
    c.insert("relationships", {
      fromId: await resolveAny(c, lib, input.fromId),
      toId: await resolveAny(c, lib, input.toId),
      kind: input.kind,
      note: input.note ?? "",
    }),
  );
  return result;
}

export async function upsertLearningObjective(
  db: TDatabase,
  w: Writer,
  input: {
    id?: string;
    expectedVersion?: number;
    text: string;
    origin: "explicit" | "inferred";
    sourceUnitId?: string;
    verb?: string;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const unit = input.sourceUnitId
      ? await resolveRow(c.tx, "source_units", lib, input.sourceUnitId)
      : null;
    if (input.origin === "explicit" && !unit) {
      throw new DomainError(
        "invalid",
        "Explicit objectives need the source unit where they appear.",
      );
    }
    const values = {
      text: input.text,
      origin: input.origin,
      sourceUnitId: unit?.id ?? null,
      verb: input.verb ?? "",
    };
    if (input.id) {
      const lo = await resolveRow(c.tx, "learning_objectives", lib, input.id);
      return c.update("learning_objectives", lo.id, values, input.expectedVersion);
    }
    return c.insert("learning_objectives", {
      ...values,
      displayId: await nextDisplayId(c.tx, lib, "learning_objectives"),
    });
  });
  return result;
}

export async function mapObjective(
  db: TDatabase,
  w: Writer,
  input: {
    objectiveId: string;
    conceptId?: string;
    knowledgeItemId?: string;
    sourceCoverage: CoverageState;
    libraryCoverage: CoverageState;
    rationale: string;
  },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const lo = await resolveRow(c.tx, "learning_objectives", lib, input.objectiveId);
    const concept = input.conceptId
      ? await resolveRow(c.tx, "concepts", lib, input.conceptId)
      : null;
    const ki = input.knowledgeItemId
      ? await resolveRow(c.tx, "knowledge_items", lib, input.knowledgeItemId)
      : null;
    const [existing] = await c.tx
      .select()
      .from(tObjectiveMapping)
      .where(
        and(
          eq(tObjectiveMapping.objectiveId, lo.id),
          concept
            ? eq(tObjectiveMapping.conceptId, concept.id)
            : eq(tObjectiveMapping.knowledgeItemId, ki?.id ?? ""),
        ),
      );
    const values = {
      objectiveId: lo.id,
      conceptId: concept?.id ?? null,
      knowledgeItemId: ki?.id ?? null,
      sourceCoverage: input.sourceCoverage,
      libraryCoverage: input.libraryCoverage,
      rationale: input.rationale,
    };
    if (existing) return c.update("objective_mappings", existing.id, values);
    return c.insert("objective_mappings", values);
  });
  return result;
}

export async function recordCoverage(
  db: TDatabase,
  w: Writer,
  input: {
    sourceUnitId: string;
    outcome: CoverageOutcome;
    conceptIds?: string[];
    knowledgeItemIds?: string[];
    mediaIds?: string[];
    explanation?: string;
  },
) {
  const lib = w.ctx.libraryId;
  if (
    (input.outcome === "excluded_with_reason" || input.outcome === "requires_review") &&
    !input.explanation
  ) {
    throw new DomainError("invalid", `Outcome ${input.outcome} needs an explanation.`);
  }
  const { result } = await change(db, w.ctx, async (c) => {
    const unit = await resolveRow(c.tx, "source_units", lib, input.sourceUnitId);
    const values = {
      sourceUnitId: unit.id,
      outcome: input.outcome,
      conceptIds: await resolveIds(c.tx, "concepts", lib, input.conceptIds ?? []),
      knowledgeItemIds: await resolveIds(
        c.tx,
        "knowledge_items",
        lib,
        input.knowledgeItemIds ?? [],
      ),
      mediaIds: await resolveIds(c.tx, "media_assets", lib, input.mediaIds ?? []),
      explanation: input.explanation ?? "",
    };
    const [existing] = await c.tx
      .select()
      .from(tCoverageEntry)
      .where(eq(tCoverageEntry.sourceUnitId, unit.id));
    if (existing) return c.update("coverage_entries", existing.id, values);
    return c.insert("coverage_entries", values);
  });
  return result;
}

/** Moves the knowledge items of `fromIds` into `intoId`, deletes the emptied concepts, and records it. */
export async function mergeConcepts(
  db: TDatabase,
  w: Writer,
  input: { intoId: string; fromIds: string[]; reason: string },
) {
  const lib = w.ctx.libraryId;
  const { result } = await change(db, w.ctx, async (c) => {
    const into = await resolveRow(c.tx, "concepts", lib, input.intoId);
    await inScope(c, w, { conceptId: into.id }, `Concept ${into.displayId}`);
    const merged: string[] = [];
    for (const id of input.fromIds) {
      const from = await resolveRow(c.tx, "concepts", lib, id);
      await inScope(c, w, { conceptId: from.id }, `Concept ${from.displayId}`);
      assertMayEditUserContent(w, from);
      const kis = await c.tx
        .select()
        .from(tKnowledgeItem)
        .where(eq(tKnowledgeItem.conceptId, from.id));
      for (const ki of kis) await c.update("knowledge_items", ki.id, { conceptId: into.id });
      const links = await c.tx.select().from(tMediaLink).where(eq(tMediaLink.conceptId, from.id));
      for (const l of links) await c.update("media_links", l.id, { conceptId: into.id });
      await c.remove("concepts", from.id);
      merged.push(from.displayId);
    }
    await raiseReviewItem(c, {
      libraryId: lib,
      kind: "duplicate_consolidated",
      title: `Merged ${merged.join(", ")} into ${into.displayId}`,
      description: input.reason,
      targets: [{ table: "concepts", id: into.id }],
      raisedBy: w.ctx.actor === "user" ? "user" : "ai",
    });
    return { into: into.displayId, merged };
  });
  return result;
}

const DELETABLE = [
  "topics",
  "subtopics",
  "concepts",
  "knowledge_items",
  "evidence",
  "media_links",
  "relationships",
  "objective_mappings",
  "learning_objectives",
] as const;
export type DeletableTable = (typeof DELETABLE)[number];

export async function deleteItem(
  db: TDatabase,
  w: Writer,
  input: { table: DeletableTable; id: string; reason: string },
) {
  const lib = w.ctx.libraryId;
  if (!DELETABLE.includes(input.table))
    throw new DomainError("invalid", `Can't delete from ${input.table}.`);
  const { result } = await change(db, { ...w.ctx, note: input.reason }, async (c) => {
    const row = await resolveRow(c.tx, input.table, lib, input.id);
    if (input.table === "knowledge_items" || input.table === "concepts") {
      const r = row as { id: string; userEdited: boolean; displayId: string };
      assertMayEditUserContent(w, r);
      await inScope(
        c,
        w,
        input.table === "concepts" ? { conceptId: r.id } : { knowledgeItemId: r.id },
        r.displayId,
      );
    }
    const children: Record<string, { table: DeletableTable; column: string } | undefined> = {
      topics: { table: "subtopics", column: "topicId" },
      subtopics: { table: "concepts", column: "subtopicId" },
      concepts: { table: "knowledge_items", column: "conceptId" },
    };
    const child = children[input.table];
    if (child) {
      const t = { subtopics: tSubtopic, concepts: tConcept, knowledge_items: tKnowledgeItem }[
        child.table as "subtopics" | "concepts" | "knowledge_items"
      ];
      const col = (t as unknown as Record<string, Parameters<typeof eq>[0]>)[child.column];
      const kids = col
        ? await c.tx
            .select({ id: t.id })
            .from(t)
            .where(eq(col, row.id as string))
        : [];
      if (kids.length > 0)
        throw new DomainError("conflict", `Move or delete its ${kids.length} child item(s) first.`);
    }
    await c.remove(input.table, row.id as string);
    return { deleted: input.id };
  });
  return result;
}

/** Topic → subtopic → concept outline with knowledge item counts. */
export async function libraryOutline(db: TDb, libraryId: string, topicIds?: string[]) {
  const topics = await db
    .select()
    .from(tTopic)
    .where(
      topicIds
        ? and(
            eq(tTopic.libraryId, libraryId),
            inArray(tTopic.id, topicIds.length ? topicIds : [""]),
          )
        : eq(tTopic.libraryId, libraryId),
    )
    .orderBy(asc(tTopic.ordinal), asc(tTopic.displayId));
  const subtopics = await db
    .select()
    .from(tSubtopic)
    .where(eq(tSubtopic.libraryId, libraryId))
    .orderBy(asc(tSubtopic.ordinal), asc(tSubtopic.displayId));
  const concepts = await db
    .select()
    .from(tConcept)
    .where(eq(tConcept.libraryId, libraryId))
    .orderBy(asc(tConcept.ordinal), asc(tConcept.displayId));
  const kis = await db
    .select({
      id: tKnowledgeItem.id,
      conceptId: tKnowledgeItem.conceptId,
      priority: tKnowledgeItem.priority,
      status: tKnowledgeItem.interpretationStatus,
      excluded: tKnowledgeItem.excluded,
    })
    .from(tKnowledgeItem)
    .where(eq(tKnowledgeItem.libraryId, libraryId));
  return topics.map((t) => ({
    ...t,
    subtopics: subtopics
      .filter((s) => s.topicId === t.id)
      .map((s) => ({
        ...s,
        concepts: concepts
          .filter((c) => c.subtopicId === s.id)
          .map((c) => {
            const items = kis.filter((k) => k.conceptId === c.id);
            return {
              ...c,
              knowledgeItemCount: items.length,
              tentative: items.filter((k) => k.status !== "supported").length,
            };
          }),
      })),
  }));
}

export async function conceptDetail(db: TDb, libraryId: string, idOrDisplay: string) {
  const concept = await resolveRow(db, "concepts", libraryId, idOrDisplay);
  const knowledgeItems = await db
    .select()
    .from(tKnowledgeItem)
    .where(eq(tKnowledgeItem.conceptId, concept.id))
    .orderBy(asc(tKnowledgeItem.ordinal), asc(tKnowledgeItem.displayId));
  const kiIds = knowledgeItems.map((k) => k.id);
  const evidence = kiIds.length
    ? await db.select().from(tEvidence).where(inArray(tEvidence.knowledgeItemId, kiIds))
    : [];
  const unitIds = evidence.map((e) => e.sourceUnitId).filter((id): id is string => Boolean(id));
  const units = unitIds.length
    ? await db
        .select({
          id: tSourceUnit.id,
          displayId: tSourceUnit.displayId,
          sourceId: tSourceUnit.sourceId,
        })
        .from(tSourceUnit)
        .where(inArray(tSourceUnit.id, unitIds))
    : [];
  const links = await db
    .select({ link: tMediaLink, media: tMediaAsset })
    .from(tMediaLink)
    .innerJoin(tMediaAsset, eq(tMediaLink.mediaId, tMediaAsset.id))
    .where(
      or(
        eq(tMediaLink.conceptId, concept.id),
        kiIds.length ? inArray(tMediaLink.knowledgeItemId, kiIds) : eq(tMediaLink.id, ""),
      ),
    );
  const relationships = await db
    .select()
    .from(tRelationship)
    .where(
      or(
        inArray(tRelationship.fromId, [concept.id, ...kiIds]),
        inArray(tRelationship.toId, [concept.id, ...kiIds]),
      ),
    );
  const mappings = await db
    .select({ mapping: tObjectiveMapping, objective: tLearningObjective })
    .from(tObjectiveMapping)
    .innerJoin(tLearningObjective, eq(tObjectiveMapping.objectiveId, tLearningObjective.id))
    .where(
      or(
        eq(tObjectiveMapping.conceptId, concept.id),
        kiIds.length
          ? inArray(tObjectiveMapping.knowledgeItemId, kiIds)
          : eq(tObjectiveMapping.id, ""),
      ),
    );
  const subtopic = await resolveRow(db, "subtopics", libraryId, concept.subtopicId);
  return {
    concept,
    subtopic,
    knowledgeItems,
    evidence: evidence.map((e) => ({
      ...e,
      unit: units.find((u) => u.id === e.sourceUnitId) ?? null,
    })),
    media: links,
    relationships,
    objectives: mappings,
  };
}

export async function searchKnowledge(db: TDb, libraryId: string, query: string, limit = 30) {
  const q = `%${query.replace(/[%_]/g, "")}%`;
  const concepts = await db
    .select({ id: tConcept.id, displayId: tConcept.displayId, title: tConcept.title })
    .from(tConcept)
    .where(
      and(
        eq(tConcept.libraryId, libraryId),
        or(like(tConcept.title, q), like(tConcept.explanation, q)),
      ),
    )
    .limit(limit);
  const items = await db
    .select({
      id: tKnowledgeItem.id,
      displayId: tKnowledgeItem.displayId,
      statement: tKnowledgeItem.statement,
      conceptId: tKnowledgeItem.conceptId,
    })
    .from(tKnowledgeItem)
    .where(and(eq(tKnowledgeItem.libraryId, libraryId), like(tKnowledgeItem.statement, q)))
    .limit(limit);
  return { concepts, knowledgeItems: items };
}

export async function objectivesWithCoverage(db: TDb, libraryId: string) {
  const objectives = await db
    .select()
    .from(tLearningObjective)
    .where(eq(tLearningObjective.libraryId, libraryId))
    .orderBy(asc(tLearningObjective.displayId));
  const mappings = await db
    .select()
    .from(tObjectiveMapping)
    .where(eq(tObjectiveMapping.libraryId, libraryId));
  return objectives.map((o) => ({
    ...o,
    mappings: mappings.filter((m) => m.objectiveId === o.id),
  }));
}
