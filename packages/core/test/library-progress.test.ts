import { describe, expect, it } from "vite-plus/test";

import {
  nextStep,
  stepStates,
  type LibraryProgress,
  type TopicProgress,
} from "../src/library-progress.ts";

const topic = (patch: Partial<TopicProgress> = {}): TopicProgress => ({
  id: "top_1",
  displayId: "TOP-001",
  title: "Gout",
  plan: "approved",
  planRows: 10,
  cards: 10,
  drafts: 0,
  setApprovedAt: "2026-10-25T10:00:00.000Z",
  activeJob: null,
  ...patch,
});

/** A library that has finished every step. */
const finished = (): LibraryProgress => ({
  sources: { total: 1, extracting: 0, failed: 0, extracted: 1, pending: [] },
  knowledge: { topics: 1, concepts: 5, knowledgeItems: 20 },
  review: { open: 0, decisions: 0, awaitingAi: 0, withAi: 0 },
  activeJobs: [],
  synthesis: { approvedAt: "2026-10-25T09:00:00.000Z", blockers: [] },
  topics: [topic()],
  lastExport: { at: "2026-10-25T11:00:00.000Z", total: 10 },
});

const unsynthesised = (): LibraryProgress => ({
  ...finished(),
  sources: {
    ...finished().sources,
    pending: [{ displayId: "SRC-001", covered: 0, units: 56 }],
  },
  synthesis: { approvedAt: null, blockers: [] },
  topics: [],
  lastExport: null,
});

describe("nextStep", () => {
  it("starts with adding sources", () => {
    const p = unsynthesised();
    p.sources = { total: 0, extracting: 0, failed: 0, extracted: 0, pending: [] };
    expect(nextStep(p)).toMatchObject({ step: "sources", action: { to: "sources" } });
  });

  it("offers synthesis for uncovered sources", () => {
    expect(nextStep(unsynthesised())).toMatchObject({
      step: "synthesis",
      action: { kind: "intent", intent: "synthesise", label: "Synthesise 1 source" },
    });
  });

  it("asks the user to wait, without an action, while synthesis runs", () => {
    const p = unsynthesised();
    p.activeJobs = ["synthesis"];
    expect(nextStep(p)).toMatchObject({ step: "synthesis", action: null });
  });

  it("sends the user to review before approving", () => {
    const p = { ...unsynthesised(), sources: finished().sources };
    p.review = { open: 6, decisions: 2, awaitingAi: 0, withAi: 0 };
    const step = nextStep(p);
    expect(step).toMatchObject({ step: "review", action: { to: "review" } });
    expect(step.detail).toContain("2 items need a decision");
  });

  it("sends waiting feedback to the AI before more review", () => {
    const p = { ...unsynthesised(), sources: finished().sources };
    p.review = { open: 2, decisions: 0, awaitingAi: 3, withAi: 0 };
    expect(nextStep(p).action).toMatchObject({ intent: "send-feedback" });
  });

  it("waits while the AI works on feedback, without offering to send it again", () => {
    const p = { ...unsynthesised(), sources: finished().sources };
    p.review = { open: 0, decisions: 0, awaitingAi: 0, withAi: 4 };
    p.activeJobs = ["feedback"];
    expect(nextStep(p)).toMatchObject({ step: "review", action: null });
    expect(stepStates(p).review).toBe("current");
  });

  it("walks a topic through plan, generation, review and approval", () => {
    const p = finished();
    const labels = [
      topic({ plan: null, cards: 0, setApprovedAt: null }),
      topic({ plan: "draft", cards: 0, setApprovedAt: null }),
      topic({ cards: 0, setApprovedAt: null }),
      topic({ drafts: 4, setApprovedAt: null }),
      topic({ setApprovedAt: null }),
    ].map((t) => {
      p.topics = [t];
      return nextStep(p).action?.label;
    });
    expect(labels).toEqual([
      "Plan cards",
      "Review plan",
      "Generate cards",
      "Review cards",
      "Approve card set",
    ]);
  });

  it("plans every unplanned topic at once when there are several", () => {
    const p = finished();
    p.topics = [
      topic({ plan: null, cards: 0, setApprovedAt: null }),
      topic({ id: "top_2", plan: null, cards: 0, setApprovedAt: null }),
    ];
    expect(nextStep(p).action).toMatchObject({ intent: "plan-all", label: "Plan 2 topics" });
  });

  it("asks for an export when a card set is newer than the last export", () => {
    const p = finished();
    p.topics = [topic({ setApprovedAt: "2026-10-25T12:00:00.000Z" })];
    expect(nextStep(p)).toMatchObject({ step: "export", action: { to: "export" } });
    expect(nextStep(p).done).toBeUndefined();
  });

  it("reports when everything is done", () => {
    expect(nextStep(finished()).done).toBe(true);
  });
});

describe("stepStates", () => {
  it("marks earlier steps done and later ones to do", () => {
    const p = { ...unsynthesised(), sources: finished().sources };
    p.review = { open: 1, decisions: 0, awaitingAi: 0, withAi: 0 };
    expect(stepStates(p)).toEqual({
      sources: "done",
      synthesis: "done",
      review: "current",
      approve: "todo",
      cards: "todo",
      export: "todo",
    });
  });

  it("keeps the approval done when a later review item reopens review", () => {
    const p = finished();
    p.review = { open: 1, decisions: 0, awaitingAi: 0, withAi: 0 };
    expect(stepStates(p)).toMatchObject({ review: "current", approve: "done", export: "done" });
  });

  it("marks every step done at the end", () => {
    expect(Object.values(stepStates(finished()))).toEqual(Array(6).fill("done"));
  });
});
