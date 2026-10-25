import { join } from "node:path";

import {
  compactSession,
  createSession,
  enqueueJob,
  getSession,
  jobEvents,
  listSessions,
  sessionSummaryFor,
  upsertSubtopic,
  upsertTopic,
  type SessionScope,
} from "@anki-cards/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { startHarness, waitForJob, type Harness } from "./harness.ts";

describe("sessions and scopes", () => {
  let h: Harness;
  let topics: string[];
  beforeAll(async () => {
    h = await startHarness();
    const w = { ctx: { actor: "user" as const, action: "seed", libraryId: h.libraryId } };
    const a = await upsertTopic(h.runtime.db, w, { title: "Heart" });
    const b = await upsertTopic(h.runtime.db, w, { title: "Lungs" });
    await upsertSubtopic(h.runtime.db, w, { topicId: a.id, title: "Cycle" });
    topics = [a.id, b.id];
  });
  afterAll(async () => {
    await h.close();
  });

  async function topicJob(scope: SessionScope) {
    const db = h.runtime.db;
    const session = await createSession(db, {
      libraryId: h.libraryId,
      kind: "topic",
      title: "t",
      scope,
      provider: "claude",
    });
    return enqueueJob(db, {
      sessionId: session.id,
      kind: "feedback",
      trigger: "test",
      prompt: "x",
    });
  }

  it("runs topic sessions side by side and keeps writes inside each scope", async () => {
    h.scenario([
      { tool: "upsert_concept", args: { subtopicId: "SUB-001", title: "Systole" } },
      { tool: "complete_job", args: { summary: "ok" } },
    ]);
    const inScope = await topicJob({ kind: "topics", topicIds: [topics[0]!] });
    const outOfScope = await topicJob({ kind: "topics", topicIds: [topics[1]!] });
    void h.runner.tick();
    const [a, b] = await Promise.all([
      waitForJob(h.runtime.db, inScope.id),
      waitForJob(h.runtime.db, outOfScope.id),
    ]);
    expect(a.status).toBe("done");
    expect(b.status).toBe("done");
    const failed = (await jobEvents(h.runtime.db, b.id)).filter(
      (e) => e.type === "tool_call" && e.data["status"] === "failed",
    );
    expect(String(failed[0]?.data["result"])).toContain("out_of_scope");
  });

  it("resumes a crashed job in the same CLI session", async () => {
    h.scenario([
      { tool: "get_workflow_state" },
      { crashOnce: join(h.dir, "crash-marker") },
      { tool: "complete_job", args: { summary: "recovered" } },
    ]);
    const job = await h.runJob({ kind: "synthesis" });
    expect(job.status).toBe("done");
    expect(job.attempt).toBe(2);
    const starts = (await jobEvents(h.runtime.db, job.id)).filter((e) => e.type === "started");
    expect(starts.map((e) => e.data["resume"])).toEqual([false, true]);
  });

  it("waits until the reported reset after a rate limit", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    h.scenario([{ rateLimit: reset }]);
    const session = await createSession(h.runtime.db, {
      libraryId: h.libraryId,
      kind: "chat",
      title: "rl",
      scope: { kind: "topics", topicIds: [] },
      provider: "claude",
    });
    const queued = await enqueueJob(h.runtime.db, {
      sessionId: session.id,
      kind: "chat",
      trigger: "test",
      prompt: "x",
    });
    void h.runner.tick();
    const job = await waitForJob(h.runtime.db, queued.id, ["waiting"]);
    expect(job.resumeAfter).toBe(new Date(reset * 1000).toISOString());
    expect(job.attempt).toBe(0);
    await h.runner.cancel(job.id);
  });

  it("compacts a session into a new one that starts from the summary", async () => {
    h.scenario([
      {
        tool: "save_session_summary",
        args: { body: "Decided to merge CON-001 and CON-002. Open: R-004." },
      },
      { tool: "complete_job", args: { summary: "summarised" } },
    ]);
    const first = await h.runJob({ kind: "ping" });
    const session = await getSession(h.runtime.db, first.sessionId);
    const job = await compactSession(h.runtime.db, session.id);
    void h.runner.tick();
    expect((await waitForJob(h.runtime.db, job.id)).status).toBe("done");
    expect((await getSession(h.runtime.db, session.id)).status).toBe("archived");
    const next = (await listSessions(h.runtime.db, h.libraryId)).find(
      (s) => s.parentSessionId === session.id,
    );
    expect(next).toBeTruthy();
    const summary = await sessionSummaryFor(h.runtime.db, next!);
    expect(summary?.body).toContain("CON-001");
  });
});
