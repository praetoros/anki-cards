// Stand-in for `codex` and `claude` in tests. Speaks each CLI's JSON stream format and performs the
// tool calls listed in the scenario file named by FAKE_CLI_SCENARIO against the app's MCP endpoint.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const args = process.argv.slice(2);
const isCodex = args[0] === "exec" || args[0] === "login";

if (args.includes("--version")) {
  console.log(isCodex ? "codex-cli 0.150.0" : "2.1.300 (Claude Code)");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  console.error("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}

const scenario = process.env.FAKE_CLI_SCENARIO
  ? JSON.parse(readFileSync(process.env.FAKE_CLI_SCENARIO, "utf8"))
  : {
      steps: [
        { tool: "ping", args: {} },
        { tool: "complete_job", args: { summary: "pong" } },
      ],
    };

function argAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function mcpUrl() {
  if (isCodex) {
    const entry = args.find((a) => a.startsWith("mcp_servers.anki.url="));
    return JSON.parse(entry.slice("mcp_servers.anki.url=".length));
  }
  const config = JSON.parse(readFileSync(argAfter("--mcp-config"), "utf8"));
  return config.mcpServers.anki.url;
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const sessionId = isCodex
  ? args[args.indexOf("resume") + 1] !== undefined && args.includes("resume")
    ? args[args.indexOf("resume") + 1]
    : "thread-fake-1"
  : (argAfter("--session-id") ?? argAfter("--resume"));

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

if (isCodex) emit({ type: "thread.started", thread_id: sessionId });
else
  emit({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "fake",
    mcp_servers: [{ name: "anki", status: "connected" }],
  });

const client = new Client({ name: "fake-cli", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(mcpUrl()), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.ANKI_MCP_TOKEN}` } },
  }),
);

let n = 0;
for (const step of scenario.steps) {
  n++;
  const id = `call-${n}`;
  if (step.listTools) {
    const { tools } = await client.listTools();
    const text = `tools: ${tools
      .map((t) => t.name)
      .sort()
      .join(",")}`;
    if (isCodex) emit({ type: "item.completed", item: { id, type: "agent_message", text } });
    else emit({ type: "assistant", message: { content: [{ type: "text", text }] } });
    continue;
  }
  if (step.crash) process.exit(step.crash);
  if (step.crashOnce) {
    if (!existsSync(step.crashOnce)) {
      writeFileSync(step.crashOnce, "crashed");
      process.exit(5);
    }
    continue;
  }
  if (step.rateLimit) {
    emit({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: step.rateLimit },
    });
    process.exit(1);
  }
  const result = await client.callTool({ name: step.tool, arguments: step.args ?? {} });
  const text = (result.content ?? []).map((c) => c.text ?? "").join("\n");
  if (isCodex) {
    emit({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "anki",
        tool: step.tool,
        arguments: step.args,
        status: result.isError ? "failed" : "completed",
        result: result.isError ? undefined : { content: result.content },
        error: result.isError ? { message: text } : null,
      },
    });
  } else {
    emit({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id, name: `mcp__anki__${step.tool}`, input: step.args }],
        usage: { input_tokens: 1000 + n, cache_read_input_tokens: 500, output_tokens: 50 },
      },
    });
    emit({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: result.content,
            is_error: result.isError === true,
          },
        ],
      },
    });
  }
}
await client.close();

if (isCodex) {
  // Real Codex records the context size and usage limit in its session file, not on stdout.
  if (process.env.CODEX_HOME) {
    const day = join(process.env.CODEX_HOME, "sessions", "2026", "10", "25");
    mkdirSync(day, { recursive: true });
    const tokenCount = {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 1200 }, model_context_window: 400000 },
        rate_limits: {
          primary: { used_percent: 40, window_minutes: 10080, resets_at: 1793518262 },
        },
      },
    };
    appendFileSync(
      join(day, `rollout-2026-10-25T10-00-00-${sessionId}.jsonl`),
      JSON.stringify(tokenCount) + "\n",
    );
  }
  emit({
    type: "turn.completed",
    usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 100 },
  });
} else {
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    total_cost_usd: 0.01,
    session_id: sessionId,
  });
}
process.stdout.end(() => process.exit(scenario.exitCode ?? 0));
void prompt;
