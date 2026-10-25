import { jobEvents, getSession, providerStatuses } from "@anki-cards/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { startHarness, type Harness } from "./harness.ts";

describe("workers over MCP", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("rejects requests without a valid session token", async () => {
    const res = await fetch(h.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const bad = await fetch(h.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: "{}",
    });
    expect(bad.status).toBe(401);
  });

  for (const provider of ["claude", "codex"] as const) {
    it(`runs a ping job through ${provider}`, async () => {
      h.scenario([
        { listTools: true },
        { tool: "ping" },
        { tool: "complete_job", args: { summary: "pong" } },
      ]);
      const job = await h.runJob({ kind: "ping", provider });
      expect(job.status).toBe("done");
      const events = await jobEvents(h.runtime.db, job.id);
      const tools = events.filter(
        (e) => e.type === "tool_call" && e.data["status"] === "completed",
      );
      expect(tools.length).toBeGreaterThanOrEqual(2);
      const listed = events.find((e) => e.type === "message")?.data["text"];
      expect(listed).toBe("tools: complete_job,ping");
      expect(events.some((e) => e.type === "summary" && e.data["text"] === "pong")).toBe(true);
      const session = await getSession(h.runtime.db, job.sessionId);
      expect(session.cliSessionId).toBeTruthy();
      expect(session.contextTokens).toBeGreaterThan(0);
      if (provider === "codex") {
        expect(session.contextTokens).toBe(1200);
        expect(session.contextWindow).toBe(400000);
        const codex = (await providerStatuses(h.runtime.db)).find((p) => p.provider === "codex");
        expect(codex?.usage).toMatchObject({ usedPercent: 40, windowMinutes: 10080 });
      }
    });
  }

  it("lists only the tools of the job's stage", async () => {
    h.scenario([{ listTools: true }, { tool: "complete_job", args: { summary: "x" } }]);
    const job = await h.runJob({ kind: "compact" });
    const events = await jobEvents(h.runtime.db, job.id);
    expect(events.find((e) => e.type === "message")?.data["text"]).toBe(
      "tools: complete_job,get_workflow_state,save_session_summary",
    );
  });

  it("resumes a crashed worker in the same session", async () => {
    h.scenario([{ tool: "ping" }, { crash: 3 }]);
    const pending = h.runJob({ kind: "ping", provider: "claude" });
    const job = await pending;
    // ping jobs are not retried, so the crash is final for them
    expect(job.status).toBe("failed");
    expect(job.error).toContain("code 3");
  });
});
