import { tCard, tCardPlan, tCardPlanRow, tOcclusionMask } from "./cards.ts";
import {
  tConcept,
  tEvidence,
  tKnowledgeItem,
  tLearningObjective,
  tMediaLink,
  tObjectiveMapping,
  tRelationship,
  tSubtopic,
  tTopic,
} from "./knowledge.ts";
import { tLibrary, tSetting, tTrustedSource } from "./library.ts";
import {
  tBackup,
  tChangeset,
  tDisplayCounter,
  tExport,
  tJob,
  tJobEvent,
  tProviderCheck,
  tRowVersion,
  tSession,
  tSessionSummary,
  tSessionToken,
  tSnapshot,
} from "./ops.ts";
import { tApproval, tReviewItem, tReviewItemTarget, tReviewMessage } from "./review.ts";
import { tCoverageEntry, tMediaAsset, tSource, tSourceUnit } from "./source.ts";

export * from "./cards.ts";
export * from "./knowledge.ts";
export * from "./library.ts";
export * from "./ops.ts";
export * from "./review.ts";
export * from "./source.ts";

/** Tables whose every write is recorded in `row_versions`, keyed by SQL table name. */
export const trackedTables = {
  libraries: tLibrary,
  settings: tSetting,
  trusted_sources: tTrustedSource,
  sources: tSource,
  source_units: tSourceUnit,
  media_assets: tMediaAsset,
  coverage_entries: tCoverageEntry,
  topics: tTopic,
  subtopics: tSubtopic,
  concepts: tConcept,
  knowledge_items: tKnowledgeItem,
  evidence: tEvidence,
  media_links: tMediaLink,
  relationships: tRelationship,
  learning_objectives: tLearningObjective,
  objective_mappings: tObjectiveMapping,
  review_items: tReviewItem,
  review_item_targets: tReviewItemTarget,
  review_messages: tReviewMessage,
  approvals: tApproval,
  card_plans: tCardPlan,
  card_plan_rows: tCardPlanRow,
  cards: tCard,
  occlusion_masks: tOcclusionMask,
  session_summaries: tSessionSummary,
} as const;

export type TrackedTableName = keyof typeof trackedTables;

export const schema = {
  tLibrary,
  tSetting,
  tTrustedSource,
  tSource,
  tSourceUnit,
  tMediaAsset,
  tCoverageEntry,
  tTopic,
  tSubtopic,
  tConcept,
  tKnowledgeItem,
  tEvidence,
  tMediaLink,
  tRelationship,
  tLearningObjective,
  tObjectiveMapping,
  tReviewItem,
  tReviewItemTarget,
  tReviewMessage,
  tApproval,
  tCardPlan,
  tCardPlanRow,
  tCard,
  tOcclusionMask,
  tSessionSummary,
  tChangeset,
  tRowVersion,
  tSnapshot,
  tSession,
  tSessionToken,
  tJob,
  tJobEvent,
  tExport,
  tBackup,
  tProviderCheck,
  tDisplayCounter,
};
