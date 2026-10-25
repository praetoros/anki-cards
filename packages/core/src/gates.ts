import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { tCard, tCardPlan, tReviewItem } from "./db/schema/index.ts";
import type { Gate } from "./domain/enums.ts";
import { DomainError } from "./errors.ts";
import { change } from "./history.ts";
import { raiseReviewItem } from "./review.ts";
import { createSnapshot, latestSnapshot } from "./snapshots.ts";

export const GATE_LABEL: Record<Gate, string> = {
  synthesis: "Synthesis approved",
  card_plan: "Card plan approved",
  card_set: "Card set approved",
};

/** Open decisions that stop a gate. Deferred items count as acknowledged and don't block. */
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
      for (const p of plans) await c.update("card_plans", p.id, { status: "approved" });
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
  return snapshot;
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
