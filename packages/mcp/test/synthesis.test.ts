import {
  actOnReviewItem,
  approveGate,
  conceptDetail,
  jobEvents,
  listReviewItems,
  reviewItemDetail,
  registerSource,
  sendFeedback,
} from "@anki-cards/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { generateLecturePdf } from "../../../tests/fixtures/lecture-pdf.ts";
import { startHarness, waitForJob, type Harness } from "./harness.ts";

const ki = (statement: string, extra: Record<string, unknown> = {}) => ({
  tool: "upsert_knowledge_item",
  args: {
    conceptId: "CON-001",
    statement,
    types: ["definition"],
    priority: "P1",
    origin: "source",
    interpretationStatus: "supported",
    sourceEvidence: [{ sourceUnitId: "SU-001" }],
    ...extra,
  },
});

describe("synthesis and the review loop", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    const { db, paths } = h.runtime;
    const source = await registerSource(
      db,
      paths,
      { libraryId: h.libraryId, fileName: "lecture.pdf", bytes: generateLecturePdf(), wait: true },
      { actor: "user", action: "upload", libraryId: h.libraryId },
    );
    expect(source.extractionStatus).toBe("extracted");
  });
  afterAll(async () => {
    await h.close();
  });

  it("synthesises through the tools and enforces approvals", async () => {
    h.scenario([
      { tool: "get_workflow_state" },
      { tool: "upsert_topic", args: { title: "Cardiac physiology" } },
      { tool: "upsert_subtopic", args: { topicId: "TOP-001", title: "Cardiac cycle" } },
      {
        tool: "upsert_concept",
        args: { subtopicId: "SUB-001", title: "Systole and diastole", explanation: "Two phases." },
      },
      ki("Systole is the phase in which the ventricles contract and eject blood."),
      ki("An external fact", { origin: "external" }),
      {
        tool: "record_coverage",
        args: { sourceUnitId: "SU-001", outcome: "incorporated", conceptIds: ["CON-001"] },
      },
      {
        tool: "raise_review_item",
        args: {
          kind: "enrichment_request",
          title: "Add normal cycle duration ranges",
          description: "The lecture gives one heart rate only.",
          suggestion: "Add the cycle duration at 150 bpm to CON-001 from a physiology text.",
          payload: { conceptIds: ["CON-001"], purpose: "Duration at other heart rates" },
          targets: [{ table: "concepts", id: "CON-001" }],
        },
      },
      { tool: "complete_job", args: { summary: "Synthesised SRC-001" } },
    ]);
    const job = await h.runJob({ kind: "synthesis" });
    expect(job.status).toBe("done");
    const events = await jobEvents(h.runtime.db, job.id);
    const failed = events.filter((e) => e.type === "tool_call" && e.data["status"] === "failed");
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.data["result"])).toContain("not_approved");

    const detail = await conceptDetail(h.runtime.db, h.libraryId, "CON-001");
    expect(detail.knowledgeItems).toHaveLength(1);
    expect(detail.evidence[0]?.sourceUnitId).toBeTruthy();

    const items = await listReviewItems(h.runtime.db, h.libraryId);
    expect(items[0]?.category).toBe("requires_decision");
    expect(items[0]?.suggestion).toContain("150 bpm");
    await expect(approveGate(h.runtime.db, h.libraryId, "synthesis")).rejects.toThrow(
      "Resolve these first",
    );
  });

  it("processes feedback and approved enrichment in a feedback job", async () => {
    const db = h.runtime.db;
    const accepted = await actOnReviewItem(db, h.libraryId, "R-001", { action: "accept" });
    expect(accepted.status).toBe("awaiting_ai");
    const thread = await reviewItemDetail(db, h.libraryId, "R-001");
    expect(thread.messages[0]?.body).toContain("Accepted the suggested resolution");
    expect(thread.approvals.map((a) => a.kind)).toEqual(["text_enrichment"]);
    h.scenario([
      { tool: "get_review_item", args: { reviewItemId: "R-001" } },
      ki("At 150 beats per minute the cycle lasts about 0.4 s.", {
        origin: "external",
        sourceEvidence: undefined,
        externalEvidence: [
          {
            url: "https://example.org/physiology",
            title: "Physiology text",
            publisher: "Example Press",
            passage: "At 150 bpm, one cardiac cycle lasts approximately 0.4 s.",
          },
        ],
        reviewItemId: "R-001",
      }),
      {
        tool: "reply_to_review_item",
        args: { reviewItemId: "R-001", body: "Added KI-002 with a citation.", outcome: "done" },
      },
      { tool: "complete_job", args: { summary: "Processed R-001" } },
    ]);
    const [job] = await sendFeedback(db, h.libraryId);
    void h.runner.tick();
    const done = await waitForJob(db, job!.id);
    expect(done.status).toBe("done");
    const detail = await conceptDetail(db, h.libraryId, "CON-001");
    expect(detail.knowledgeItems.map((k) => k.origin)).toEqual(["source", "external"]);
    const [item] = await listReviewItems(db, h.libraryId, { statuses: ["resolved"] });
    expect(item?.displayId).toBe("R-001");

    const [untrusted] = await listReviewItems(db, h.libraryId, { kinds: ["untrusted_source"] });
    expect(untrusted?.status).toBe("open");
    await expect(approveGate(db, h.libraryId, "synthesis")).rejects.toThrow(
      "not on the trusted list",
    );
    await actOnReviewItem(db, h.libraryId, untrusted!.id, { action: "approve" });
    const snapshot = await approveGate(db, h.libraryId, "synthesis");
    expect(snapshot.changesetSeq).toBeGreaterThan(0);
  });
});
