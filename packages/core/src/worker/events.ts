/** Provider-neutral events parsed from the Codex and Claude JSON streams. */
export type WorkerEvent =
  | { type: "session_started"; cliSessionId: string; model?: string }
  | { type: "message"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "plan"; items: { text: string; done: boolean }[] }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
      status: "started" | "completed" | "failed";
      result?: string;
    }
  | {
      type: "command";
      command: string;
      status: "started" | "completed" | "failed";
      output?: string;
    }
  | { type: "web_search"; query: string }
  | {
      type: "usage";
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      contextTokens: number;
      costUsd?: number;
    }
  | { type: "rate_limit"; resetsAt?: string; message?: string }
  | { type: "compacted" }
  | { type: "error"; message: string }
  | { type: "finished"; ok: boolean; summary?: string; costUsd?: number };

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function stringifyResult(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((part) =>
        isObj(part) && typeof part["text"] === "string" ? part["text"] : JSON.stringify(part),
      )
      .join("\n");
  }
  if (isObj(v) && Array.isArray(v["content"])) return stringifyResult(v["content"]);
  return v === undefined ? "" : JSON.stringify(v);
}

function stripServer(name: string) {
  const match = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(name);
  return match?.[1] ?? name;
}

export function parseCodexLine(line: string): WorkerEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(msg)) return [];
  const type = str(msg["type"]);
  switch (type) {
    case "thread.started":
      return [{ type: "session_started", cliSessionId: str(msg["thread_id"]) }];
    case "turn.completed": {
      const usage = isObj(msg["usage"]) ? msg["usage"] : {};
      const input = num(usage["input_tokens"]);
      return [
        {
          type: "usage",
          inputTokens: input,
          cachedInputTokens: num(usage["cached_input_tokens"]),
          outputTokens: num(usage["output_tokens"]) + num(usage["reasoning_output_tokens"]),
          contextTokens: input,
        },
      ];
    }
    case "turn.failed": {
      const error = isObj(msg["error"]) ? str(msg["error"]["message"]) : str(msg["error"]);
      return [{ type: "error", message: error || "Turn failed" }];
    }
    case "error":
      return [{ type: "error", message: str(msg["message"]) || "Unknown error" }];
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = isObj(msg["item"]) ? msg["item"] : {};
      const done = type === "item.completed";
      const id = str(item["id"]);
      switch (str(item["type"])) {
        case "agent_message":
          return done && str(item["text"]) ? [{ type: "message", text: str(item["text"]) }] : [];
        case "reasoning":
          return done ? [{ type: "reasoning", text: str(item["text"]) }] : [];
        case "mcp_tool_call": {
          const failed = str(item["status"]) === "failed" || item["error"] != null;
          return [
            {
              type: "tool_call",
              id,
              name: str(item["tool"]),
              args: item["arguments"],
              status: done ? (failed ? "failed" : "completed") : "started",
              result: done
                ? stringifyResult(item["error"] ? item["error"] : item["result"])
                : undefined,
            },
          ];
        }
        case "command_execution":
          return [
            {
              type: "command",
              command: str(item["command"]),
              status: done ? (num(item["exit_code"]) === 0 ? "completed" : "failed") : "started",
              output: done ? str(item["aggregated_output"]).slice(0, 2000) : undefined,
            },
          ];
        case "web_search":
          return done ? [{ type: "web_search", query: str(item["query"]) }] : [];
        case "todo_list": {
          const items = Array.isArray(item["items"]) ? item["items"] : [];
          return [
            {
              type: "plan",
              items: items
                .filter(isObj)
                .map((i) => ({ text: str(i["text"]), done: i["completed"] === true })),
            },
          ];
        }
        case "error":
          return [{ type: "error", message: str(item["message"]) }];
        default:
          return [];
      }
    }
    default:
      return [];
  }
}

