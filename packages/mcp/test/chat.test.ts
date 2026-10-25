import {
  chatHistory,
  conceptDetail,
  revertJob,
  sendChatMessage,
  upsertConcept,
  upsertSubtopic,
  upsertTopic,
} from "@anki-cards/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { startHarness, waitForJob, type Harness } from "./harness.ts";

describe("library chat", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    const w = { ctx: { actor: "user" as const, action: "seed", libraryId: h.libraryId } };
    const t = await upsertTopic(h.runtime.db, w, { title: "Heart" });
    const s = await upsertSubtopic(h.runtime.db, w, { topicId: t.id, title: "Cycle" });
    await upsertConcept(
      h.runtime.db,
      { ...w, ctx: { ...w.ctx, actor: "ai" } },
      {
        subtopicId: s.id,
        title: "Systole",
        explanation: "A long explanation.",
      },
    );
  });
  afterAll(async () => {
    await h.close();
  });

  it("runs a chat instruction as a job whose changes can be reverted", async () => {
    const db = h.runtime.db;
    h.scenario([
      {
        tool: "upsert_concept",
        args: {
          id: "CON-001",
          expectedVersion: 1,
          subtopicId: "SUB-001",
          title: "Systole",
          explanation: "Short.",
        },
      },
      { tool: "complete_job", args: { summary: "Shortened CON-001." } },
    ]);
    const queued = await sendChatMessage(db, h.libraryId, "Shorten CON-001", "CON-001");
    void h.runner.tick();
    const job = await waitForJob(db, queued.id);
    expect(job.status).toBe("done");
    expect((await conceptDetail(db, h.libraryId, "CON-001")).concept.explanation).toBe("Short.");
    expect((await chatHistory(db, h.libraryId)).map((j) => j.id)).toEqual([job.id]);

    await revertJob(db, job.id, { actor: "user", action: "revert_job", libraryId: h.libraryId });
    expect((await conceptDetail(db, h.libraryId, "CON-001")).concept.explanation).toBe(
      "A long explanation.",
    );
  });
});
