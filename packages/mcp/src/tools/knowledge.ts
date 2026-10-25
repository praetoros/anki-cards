import {
  addEvidence,
  addRelationship,
  conceptDetail,
  COVERAGE_OUTCOMES,
  COVERAGE_STATES,
  deleteItem,
  INTERPRETATION_STATUSES,
  KNOWLEDGE_TYPES,
  libraryOutline,
  linkMedia,
  mapObjective,
  MEDIA_LINK_ROLES,
  mergeConcepts,
  objectivesWithCoverage,
  PRIORITIES,
  recordCoverage,
  RELATIONSHIP_KINDS,
  searchKnowledge,
  upsertConcept,
  upsertKnowledgeItem,
  upsertLearningObjective,
  upsertSubtopic,
  upsertTopic,
  VERIFICATION_OUTCOMES,
  type Writer,
} from "@anki-cards/core";
import { z } from "zod";

import { defineTool, type ToolContext } from "../tool.ts";

const id = (what: string) => z.string().describe(`${what} id or display id`);
const version = z
  .number()
  .int()
  .optional()
  .describe("Required when updating: the version you read");
const reviewItemId = z
  .string()
  .optional()
  .describe("The review item this change answers, when processing feedback");

function writer(ctx: ToolContext, action: string, reviewItem?: string): Writer {
  return {
    ctx: { ...ctx.change(action, { reviewItemId: reviewItem ?? null }), libraryId: ctx.libraryId },
    session: ctx.session,
  };
}

const sourceEvidence = z.object({ sourceUnitId: id("Source unit"), note: z.string().optional() });
const externalEvidence = z.object({
  url: z.string().url(),
  title: z.string(),
  publisher: z.string(),
  date: z.string().optional(),
  passage: z.string().describe("The exact passage that supports the statement"),
  figure: z.string().optional(),
  trusted: z.boolean().optional().describe("Whether the source is on the trusted-source list"),
  verification: z.enum(VERIFICATION_OUTCOMES).optional(),
});

export const getLibraryOutline = defineTool({
  name: "get_library_outline",
  description: "The topic → subtopic → concept tree with ids, versions and knowledge item counts.",
  input: z.object({}),
  readOnly: true,
  run: async (_a, ctx) => {
    const scope = ctx.session.scope.kind === "library" ? undefined : ctx.session.scope.topicIds;
    return (await libraryOutline(ctx.runtime.db, ctx.libraryId, scope)).map((t) => ({
      id: t.id,
      displayId: t.displayId,
      version: t.version,
      title: t.title,
      subtopics: t.subtopics.map((s) => ({
        id: s.id,
        displayId: s.displayId,
        version: s.version,
        title: s.title,
        concepts: s.concepts.map((c) => ({
          id: c.id,
          displayId: c.displayId,
          version: c.version,
          title: c.title,
          knowledgeItems: c.knowledgeItemCount,
          userEdited: c.userEdited,
          excluded: c.excluded,
        })),
      })),
    }));
  },
});

export const getConcept = defineTool({
  name: "get_concept",
  description:
    "Full concept: explanation, knowledge items with evidence, media links, relationships and objective mappings.",
  input: z.object({ conceptId: id("Concept") }),
  readOnly: true,
  run: async ({ conceptId }, ctx) => conceptDetail(ctx.runtime.db, ctx.libraryId, conceptId),
});

export const searchKnowledgeTool = defineTool({
  name: "search_knowledge",
  description:
    "Find concepts and knowledge items by text, to avoid duplicates before creating new ones.",
  input: z.object({ query: z.string().min(2) }),
  readOnly: true,
  run: async ({ query }, ctx) => searchKnowledge(ctx.runtime.db, ctx.libraryId, query),
});

export const upsertTopicTool = defineTool({
  name: "upsert_topic",
  description: "Create a topic (omit id) or update one (id + expectedVersion).",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: version,
    title: z.string(),
    overview: z.string().optional(),
    ordinal: z.number().int().optional(),
  }),
  run: (a, ctx) => upsertTopic(ctx.runtime.db, writer(ctx, "upsert_topic"), a),
});

export const upsertSubtopicTool = defineTool({
  name: "upsert_subtopic",
  description: "Create or update a subtopic under a topic.",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: version,
    topicId: id("Topic"),
    title: z.string(),
    overview: z.string().optional(),
    ordinal: z.number().int().optional(),
  }),
  run: (a, ctx) => upsertSubtopic(ctx.runtime.db, writer(ctx, "upsert_subtopic"), a),
});

export const upsertConceptTool = defineTool({
  name: "upsert_concept",
  description:
    "Create or update a concept. `explanation` is the readable synthesis (Markdown) and must agree with its knowledge items.",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: version,
    subtopicId: id("Subtopic"),
    title: z.string(),
    explanation: z.string().optional(),
    interpretationStatus: z.enum(INTERPRETATION_STATUSES).optional(),
    ordinal: z.number().int().optional(),
    reviewItemId,
  }),
  run: (a, ctx) => upsertConcept(ctx.runtime.db, writer(ctx, "upsert_concept", a.reviewItemId), a),
});

export const upsertKnowledgeItemTool = defineTool({
  name: "upsert_knowledge_item",
  description:
    "Create or update one atomic knowledge item. Source items need sourceEvidence; external items need an enrichment approval and externalEvidence with the exact passage.",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: version,
    conceptId: id("Concept"),
    statement: z.string(),
    types: z.array(z.enum(KNOWLEDGE_TYPES)).min(1),
    priority: z.enum(PRIORITIES),
    origin: z.enum(["source", "external"]),
    interpretationStatus: z.enum(INTERPRETATION_STATUSES),
    ordinal: z.number().int().optional(),
    sourceEvidence: z.array(sourceEvidence).optional(),
    externalEvidence: z.array(externalEvidence).optional(),
    reviewItemId,
  }),
  run: async (a, ctx) => {
    const ki = await upsertKnowledgeItem(
      ctx.runtime.db,
      writer(ctx, "upsert_knowledge_item", a.reviewItemId),
      a,
    );
    return { id: ki.id, displayId: ki.displayId, version: ki.version };
  },
});

