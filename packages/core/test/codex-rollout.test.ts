import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { codexTokenStatus } from "../src/worker/codex-rollout.ts";

const tokenCount = (input: number, usedPercent: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { input_tokens: input * 10 },
        last_token_usage: { input_tokens: input },
        model_context_window: 475000,
      },
      rate_limits: {
        primary: { used_percent: usedPercent, window_minutes: 10080, resets_at: 1793518262 },
        credits: { has_credits: true, unlimited: false, balance: "40231.70" },
      },
    },
  });

describe("codexTokenStatus", () => {
  let home: string;
  let previous: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "codex-home-"));
    previous = process.env["CODEX_HOME"];
    process.env["CODEX_HOME"] = home;
    const day = join(home, "sessions", "2026", "10", "25");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-10-25T10-00-00-thread-a.jsonl"),
      [tokenCount(1000, 10), tokenCount(92041, 95), '{"type":"event_msg"}'].join("\n"),
    );
    writeFileSync(join(day, "rollout-2026-10-25T09-00-00-thread-b.jsonl"), tokenCount(5000, 50));
  });
  afterEach(() => {
    if (previous === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = previous;
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the last request's input as the context size", async () => {
    const status = await codexTokenStatus("thread-a");
    expect(status).toEqual({
      contextTokens: 92041,
      contextWindow: 475000,
      credits: "40231.70",
      rateLimit: {
        usedPercent: 95,
        windowMinutes: 10080,
        resetsAt: new Date(1793518262 * 1000).toISOString(),
      },
    });
  });

  it("finds a session by thread id", async () => {
    expect((await codexTokenStatus("thread-b"))?.contextTokens).toBe(5000);
  });

  it("uses the newest session when no thread id is given", async () => {
    expect((await codexTokenStatus())?.rateLimit?.usedPercent).toBe(95);
  });

  it("returns null for an unknown thread", async () => {
    expect(await codexTokenStatus("missing")).toBeNull();
  });
});
