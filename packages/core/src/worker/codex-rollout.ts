import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexTokenStatus {
  /** Input tokens of the last model request: the size of the context it was sent. */
  contextTokens: number;
  contextWindow: number | null;
  /** Share of the usage limit already used, with when it resets. */
  rateLimit: { usedPercent: number; windowMinutes: number | null; resetsAt: string | null } | null;
  /** Remaining credit balance, when the plan has credits. */
  credits: string | null;
}

const found = new Map<string, string>();

/**
 * Codex writes each session to ~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread id>.jsonl.
 * Entries are walked newest first, so with no thread id this returns the latest session.
 */
function rolloutPath(threadId?: string): string | null {
  const cached = threadId ? found.get(threadId) : undefined;
  if (cached && existsSync(cached)) return cached;
  const root = join(process.env["CODEX_HOME"] ?? join(homedir(), ".codex"), "sessions");
  if (!existsSync(root)) return null;
  const walk = (dir: string, depth: number): string | null => {
    const entries = readdirSync(dir).sort().reverse();
    for (const entry of entries) {
      const path = join(dir, entry);
      if (depth < 3 && statSync(path).isDirectory()) {
        const hit = walk(path, depth + 1);
        if (hit) return hit;
      } else if (entry.endsWith(threadId ? `${threadId}.jsonl` : ".jsonl")) {
        return path;
      }
    }
    return null;
  };
  const path = walk(root, 0);
  if (path && threadId) found.set(threadId, path);
  return path;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const num = (v: unknown) => (typeof v === "number" ? v : null);

/**
 * The latest token count Codex recorded for a session, or for its most recent session when no
 * thread id is given. The `codex exec --json` stream only reports the turn's total input, which
 * counts the context once per request, so the real context size comes from the session file.
 */
export async function codexTokenStatus(threadId?: string): Promise<CodexTokenStatus | null> {
  const path = rolloutPath(threadId);
  if (!path) return null;
  const lines = (await readFile(path, "utf8")).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('"token_count"')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = isObj(event) && isObj(event["payload"]) ? event["payload"] : event;
    if (!isObj(payload) || payload["type"] !== "token_count" || !isObj(payload["info"])) continue;
    const info = payload["info"];
    const last = isObj(info["last_token_usage"]) ? info["last_token_usage"] : {};
    const limits =
      isObj(payload["rate_limits"]) && isObj(payload["rate_limits"]["primary"])
        ? payload["rate_limits"]["primary"]
        : null;
    const resets = limits ? num(limits["resets_at"]) : null;
    const credits =
      isObj(payload["rate_limits"]) && isObj(payload["rate_limits"]["credits"])
        ? payload["rate_limits"]["credits"]
        : null;
    return {
      credits:
        credits && credits["unlimited"] !== true && typeof credits["balance"] === "string"
          ? credits["balance"]
          : null,
      contextTokens: num(last["input_tokens"]) ?? 0,
      contextWindow: num(info["model_context_window"]),
      rateLimit: limits
        ? {
            usedPercent: num(limits["used_percent"]) ?? 0,
            windowMinutes: num(limits["window_minutes"]),
            resetsAt: resets ? new Date(resets * 1000).toISOString() : null,
          }
        : null,
    };
  }
  return null;
}
