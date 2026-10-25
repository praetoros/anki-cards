import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { startGeneration, startPlanning } from "./cards.ts";
import {
  tCard,
  tCardPlan,
  tCardPlanRow,
  tJob,
  tReviewItem,
  tSession,
  tTopic,
} from "./db/schema/index.ts";
import type { Gate, JobKind } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change } from "./history.ts";
import { ACTIVE_JOB_STATUSES } from "./jobs.ts";
import { raiseReviewItem } from "./review.ts";
import { getSetting } from "./settings.ts";
import { createSnapshot, latestSnapshot } from "./snapshots.ts";

export const GATE_LABEL: Record<Gate, string> = {
  synthesis: "Synthesis approved",
  card_plan: "Card plan approved",
  card_set: "Card set approved",
};

/** Jobs that are still changing what a gate would approve. */
const GATE_JOB_KINDS: Record<Gate, JobKind[]> = {
  synthesis: ["synthesis", "feedback", "enrichment"],
  card_plan: ["planning", "feedback"],
  card_set: ["generation", "feedback"],
};

/**
 * Kinds of the library's active jobs among `kinds`. With a topic, only jobs of sessions that
 * cover it (the library-wide ingest session covers every topic).
 */
async function activeJobKinds(
  db: TDb,
  libraryId: string,
  kinds: JobKind[],
  topicId: string | null,
) {
  const jobs = await db
    .select({ kind: tJob.kind, scope: tSession.scope })
    .from(tJob)
    .innerJoin(tSession, eq(tSession.id, tJob.sessionId))
    .where(
      and(
        eq(tJob.libraryId, libraryId),
        inArray(tJob.kind, kinds),
        inArray(tJob.status, ACTIVE_JOB_STATUSES),
      ),
    );
  return [
    ...new Set(
      jobs
        .filter((j) => !topicId || j.scope.kind === "library" || j.scope.topicIds.includes(topicId))
        .map((j) => j.kind),
    ),
  ];
}

/**
 * What stops a gate: open decisions and jobs still running for it. Deferred items count as
 * acknowledged and don't block.
 */
export async function gateBlockers(
  db: TDb,
  libraryId: string,
  gate: Gate,
  topicId?: string | null,
) {
  const conditions = [
    eq(tReviewItem.libraryId, libraryId),
    eq(tReviewItem.category, "requires_decision"),
    inArray(tReviewItem.status, ["open", "awaiting_ai"]),
  ];
  if (topicId) conditions.push(or(eq(tReviewItem.topicId, topicId), isNull(tReviewItem.topicId))!);
  const items = await db
    .select()
    .from(tReviewItem)
    .where(and(...conditions));
  const reasons: string[] = items.map((i) => `${i.displayId} ${i.title}`);
  if (gate === "card_plan" && topicId) {
    const plans = await db
      .select()
      .from(tCardPlan)
      .where(and(eq(tCardPlan.topicId, topicId), eq(tCardPlan.status, "draft")));
    if (plans.length === 0) reasons.push("There is no draft card plan for this topic.");
  }
  const busy = await activeJobKinds(db, libraryId, GATE_JOB_KINDS[gate], topicId ?? null);
  if (busy.length > 0) reasons.push(`Wait for the running ${busy.join(" and ")} job to finish.`);
  if (gate === "card_set" && topicId) {
    const drafts = await db
      .select({ id: tCard.id })
      .from(tCard)
      .where(and(eq(tCard.topicId, topicId), eq(tCard.status, "draft")));
    const all = await db.select({ id: tCard.id }).from(tCard).where(eq(tCard.topicId, topicId));
    if (all.length === 0) reasons.push("There are no cards for this topic yet.");
    else if (drafts.length > 0) reasons.push(`${drafts.length} card(s) are not approved yet.`);
  }
  return reasons;
}

export async function approveGate(
  db: TDatabase,
  libraryId: string,
  gate: Gate,
  topicId: string | null = null,
) {
  const blockers = await gateBlockers(db, libraryId, gate, topicId);
  if (blockers.length > 0) {
    throw new DomainError(
      "gate_blocked",
      `Resolve these first: ${blockers.slice(0, 5).join("; ")}`,
    );
  }
  if (gate === "card_plan" && topicId) {
    await change(db, { actor: "user", action: "approve_card_plan", libraryId }, async (c) => {
      const plans = await c.tx
        .select()
        .from(tCardPlan)
        .where(and(eq(tCardPlan.topicId, topicId), eq(tCardPlan.status, "draft")));
      for (const p of plans) {
        await c.update("card_plans", p.id, { status: "approved" });
        // Approving a plan accepts every row the user did not reject.
        const proposed = await c.tx
          .select({ id: tCardPlanRow.id })
          .from(tCardPlanRow)
          .where(and(eq(tCardPlanRow.planId, p.id), eq(tCardPlanRow.status, "proposed")));
        for (const r of proposed) await c.update("card_plan_rows", r.id, { status: "accepted" });
      }
    });
  }
  const snapshot = await createSnapshot(db, {
    libraryId,
    gate,
    topicId,
    name: `${GATE_LABEL[gate]} ${new Date().toLocaleString()}`,
  });
  await change(db, { actor: "user", action: `gate_${gate}`, libraryId }, (c) =>
    raiseReviewItem(c, {
      libraryId,
      kind: "stage_gate",
      title: GATE_LABEL[gate],
      category: "informational",
      payload: { gate, snapshotId: snapshot.id },
      topicId,
      raisedBy: "user",
    }),
  );
  if (await getSetting(db, "jobs.autoTrigger", libraryId))
    await startNextStage(db, libraryId, gate, topicId);
  return snapshot;
}

/** With automatic triggering on, approving a gate starts the next stage's job. */
async function startNextStage(
  db: TDatabase,
  libraryId: string,
  gate: Gate,
  topicId: string | null,
) {
  if (gate === "synthesis") {
    const topics = await db.select().from(tTopic).where(eq(tTopic.libraryId, libraryId));
    for (const t of topics.filter((x) => !x.excluded)) {
      await startPlanning(db, libraryId, t.id).catch(() => undefined);
    }
  }
  if (gate === "card_plan" && topicId) await startGeneration(db, libraryId, topicId);
}

export async function gateStatus(
  db: TDb,
  libraryId: string,
  gate: Gate,
  topicId: string | null = null,
) {
  return {
    gate,
    label: GATE_LABEL[gate],
    snapshot: (await latestSnapshot(db, libraryId, gate, topicId)) ?? null,
    blockers: await gateBlockers(db, libraryId, gate, topicId),
  };
}
