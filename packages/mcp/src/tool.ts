import {
  DomainError,
  type ChangeContext,
  type Runtime,
  type TJobS,
  type TSessionS,
} from "@anki-cards/core";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

export interface ToolContext {
  runtime: Runtime;
  session: TSessionS;
  job: TJobS;
  libraryId: string;
  /** Changeset context for writes made by this worker. */
  change: (action: string, extra?: Partial<ChangeContext>) => ChangeContext;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  input: S;
  readOnly?: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function annotationsFor(def: ToolDef): ToolAnnotations {
  return def.readOnly
    ? { readOnlyHint: true, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
}

export function toResult(value: unknown): CallToolResult {
  if (value && typeof value === "object" && "content" in value && Array.isArray(value.content)) {
    return value as CallToolResult;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function toError(error: unknown): CallToolResult {
  const message =
    error instanceof DomainError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? `internal_error: ${error.message}`
        : "internal_error";
  return { content: [{ type: "text", text: message }], isError: true };
}
