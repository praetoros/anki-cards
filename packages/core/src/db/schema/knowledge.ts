import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type {
  CoverageState,
  InterpretationStatus,
  KnowledgeType,
  MediaLinkRole,
  Origin,
  Priority,
  RelationshipKind,
  VerificationOutcome,
} from "../../domain/enums.ts";
import { trackedCols } from "../helpers.ts";

export const tTopic = sqliteTable(
  "topics",
  {
    ...trackedCols,
    displayId: text().notNull(),
    title: text().notNull(),
    overview: text().notNull().default(""),
    ordinal: integer().notNull().default(0),
    excluded: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("topics_library_idx").on(t.libraryId)],
);

export const tSubtopic = sqliteTable(
  "subtopics",
  {
    ...trackedCols,
    displayId: text().notNull(),
    topicId: text().notNull(),
    title: text().notNull(),
    overview: text().notNull().default(""),
    ordinal: integer().notNull().default(0),
    excluded: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("subtopics_topic_idx").on(t.topicId)],
);

export const tConcept = sqliteTable(
  "concepts",
  {
    ...trackedCols,
    displayId: text().notNull(),
    subtopicId: text().notNull(),
    title: text().notNull(),
    explanation: text().notNull().default(""),
    interpretationStatus: text().$type<InterpretationStatus>().notNull().default("supported"),
    ordinal: integer().notNull().default(0),
    excluded: integer({ mode: "boolean" }).notNull().default(false),
    userEdited: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("concepts_subtopic_idx").on(t.subtopicId)],
);

export const tKnowledgeItem = sqliteTable(
  "knowledge_items",
  {
    ...trackedCols,
    displayId: text().notNull(),
    conceptId: text().notNull(),
    statement: text().notNull(),
    types: text({ mode: "json" }).$type<KnowledgeType[]>().notNull(),
    priority: text().$type<Priority>().notNull(),
    origin: text().$type<Origin>().notNull(),
    interpretationStatus: text().$type<InterpretationStatus>().notNull(),
    ordinal: integer().notNull().default(0),
    excluded: integer({ mode: "boolean" }).notNull().default(false),
    userEdited: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("knowledge_items_concept_idx").on(t.conceptId)],
);

export interface ExternalReference {
  url: string;
  title: string;
  publisher: string;
  date?: string;
  passage: string;
  figure?: string;
  trusted?: boolean;
}

export const tEvidence = sqliteTable(
  "evidence",
  {
    ...trackedCols,
    knowledgeItemId: text().notNull(),
    kind: text().$type<Origin>().notNull(),
    sourceUnitId: text(),
    external: text({ mode: "json" }).$type<ExternalReference | null>(),
    note: text().notNull().default(""),
    verification: text().$type<VerificationOutcome>().notNull(),
    approvalId: text(),
  },
  (t) => [index("evidence_ki_idx").on(t.knowledgeItemId)],
);

export const tMediaLink = sqliteTable(
  "media_links",
  {
    ...trackedCols,
    mediaId: text().notNull(),
    conceptId: text(),
    knowledgeItemId: text(),
    role: text().$type<MediaLinkRole>().notNull(),
    component: text().notNull().default(""),
    rationale: text().notNull().default(""),
  },
  (t) => [index("media_links_media_idx").on(t.mediaId)],
);

export const tRelationship = sqliteTable("relationships", {
  ...trackedCols,
  fromId: text().notNull(),
  toId: text().notNull(),
  kind: text().$type<RelationshipKind>().notNull(),
  note: text().notNull().default(""),
});

export const tLearningObjective = sqliteTable(
  "learning_objectives",
  {
    ...trackedCols,
    displayId: text().notNull(),
    text: text().notNull(),
    origin: text().$type<"explicit" | "inferred">().notNull(),
    sourceUnitId: text(),
    verb: text().notNull().default(""),
  },
  (t) => [index("learning_objectives_library_idx").on(t.libraryId)],
);

export const tObjectiveMapping = sqliteTable(
  "objective_mappings",
  {
    ...trackedCols,
    objectiveId: text().notNull(),
    conceptId: text(),
    knowledgeItemId: text(),
    sourceCoverage: text().$type<CoverageState>().notNull(),
    libraryCoverage: text().$type<CoverageState>().notNull(),
    rationale: text().notNull().default(""),
  },
  (t) => [index("objective_mappings_objective_idx").on(t.objectiveId)],
);

export type TTopicS = typeof tTopic.$inferSelect;
export type TSubtopicS = typeof tSubtopic.$inferSelect;
export type TConceptS = typeof tConcept.$inferSelect;
export type TKnowledgeItemS = typeof tKnowledgeItem.$inferSelect;
export type TEvidenceS = typeof tEvidence.$inferSelect;
export type TMediaLinkS = typeof tMediaLink.$inferSelect;
export type TRelationshipS = typeof tRelationship.$inferSelect;
export type TLearningObjectiveS = typeof tLearningObjective.$inferSelect;
export type TObjectiveMappingS = typeof tObjectiveMapping.$inferSelect;
