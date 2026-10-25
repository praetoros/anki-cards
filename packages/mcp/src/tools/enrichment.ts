import { listTrustedSources, proposeExternalMedia } from "@anki-cards/core";
import { z } from "zod";

import { defineTool } from "../tool.ts";

export const proposeExternalMediaTool = defineTool({
  name: "propose_external_media",
  description:
    "Propose an external image for concepts whose approval includes visual search. The app downloads it and asks the user to approve embedding. Give the licence and attribution exactly as the source states them.",
  input: z.object({
    imageUrl: z.string().url().describe("Direct URL of the image file"),
    pageUrl: z.string().url().describe("The page the image appears on"),
    creator: z.string(),
    licence: z.string().describe("e.g. CC BY-NC-SA 3.0; 'unknown' if not stated"),
    attribution: z.string(),
    purpose: z.string().describe("What the image shows and why it helps learning"),
    conceptIds: z.array(z.string()).min(1),
  }),
  run: async (a, ctx) => {
    const item = await proposeExternalMedia(
      ctx.runtime.db,
      ctx.runtime.paths,
      { libraryId: ctx.libraryId, jobId: ctx.job.id, sessionId: ctx.session.id },
      a,
    );
    return { reviewItem: item.displayId, status: "waiting for the user's approval" };
  },
});

export const listTrustedSourcesTool = defineTool({
  name: "list_trusted_sources",
  description: "Domains on the trusted-source list. Prefer these; others are flagged for the user.",
  input: z.object({}),
  readOnly: true,
  run: async (_a, ctx) =>
    (await listTrustedSources(ctx.runtime.db, ctx.libraryId)).map((t) => t.domain),
});
