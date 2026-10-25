import { addJobEvent, change, getSetting, workflowState } from "@anki-cards/core";
import { z } from "zod";

import { defineTool } from "../tool.ts";

export const ping = defineTool({
  name: "ping",
  description:
    "Check the connection to the Anki Cards app. Returns the library and job you are working on.",
  input: z.object({}),
  readOnly: true,
  run: async (_args, ctx) => ({
    ok: true,
    library: ctx.libraryId,
    session: ctx.session.id,
    job: ctx.job.id,
    kind: ctx.job.kind,
  }),
});

export const getWorkflowState = defineTool({
  name: "get_workflow_state",
  description:
    "Start here. Returns the library, your session scope, this job's task, pending user feedback, counts, and what to do next.",
  input: z.object({}),
  readOnly: true,
  run: (_args, ctx) => workflowState(ctx.runtime.db, ctx.session, ctx.job),
});

export const completeJob = defineTool({
  name: "complete_job",
  description:
    "Call once when the job is finished. Give a short summary for the user: what you changed (display ids) and what they should review.",
  input: z.object({ summary: z.string().min(1) }),
  run: async ({ summary }, ctx) => {
    await addJobEvent(ctx.runtime.db, ctx.job, "summary", { text: summary });
    return "Recorded. The job is complete; stop now.";
  },
});

export const saveSessionSummary = defineTool({
  name: "save_session_summary",
  description:
    "Write the handoff summary for this session before it is replaced: decisions made, open items, user preferences, where work stopped. A new session starts from it.",
  input: z.object({ body: z.string().min(20) }),
  run: async ({ body }, ctx) => {
    const { result } = await change(ctx.runtime.db, ctx.change("save_session_summary"), (c) =>
      c.insert("session_summaries", { sessionId: ctx.session.id, body }),
    );
    return { saved: result.id };
  },
});

export const getSettings = defineTool({
  name: "get_settings",
  description: "Card, enrichment and export settings that apply to this library.",
  input: z.object({}),
  readOnly: true,
  run: async (_args, ctx) => {
    const db = ctx.runtime.db;
    const lib = ctx.libraryId;
    return {
      enrichmentMode: await getSetting(db, "enrichment.mode", lib),
      cardTypes: await getSetting(db, "cards.types", lib),
      priorities: await getSetting(db, "cards.priorities", lib),
      maxClozePerNote: await getSetting(db, "cards.maxClozePerNote", lib),
      uncertainKnowledge: await getSetting(db, "cards.uncertainKnowledge", lib),
      styleInstructions: await getSetting(db, "cards.styleInstructions", lib),
    };
  },
});
