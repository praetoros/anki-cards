import type { ProviderId } from "../domain/enums.ts";

export interface InvocationOptions {
  provider: ProviderId;
  mcpUrl: string;
  tools: string[];
  webSearch: boolean;
  model: string | null;
  effort: string | null;
  /** CLI session to resume, or (Claude only) the id to give a new session. */
  cliSessionId: string | null;
  resume: boolean;
  runDir: string;
  maxTurns: number;
}

const tomlString = (s: string) => JSON.stringify(s);
const tomlArray = (items: string[]) => `[${items.map(tomlString).join(",")}]`;

/** Arguments for `codex exec` (see docs/design.md §8.4). The prompt is passed on stdin. */
export function codexArgs(o: InvocationOptions): string[] {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "-s",
    "read-only",
  ];
  if (o.model) args.push("-m", o.model);
  if (o.effort) args.push("-c", `model_reasoning_effort=${tomlString(o.effort)}`);
  args.push(
    "-c",
    `web_search=${tomlString(o.webSearch ? "live" : "disabled")}`,
    "-c",
    `mcp_servers.anki.url=${tomlString(o.mcpUrl)}`,
    "-c",
    `mcp_servers.anki.bearer_token_env_var="ANKI_MCP_TOKEN"`,
    "-c",
    "mcp_servers.anki.required=true",
    "-c",
    `mcp_servers.anki.default_tools_approval_mode="approve"`,
    "-c",
    `mcp_servers.anki.enabled_tools=${tomlArray(o.tools)}`,
    "-c",
    "mcp_servers.anki.tool_timeout_sec=300",
  );
  if (o.resume && o.cliSessionId) args.push("resume", o.cliSessionId);
  args.push("-");
  return args;
}

export function claudeMcpConfig(mcpUrl: string) {
  return {
    mcpServers: {
      anki: {
        type: "http",
        url: mcpUrl,
        headers: { Authorization: "Bearer ${ANKI_MCP_TOKEN}" },
        alwaysLoad: true,
      },
    },
  };
}

/** Arguments for `claude -p` (see docs/design.md §8.4). The prompt is passed on stdin. */
export function claudeArgs(
  o: InvocationOptions,
  files: { mcpConfig: string; stagePrompt: string },
): string[] {
  const builtIn = ["Read", "Grep", "Glob", ...(o.webSearch ? ["WebSearch", "WebFetch"] : [])];
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.cliSessionId) args.push(o.resume ? "--resume" : "--session-id", o.cliSessionId);
  args.push(
    "--strict-mcp-config",
    "--mcp-config",
    files.mcpConfig,
    "--setting-sources",
    "project",
    "--tools",
    builtIn.join(","),
    "--allowedTools",
    ["mcp__anki__*", ...builtIn].join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--append-system-prompt-file",
    files.stagePrompt,
    "--max-turns",
    String(o.maxTurns),
  );
  return args;
}
