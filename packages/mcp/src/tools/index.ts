import type { ToolDef } from "../tool.ts";
import { completeJob, getSettings, getWorkflowState, ping, saveSessionSummary } from "./common.ts";
import * as enrichment from "./enrichment.ts";
import * as knowledge from "./knowledge.ts";
import * as review from "./review.ts";
import * as sources from "./sources.ts";

export const allTools = [
  ping,
  getWorkflowState,
  completeJob,
  saveSessionSummary,
  getSettings,
  ...Object.values(sources),
  ...Object.values(knowledge),
  ...Object.values(review),
  ...Object.values(enrichment),
] as ToolDef[];
