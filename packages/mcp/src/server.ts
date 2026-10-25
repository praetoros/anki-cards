import { toolsForJob, type Runtime, type TJobS, type TSessionS } from "@anki-cards/core";
import { McpServer } from "@modelcontextprotocol/server";

import { annotationsFor, toError, toResult, type ToolContext, type ToolDef } from "./tool.ts";
import { allTools } from "./tools/index.ts";

export function buildServer(runtime: Runtime, session: TSessionS, job: TJobS | undefined) {
  const server = new McpServer({ name: "anki-cards", version: "0.1.0" });
  if (!job) return server;
  const allowed = new Set(toolsForJob(job.kind));
  const ctx: ToolContext = {
    runtime,
    session,
    job,
    libraryId: session.libraryId,
    change: (action, extra) => ({
      actor: "ai",
      action,
      libraryId: session.libraryId,
      jobId: job.id,
      sessionId: session.id,
      ...extra,
    }),
  };
  for (const tool of allTools as ToolDef[]) {
    if (!allowed.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: annotationsFor(tool) },
      async (args: unknown) => {
        try {
          return toResult(await tool.run(tool.input.parse(args), ctx));
        } catch (error) {
          return toError(error);
        }
      },
    );
  }
  return server;
}
