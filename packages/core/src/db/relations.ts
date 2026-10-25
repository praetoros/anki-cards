import { defineRelations } from "drizzle-orm";

import { schema } from "./schema/index.ts";

export const relations = defineRelations(schema, (r) => ({
  tTopic: {
    subtopics: r.many.tSubtopic(),
  },
  tSubtopic: {
    topic: r.one.tTopic({ from: r.tSubtopic.topicId, to: r.tTopic.id }),
    concepts: r.many.tConcept(),
  },
  tConcept: {
    subtopic: r.one.tSubtopic({ from: r.tConcept.subtopicId, to: r.tSubtopic.id }),
    knowledgeItems: r.many.tKnowledgeItem(),
  },
  tKnowledgeItem: {
    concept: r.one.tConcept({ from: r.tKnowledgeItem.conceptId, to: r.tConcept.id }),
    evidence: r.many.tEvidence(),
  },
  tEvidence: {
    knowledgeItem: r.one.tKnowledgeItem({
      from: r.tEvidence.knowledgeItemId,
      to: r.tKnowledgeItem.id,
    }),
  },
  tSource: {
    units: r.many.tSourceUnit(),
  },
  tSourceUnit: {
    source: r.one.tSource({ from: r.tSourceUnit.sourceId, to: r.tSource.id }),
  },
  tReviewItem: {
    targets: r.many.tReviewItemTarget(),
    messages: r.many.tReviewMessage(),
  },
  tReviewItemTarget: {
    reviewItem: r.one.tReviewItem({ from: r.tReviewItemTarget.reviewItemId, to: r.tReviewItem.id }),
  },
  tReviewMessage: {
    reviewItem: r.one.tReviewItem({ from: r.tReviewMessage.reviewItemId, to: r.tReviewItem.id }),
  },
  tCardPlan: {
    rows: r.many.tCardPlanRow(),
  },
  tCardPlanRow: {
    plan: r.one.tCardPlan({ from: r.tCardPlanRow.planId, to: r.tCardPlan.id }),
  },
  tJob: {
    events: r.many.tJobEvent(),
  },
  tJobEvent: {
    job: r.one.tJob({ from: r.tJobEvent.jobId, to: r.tJob.id }),
  },
}));