/** Claude reports usage per assistant message; context size is everything sent in. */
function claudeUsage(usage: Json): WorkerEvent {
  const input = num(usage["input_tokens"]);
  const cacheRead = num(usage["cache_read_input_tokens"]);
  const cacheWrite = num(usage["cache_creation_input_tokens"]);
  return {
    type: "usage",
    inputTokens: input + cacheWrite,
    cachedInputTokens: cacheRead,
    outputTokens: num(usage["output_tokens"]),
    contextTokens: input + cacheRead + cacheWrite,
  };
}

export function parseClaudeLine(line: string): WorkerEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(msg)) return [];
  const type = str(msg["type"]);
  if (type === "system") {
    const subtype = str(msg["subtype"]);
    if (subtype === "init") {
      const events: WorkerEvent[] = [
        { type: "session_started", cliSessionId: str(msg["session_id"]), model: str(msg["model"]) },
      ];
      const servers = Array.isArray(msg["mcp_servers"]) ? msg["mcp_servers"] : [];
      for (const s of servers.filter(isObj)) {
        if (str(s["status"]) && str(s["status"]) !== "connected") {
          events.push({
            type: "error",
            message: `MCP server ${str(s["name"])} is ${str(s["status"])}`,
          });
        }
      }
      return events;
    }
    if (subtype === "compact_boundary") return [{ type: "compacted" }];
    if (subtype === "api_retry") return [{ type: "error", message: "API retry" }];
    return [];
  }
  if (type === "rate_limit_event") {
    const info = isObj(msg["rate_limit_info"]) ? msg["rate_limit_info"] : msg;
    const resets = info["resetsAt"] ?? info["resets_at"];
    const status = str(info["status"]);
    if (status === "allowed") return [];
    return [
      {
        type: "rate_limit",
        resetsAt:
          typeof resets === "number"
            ? new Date(resets * 1000).toISOString()
            : str(resets) || undefined,
        message: status || undefined,
      },
    ];
  }
  if (type === "assistant" || type === "user") {
    const message = isObj(msg["message"]) ? msg["message"] : {};
    const content = Array.isArray(message["content"]) ? message["content"].filter(isObj) : [];
    const events: WorkerEvent[] = [];
    for (const part of content) {
      const partType = str(part["type"]);
      if (partType === "text" && type === "assistant")
        events.push({ type: "message", text: str(part["text"]) });
      else if (partType === "thinking")
        events.push({ type: "reasoning", text: str(part["thinking"]) });
      else if (partType === "tool_use") {
        const name = str(part["name"]);
        if (name === "TodoWrite" && isObj(part["input"]) && Array.isArray(part["input"]["todos"])) {
          events.push({
            type: "plan",
            items: part["input"]["todos"]
              .filter(isObj)
              .map((t) => ({ text: str(t["content"]), done: str(t["status"]) === "completed" })),
          });
        } else if (name === "WebSearch" && isObj(part["input"])) {
          events.push({ type: "web_search", query: str(part["input"]["query"]) });
        } else {
          events.push({
            type: "tool_call",
            id: str(part["id"]),
            name: stripServer(name),
            args: part["input"],
            status: "started",
          });
        }
      } else if (partType === "tool_result") {
        events.push({
          type: "tool_call",
          id: str(part["tool_use_id"]),
          name: "",
          args: undefined,
          status: part["is_error"] === true ? "failed" : "completed",
          result: stringifyResult(part["content"]).slice(0, 4000),
        });
      }
    }
    if (type === "assistant" && isObj(message["usage"])) events.push(claudeUsage(message["usage"]));
    return events;
  }
  if (type === "result") {
    const ok = msg["is_error"] !== true && str(msg["subtype"]) === "success";
    return [
      {
        type: "finished",
        ok,
        summary: str(msg["result"]) || str(msg["subtype"]),
        costUsd: typeof msg["total_cost_usd"] === "number" ? msg["total_cost_usd"] : undefined,
      },
    ];
  }
  return [];
}
