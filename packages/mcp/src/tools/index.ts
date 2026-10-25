import type { ToolDef } from "../tool.ts";
import { completeJob, getSettings, getWorkflowState, ping, saveSessionSummary } from "./common.ts";

export const allTools: ToolDef[] = [
  ping,
  getWorkflowState,
  completeJob,
  saveSessionSummary,
  getSettings,
] as ToolDef[];
