import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  approveGate,
  cardPlanView,
  exportLibrary,
  listCards,
  registerSource,
  resolveRow,
  setCardStatus,
  startGeneration,
  startPlanning,
  startSynthesis,
  updatePlanRow,
} from "@anki-cards/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { generateLecturePdf } from "../../../tests/fixtures/lecture-pdf.ts";
import { startHarness, waitForJob, type Harness } from "./harness.ts";

const user = (libraryId: string) => ({
  ctx: { actor: "user" as const, action: "test", libraryId },
});

describe("pipeline: fixture → synthesis → plan → cards → .apkg", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it("produces an Anki package from a lecture", async () => {
    const { db, paths } = h.runtime;
    const lib = h.libraryId;
    await registerSource(
      db,
      paths,
      { libraryId: lib, fileName: "lecture.pdf", bytes: generateLecturePdf(), wait: true },
      { actor: "user", action: "upload", libraryId: lib },
    );

    h.scenario([
      { tool: "upsert_topic", args: { title: "Cardiac physiology" } },
      { tool: "upsert_subtopic", args: { topicId: "TOP-001", title: "Cardiac cycle" } },
      {
        tool: "upsert_concept",
        args: { subtopicId: "SUB-001", title: "Phases", explanation: "Systole and diastole." },
      },
      {
        tool: "upsert_knowledge_item",
        args: {
          conceptId: "CON-001",
          statement: "Systole is when the ventricles contract and eject blood.",
          types: ["definition"],
          priority: "P1",
          origin: "source",
          interpretationStatus: "supported",
          sourceEvidence: [{ sourceUnitId: "SU-001" }],
        },
      },
      {
        tool: "record_coverage",
        args: { sourceUnitId: "SU-001", outcome: "incorporated", conceptIds: ["CON-001"] },
      },
      { tool: "complete_job", args: { summary: "done" } },
    ]);
    const synthesis = await startSynthesis(db, lib);
    void h.runner.tick();
    expect((await waitForJob(db, synthesis.id)).status).toBe("done");
    await approveGate(db, lib, "synthesis");

    h.scenario([
      {
        tool: "propose_card_plan",
        args: {
          topicId: "TOP-001",
          summary: "One definition card",
          rows: [{ knowledgeItemIds: ["KI-001"], cardType: "basic", rationale: "Core definition" }],
        },
      },
      { tool: "complete_job", args: { summary: "planned" } },
    ]);
    const topic = await resolveRow(db, "topics", lib, "TOP-001");
    const planning = await startPlanning(db, lib, topic.id);
    void h.runner.tick();
    expect((await waitForJob(db, planning.id)).status).toBe("done");
    const plan = await cardPlanView(db, topic.id);
    await updatePlanRow(db, user(lib), { rowId: plan!.rows[0]!.id, status: "accepted" });
    await approveGate(db, lib, "card_plan", topic.id);

    h.scenario([
      {
        tool: "upsert_card",
        args: {
          topicId: "TOP-001",
          planRowId: plan!.rows[0]!.id,
          cardType: "basic",
          fields: {
            Front: "In the cardiac cycle, what is systole?",
            Back: "Ventricular contraction and ejection of blood.",
          },
          knowledgeItemIds: ["KI-001"],
        },
      },
      { tool: "complete_job", args: { summary: "generated" } },
    ]);
    const generation = await startGeneration(db, lib, topic.id);
    void h.runner.tick();
    expect((await waitForJob(db, generation.id)).status).toBe("done");
    const cards = await listCards(db, topic.id);
    expect(cards).toHaveLength(1);
    await expect(approveGate(db, lib, "card_set", topic.id)).rejects.toThrow("not approved");
    await setCardStatus(
      db,
      user(lib),
      cards.map((c) => c.id),
      "approved",
    );
    await approveGate(db, lib, "card_set", topic.id);

    const exported = await exportLibrary(db, paths, lib);
    expect(exported.counts).toMatchObject({ added: 1, total: 1 });
    const files = unzipSync(new Uint8Array(readFileSync(exported.filePath)));
    const col = new DatabaseSync(":memory:");
    col.deserialize(files["collection.anki2"]!);
    const notes = col.prepare("SELECT guid, flds, tags FROM notes").all() as {
      guid: string;
      flds: string;
      tags: string;
    }[];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.guid).toBe(cards[0]?.guid);
    expect(notes[0]?.flds).toContain("what is systole");
    expect(notes[0]?.flds).toContain("lecture");
    expect(notes[0]?.tags).toContain("Cardiac_physiology::Cardiac_cycle");

    const again = await exportLibrary(db, paths, lib);
    expect(again.counts).toMatchObject({ added: 0, unchanged: 1 });
  });
});