export const addEvidenceTool = defineTool({
  name: "add_evidence",
  description: "Attach source evidence (a source unit) to a knowledge item.",
  input: z.object({ knowledgeItemId: id("Knowledge item"), source: sourceEvidence }),
  run: (a, ctx) => addEvidence(ctx.runtime.db, writer(ctx, "add_evidence"), a),
});

export const addExternalEvidenceTool = defineTool({
  name: "add_external_evidence",
  description:
    "Attach an external citation to a knowledge item inside an approved enrichment scope. Rejected without url, title, publisher and the exact passage.",
  input: z.object({ knowledgeItemId: id("Knowledge item"), external: externalEvidence }),
  run: (a, ctx) => addEvidence(ctx.runtime.db, writer(ctx, "add_external_evidence"), a),
});

export const linkMediaTool = defineTool({
  name: "link_media",
  description:
    "Associate a media asset with a concept or knowledge item. Use role supports_claim only when the image itself shows the claim (give component and rationale); otherwise contextual.",
  input: z.object({
    mediaId: id("Media"),
    conceptId: z.string().optional(),
    knowledgeItemId: z.string().optional(),
    role: z.enum(MEDIA_LINK_ROLES),
    component: z.string().optional(),
    rationale: z.string().optional(),
    relevance: z.enum(["essential", "supporting", "decorative", "uncertain"]).optional(),
    description: z.string().optional().describe("What the image shows, transcribed literally"),
  }),
  run: (a, ctx) => linkMedia(ctx.runtime.db, writer(ctx, "link_media"), a),
});

export const addRelationshipTool = defineTool({
  name: "add_relationship",
  description: "Record a relationship between concepts, knowledge items or objectives.",
  input: z.object({
    fromId: z.string(),
    toId: z.string(),
    kind: z.enum(RELATIONSHIP_KINDS),
    note: z.string().optional(),
  }),
  run: (a, ctx) => addRelationship(ctx.runtime.db, writer(ctx, "add_relationship"), a),
});

export const upsertLearningObjectiveTool = defineTool({
  name: "upsert_learning_objective",
  description:
    "Record a learning objective. Explicit ones keep the lecturer's exact wording and the source unit; inferred ones are labelled inferred.",
  input: z.object({
    id: z.string().optional(),
    expectedVersion: version,
    text: z.string(),
    origin: z.enum(["explicit", "inferred"]),
    sourceUnitId: z.string().optional(),
    verb: z.string().optional().describe("identify, describe, explain, compare, apply…"),
  }),
  run: (a, ctx) =>
    upsertLearningObjective(ctx.runtime.db, writer(ctx, "upsert_learning_objective"), a),
});

export const mapObjectiveTool = defineTool({
  name: "map_objective",
  description:
    "Map an objective to a concept or knowledge item with source coverage and library coverage, each judged against the learning verb from evidence.",
  input: z.object({
    objectiveId: id("Learning objective"),
    conceptId: z.string().optional(),
    knowledgeItemId: z.string().optional(),
    sourceCoverage: z.enum(COVERAGE_STATES),
    libraryCoverage: z.enum(COVERAGE_STATES),
    rationale: z.string(),
  }),
  run: (a, ctx) => mapObjective(ctx.runtime.db, writer(ctx, "map_objective"), a),
});

export const listObjectives = defineTool({
  name: "list_objectives",
  description: "Learning objectives with their mappings.",
  input: z.object({}),
  readOnly: true,
  run: (_a, ctx) => objectivesWithCoverage(ctx.runtime.db, ctx.libraryId),
});

export const recordCoverageTool = defineTool({
  name: "record_coverage",
  description:
    "Record what happened to a source unit: where its content went, or why it was excluded or needs review.",
  input: z.object({
    sourceUnitId: id("Source unit"),
    outcome: z.enum(COVERAGE_OUTCOMES),
    conceptIds: z.array(z.string()).optional(),
    knowledgeItemIds: z.array(z.string()).optional(),
    mediaIds: z.array(z.string()).optional(),
    explanation: z.string().optional(),
  }),
  run: (a, ctx) => recordCoverage(ctx.runtime.db, writer(ctx, "record_coverage"), a),
});

export const mergeConceptsTool = defineTool({
  name: "merge_concepts",
  description:
    "Merge duplicate concepts into one, moving their knowledge items. Records an informational review item.",
  input: z.object({
    intoId: id("Concept"),
    fromIds: z.array(z.string()).min(1),
    reason: z.string(),
  }),
  run: (a, ctx) => mergeConcepts(ctx.runtime.db, writer(ctx, "merge_concepts"), a),
});

export const deleteItemTool = defineTool({
  name: "delete_item",
  description:
    "Delete a topic, subtopic, concept, knowledge item, evidence, media link, relationship, objective or mapping. Containers must be empty.",
  input: z.object({
    table: z.enum([
      "topics",
      "subtopics",
      "concepts",
      "knowledge_items",
      "evidence",
      "media_links",
      "relationships",
      "objective_mappings",
      "learning_objectives",
    ]),
    id: z.string(),
    reason: z.string(),
    reviewItemId,
  }),
  run: (a, ctx) => deleteItem(ctx.runtime.db, writer(ctx, "delete_item", a.reviewItemId), a),
});
