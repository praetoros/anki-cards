import type { JobKind } from "../domain/enums.ts";

export const TOOL_GROUPS = {
  common: [
    "ping",
    "get_workflow_state",
    "get_library_outline",
    "get_concept",
    "search_knowledge",
    "list_review_items",
    "get_review_item",
    "reply_to_review_item",
    "raise_review_item",
    "save_session_summary",
    "get_settings",
    "list_objectives",
    "complete_job",
  ],
  sources: ["list_sources", "get_source_outline", "read_source_unit", "get_media"],
  synthesis: [
    "register_source",
    "upsert_topic",
    "upsert_subtopic",
    "upsert_concept",
    "upsert_knowledge_item",
    "add_evidence",
    "link_media",
    "add_relationship",
    "upsert_learning_objective",
    "map_objective",
    "record_coverage",
    "merge_concepts",
    "delete_item",
  ],
  enrichment: ["add_external_evidence", "propose_external_media"],
  planning: ["propose_card_plan", "update_card_plan_row"],
  generation: ["upsert_card", "propose_occlusion_masks", "retire_card", "get_card"],
} as const;

type Group = keyof typeof TOOL_GROUPS;

const KIND_GROUPS: Record<JobKind, Group[]> = {
  ping: [],
  synthesis: ["common", "sources", "synthesis"],
  feedback: ["common", "sources", "synthesis", "planning", "generation"],
  enrichment: ["common", "sources", "synthesis", "enrichment"],
  planning: ["common", "sources", "planning"],
  generation: ["common", "sources", "generation"],
  card_review: ["common", "sources", "generation"],
  chat: ["common", "sources", "synthesis", "enrichment", "planning", "generation"],
  compact: [],
};

export function toolsForJob(kind: JobKind): string[] {
  if (kind === "ping") return ["ping", "complete_job"];
  if (kind === "compact") return ["get_workflow_state", "save_session_summary", "complete_job"];
  return [...new Set(KIND_GROUPS[kind].flatMap((g) => TOOL_GROUPS[g]))];
}

/** Jobs that may use web search (enrichment, and chat when enrichment is enabled). */
export function jobUsesWeb(kind: JobKind, enrichmentMode: string): boolean {
  if (enrichmentMode === "none") return false;
  return kind === "enrichment" || kind === "chat" || kind === "feedback";
}
