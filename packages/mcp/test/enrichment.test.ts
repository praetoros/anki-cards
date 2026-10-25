import { createServer, type Server } from "node:http";

import {
  actOnReviewItem,
  change,
  conceptDetail,
  ensureDefaultTrustedSources,
  jobEvents,
  listReviewItems,
  raiseReviewItem,
  setSetting,
  upsertConcept,
  upsertSubtopic,
  upsertTopic,
} from "@anki-cards/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { startHarness, type Harness } from "./harness.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const external = (url: string) => ({
  tool: "upsert_knowledge_item",
  args: {
    conceptId: "CON-001",
    statement: `Fact from ${url}`,
    types: ["numerical"],
    priority: "P2",
    origin: "external",
    interpretationStatus: "supported",
    externalEvidence: [{ url, title: "Page", publisher: "Pub", passage: "The exact passage." }],
  },
});

describe("enrichment", () => {
  let h: Harness;
  let images: Server;
  let imageUrl = "";
  beforeAll(async () => {
    h = await startHarness();
    const db = h.runtime.db;
    await ensureDefaultTrustedSources(db);
    const w = { ctx: { actor: "user" as const, action: "seed", libraryId: h.libraryId } };
    const t = await upsertTopic(db, w, { title: "Heart" });
    const s = await upsertSubtopic(db, w, { topicId: t.id, title: "Cycle" });
    const c = await upsertConcept(db, w, { subtopicId: s.id, title: "Duration" });
    await change(db, { actor: "ai", action: "seed", libraryId: h.libraryId }, (x) =>
      raiseReviewItem(x, {
        libraryId: h.libraryId,
        kind: "enrichment_request",
        title: "Durations",
        payload: { conceptIds: [c.id], purpose: "x", includeVisualSearch: true },
        raisedBy: "ai",
      }),
    );
    await actOnReviewItem(db, h.libraryId, "R-001", { action: "approve" });
    images = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(PNG);
    });
    await new Promise<void>((r) => images.listen(0, "127.0.0.1", r));
    const addr = images.address();
    imageUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/heart.png`;
  });
  afterAll(async () => {
    images.close();
    await h.close();
  });

  it("labels trusted sources and flags others for review", async () => {
    h.scenario([
      external("https://www.ncbi.nlm.nih.gov/books/NBK1"),
      external("https://random-blog.example.com/heart"),
      { tool: "complete_job", args: { summary: "done" } },
    ]);
    const job = await h.runJob({ kind: "enrichment" });
    expect(job.status).toBe("done");
    const detail = await conceptDetail(h.runtime.db, h.libraryId, "CON-001");
    expect(detail.evidence.map((e) => e.external?.trusted)).toEqual([true, false]);
    const flagged = await listReviewItems(h.runtime.db, h.libraryId, {
      kinds: ["untrusted_source"],
    });
    expect(flagged).toHaveLength(1);

    await actOnReviewItem(h.runtime.db, h.libraryId, flagged[0]!.id, { action: "reject" });
    const after = await conceptDetail(h.runtime.db, h.libraryId, "CON-001");
    expect(after.knowledgeItems.find((k) => k.statement.includes("random-blog"))?.excluded).toBe(
      true,
    );
  });

  it("proposes an external image and embeds it once approved", async () => {
    await setSetting(h.runtime.db, "enrichment.mode", "text+images", h.libraryId);
    h.scenario([
      {
        tool: "propose_external_media",
        args: {
          imageUrl,
          pageUrl: "https://radiopaedia.org/articles/heart",
          creator: "Dr X",
          licence: "CC BY-NC-SA 3.0",
          attribution: "Case courtesy of Dr X",
          purpose: "Labelled chambers",
          conceptIds: ["CON-001"],
        },
      },
      { tool: "complete_job", args: { summary: "proposed" } },
    ]);
    const job = await h.runJob({ kind: "enrichment" });
    const failures = (await jobEvents(h.runtime.db, job.id)).filter(
      (e) => e.type === "tool_call" && e.data["status"] === "failed",
    );
    expect(failures).toHaveLength(0);
    const [proposal] = await listReviewItems(h.runtime.db, h.libraryId, {
      kinds: ["visual_proposal"],
    });
    expect(proposal?.payload["licence"]).toBe("CC BY-NC-SA 3.0");
    await actOnReviewItem(h.runtime.db, h.libraryId, proposal!.id, { action: "approve" });
    const detail = await conceptDetail(h.runtime.db, h.libraryId, "CON-001");
    expect(detail.media.map((m) => m.media.origin)).toEqual(["external"]);
  });

  it("rejects external knowledge when enrichment is off", async () => {
    await setSetting(h.runtime.db, "enrichment.mode", "none", h.libraryId);
    h.scenario([
      external("https://www.who.int/x"),
      { tool: "complete_job", args: { summary: "x" } },
    ]);
    const job = await h.runJob({ kind: "feedback" });
    const failed = (await jobEvents(h.runtime.db, job.id)).find(
      (e) => e.type === "tool_call" && e.data["status"] === "failed",
    );
    expect(String(failed?.data["result"])).toContain("turned off");
  });
});
