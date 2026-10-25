export const STAGES = ["synthesis", "planning", "generation", "review", "export"] as const;
export type Stage = (typeof STAGES)[number];

export const GATES = ["synthesis", "card_plan", "card_set"] as const;
export type Gate = (typeof GATES)[number];

export const UNIT_TYPES = [
  "page",
  "slide",
  "text",
  "table",
  "equation",
  "figure",
  "diagram",
  "visual_component",
  "media",
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const EXTRACTION_STATUSES = ["pending", "extracting", "extracted", "failed"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const COVERAGE_OUTCOMES = [
  "incorporated",
  "consolidated",
  "preserved_as_visual",
  "excluded_with_reason",
  "requires_review",
  "unprocessed",
] as const;
export type CoverageOutcome = (typeof COVERAGE_OUTCOMES)[number];

export const KNOWLEDGE_TYPES = [
  "definition",
  "structure",
  "function",
  "mechanism",
  "process",
  "cause_effect",
  "comparison",
  "numerical",
  "clinical_application",
  "exception",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const PRIORITIES = ["P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ORIGINS = ["source", "external"] as const;
export type Origin = (typeof ORIGINS)[number];

export const INTERPRETATION_STATUSES = ["supported", "tentative", "unresolved"] as const;
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number];

export const VERIFICATION_OUTCOMES = [
  "directly_supported",
  "defensible_synthesis",
  "unverified",
  "disputed",
] as const;
export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

export const MEDIA_RELEVANCE = ["essential", "supporting", "decorative", "uncertain"] as const;
export type MediaRelevance = (typeof MEDIA_RELEVANCE)[number];

export const MEDIA_LINK_ROLES = ["supports_claim", "contextual"] as const;
export type MediaLinkRole = (typeof MEDIA_LINK_ROLES)[number];

export const RELATIONSHIP_KINDS = [
  "prerequisite",
  "part_of",
  "causes_or_enables",
  "contrasts_with",
  "applied_in",
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const COVERAGE_STATES = ["covered", "partial", "gap", "uncertain"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export const REVIEW_KINDS = [
  "extraction_limitation",
  "interpretation",
  "contradiction",
  "correction",
  "gap",
  "enrichment_request",
  "visual_proposal",
  "duplicate_consolidated",
  "card_issue",
  "card_plan",
  "feedback",
  "stage_gate",
  "job_failure",
  "repeated_tool_error",
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_CATEGORIES = [
  "requires_decision",
  "recommended_review",
  "informational",
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export const REVIEW_STATUSES = ["open", "awaiting_ai", "resolved", "deferred", "excluded"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_ACTIONS = [
  "approve",
  "reject",
  "defer",
  "exclude",
  "correct",
  "comment",
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const APPROVAL_KINDS = [
  "text_enrichment",
  "visual_search",
  "visual_embed",
  "correction",
  "gate",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const CARD_TYPES = [
  "basic",
  "reversed",
  "cloze",
  "image_occlusion",
  "image_question",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_STATUSES = ["draft", "approved", "retired"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const PLAN_ROW_STATUSES = ["proposed", "accepted", "rejected", "generated"] as const;
export type PlanRowStatus = (typeof PLAN_ROW_STATUSES)[number];

export const SESSION_KINDS = ["ingest", "topic", "chat"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["idle", "running", "archived"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "waiting",
  "paused",
  "failed",
  "cancelled",
  "done",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGERS = ["button", "auto", "resume", "chat", "test"] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const JOB_KINDS = [
  "ping",
  "synthesis",
  "feedback",
  "enrichment",
  "planning",
  "generation",
  "card_review",
  "chat",
  "compact",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const PROVIDERS = ["codex", "claude"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const ACTORS = ["user", "ai", "system"] as const;
export type Actor = (typeof ACTORS)[number];
