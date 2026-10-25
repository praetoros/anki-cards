import {
  approveGate,
  cardPlanView,
  createFeedbackItem,
  EDITABLE_FIELDS,
  gateStatus,
  latestSnapshot,
  libraryOutline,
  resolveRow,
  scheduleAutoFeedback,
  setCardStatus,
  setOcclusionMasks,
  startGeneration,
  startPlanning,
  updatePlanRow,
  upsertCard,
  type OcclusionShape,
  type PlanRowStatus,
} from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { MaskEditor } from "~/components/mask-editor";
import { MediaText } from "~/components/media-ref";
import { cardsWithPreviews } from "~/lib/cards.server";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.cards";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const lib = params.libraryId;
  const topics = (await libraryOutline(db, lib)).map((t) => ({ id: t.id, title: t.title }));
  const topicId = new URL(request.url).searchParams.get("topic") ?? topics[0]?.id ?? null;
  if (!topicId) return { topics, topicId: null, synthesisApproved: false, plan: null, cards: [] };
  return {
    topics,
    topicId,
    synthesisApproved: Boolean(await latestSnapshot(db, lib, "synthesis")),
    plan: await cardPlanView(db, topicId),
    planGate: await gateStatus(db, lib, "card_plan", topicId),
    setGate: await gateStatus(db, lib, "card_set", topicId),
    cards: await cardsWithPreviews(db, topicId),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const lib = params.libraryId;
  const w = { ctx: { actor: "user" as const, action: "", libraryId: lib } };
  return handle(async () => {
    const { db } = await rt();
    const intent = formString(form, "intent");
    const topicId = formString(form, "topicId");
    const cardId = formString(form, "cardId");
    w.ctx.action = intent.replaceAll("-", "_");
    switch (intent) {
      case "plan":
        await startPlanning(db, lib, topicId);
        return { ok: true, message: "Planning job queued." };
      case "row":
        await updatePlanRow(db, w, {
          rowId: formString(form, "rowId"),
          status: formString(form, "status") as PlanRowStatus,
        });
        return { ok: true };
      case "approve-plan":
        await approveGate(db, lib, "card_plan", topicId);
        return { ok: true, message: "Card plan approved." };
      case "generate":
        await startGeneration(db, lib, topicId);
        return { ok: true, message: "Generation job queued." };
      case "approve-card":
        await setCardStatus(db, w, [cardId], "approved");
        return { ok: true };
      case "approve-all":
        await setCardStatus(db, w, form.getAll("cardIds").map(String), "approved");
        return { ok: true };
      case "retire-card":
        await setCardStatus(db, w, [cardId], "retired");
        return { ok: true };
      case "edit-card": {
        const card = await resolveRow(db, "cards", lib, cardId);
        const fields: Record<string, string> = {};
        for (const f of EDITABLE_FIELDS[card.cardType]) fields[f] = formString(form, `field:${f}`);
        await upsertCard(db, w, {
          id: card.id,
          expectedVersion: card.version,
          topicId: card.topicId,
          cardType: card.cardType,
          fields,
          mediaIds: card.mediaIds,
          knowledgeItemIds: card.knowledgeItemIds,
        });
        return { ok: true, message: "Saved." };
      }
      case "feedback": {
        const card = await resolveRow(db, "cards", lib, cardId);
        await createFeedbackItem(db, lib, {
          target: { table: "cards", id: card.id },
          title: `Card ${card.displayId}`,
          message: formString(form, "message"),
          topicId: card.topicId,
        });
        await scheduleAutoFeedback(db, lib);
        return { ok: true, message: "Feedback recorded." };
      }
      case "save-masks":
        await setOcclusionMasks(db, w, {
          cardId,
          mediaId: formString(form, "mediaId"),
          shapes: JSON.parse(formString(form, "shapes")) as OcclusionShape[],
          origin: "user",
        });
        return { ok: true, message: "Masks saved." };
      case "approve-set":
        await approveGate(db, lib, "card_set", topicId);
        return { ok: true, message: "Card set approved. Ready to export." };
      default:
        return { error: "Unknown action" };
    }
  });
}

function Preview({ css, html }: { css: string; html: string }) {
  return (
    <iframe
      title="Card preview"
      className="h-48 w-full rounded border bg-white"
      srcDoc={`<style>${css} body{margin:0}</style><div class="card">${html}</div>`}
    />
  );
}

type CardEntry = Route.ComponentProps["loaderData"]["cards"][number];

function CardItem({ entry }: { entry: CardEntry }) {
  const { card, previews, css, masks } = entry;
  const [mode, setMode] = useState<"view" | "edit" | "feedback" | "masks">("view");
  const [ord, setOrd] = useState(0);
  const preview = previews[ord] ?? previews[0];
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{card.displayId}</span>
        <Badge variant="outline">{card.cardType.replace("_", " ")}</Badge>
        <Badge variant={card.status === "approved" ? "secondary" : "outline"}>{card.status}</Badge>
        {card.warning && <Badge variant="destructive">uncertain</Badge>}
        <span className="ml-auto flex flex-wrap gap-1">
          {(["view", "edit", "feedback"] as const).map((m) => (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? "secondary" : "ghost"}
              onClick={() => setMode(m)}
            >
              {m === "view" ? "Preview" : m === "edit" ? "Edit" : "Feedback"}
            </Button>
          ))}
          {card.cardType === "image_occlusion" && (
            <Button
              size="xs"
              variant={mode === "masks" ? "secondary" : "ghost"}
              onClick={() => setMode("masks")}
            >
              Masks
            </Button>
          )}
          <Form method="post" className="flex gap-1">
            <input type="hidden" name="cardId" value={card.id} />
            {card.status !== "approved" && (
              <Button type="submit" size="xs" name="intent" value="approve-card">
                Approve
              </Button>
            )}
            {card.status !== "retired" && (
              <Button type="submit" size="xs" variant="ghost" name="intent" value="retire-card">
                Retire
              </Button>
            )}
          </Form>
        </span>
      </div>
      {mode === "view" && preview && (
        <div className="flex flex-col gap-1">
          {previews.length > 1 && (
            <div className="flex gap-1">
              {previews.map((p, i) => (
                <Button
                  key={p.ord}
                  size="xs"
                  variant={i === ord ? "secondary" : "ghost"}
                  onClick={() => setOrd(i)}
                >
                  Card {p.ord + 1}
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            <Preview css={css} html={preview.front} />
            <Preview css={css} html={preview.back} />
          </div>
        </div>
      )}
      {mode === "view" && !preview && (
        <p className="text-xs text-muted-foreground">No preview yet (masks missing?).</p>
      )}
      {mode === "edit" && (
        <Form method="post" className="flex flex-col gap-2" onSubmit={() => setMode("view")}>
          <input type="hidden" name="cardId" value={card.id} />
          {Object.keys(card.fields).map((f) => (
            <label key={f} className="flex flex-col gap-1 text-xs">
              {f}
              <Textarea name={`field:${f}`} defaultValue={card.fields[f]} rows={2} />
            </label>
          ))}
          <Button type="submit" size="xs" name="intent" value="edit-card" className="self-start">
            Save
          </Button>
        </Form>
      )}
      {mode === "feedback" && (
        <Form method="post" className="flex flex-col gap-2" onSubmit={() => setMode("view")}>
          <input type="hidden" name="cardId" value={card.id} />
          <Textarea
            name="message"
            rows={2}
            placeholder="What should the AI change about this card?"
            required
          />
          <Button type="submit" size="xs" name="intent" value="feedback" className="self-start">
            Send feedback
          </Button>
        </Form>
      )}
      {mode === "masks" && card.mediaIds[0] && (
        <MaskEditor cardId={card.id} mediaId={card.mediaIds[0]} initial={masks} />
      )}
    </div>
  );
}

export default function Cards({ loaderData, actionData }: Route.ComponentProps) {
  const d = loaderData;
  const busy = useNavigation().state !== "idle";
  if (!d.topicId) {
    return <main className="p-6 text-sm text-muted-foreground">No topics yet.</main>;
  }
  const drafts = d.cards.filter((c) => c.card.status === "draft");
  return (
    <main className="flex flex-col gap-4 p-4">
      <nav className="flex flex-wrap gap-1">
        {d.topics.map((t) => (
          <Link
            key={t.id}
            to={`?topic=${t.id}`}
            className={`rounded-md px-2 py-1 text-sm ${t.id === d.topicId ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            {t.title}
          </Link>
        ))}
      </nav>
      {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
      {actionData?.message && <p className="text-sm text-muted-foreground">{actionData.message}</p>}

      <section className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Card plan</h2>
          {d.plan && (
            <Badge variant={d.plan.plan.status === "approved" ? "secondary" : "outline"}>
              {d.plan.plan.status}
            </Badge>
          )}
          <Form method="post" className="ml-auto flex gap-2">
            <input type="hidden" name="topicId" value={d.topicId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="intent"
              value="plan"
              disabled={busy || !d.synthesisApproved}
            >
              {d.plan ? "Re-plan" : "Plan cards"}
            </Button>
            {d.plan?.plan.status === "draft" && (
              <Button type="submit" size="sm" name="intent" value="approve-plan" disabled={busy}>
                Approve plan
              </Button>
            )}
            {d.plan?.plan.status === "approved" && (
              <Button type="submit" size="sm" name="intent" value="generate" disabled={busy}>
                Generate cards
              </Button>
            )}
          </Form>
        </div>
        {!d.synthesisApproved && (
          <p className="text-xs text-muted-foreground">
            Approve the synthesis on the overview first.
          </p>
        )}
        {d.plan?.plan.summary && <p className="text-sm">{d.plan.plan.summary}</p>}
        {d.plan?.rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
            <Badge variant="outline">{row.cardType.replace("_", " ")}</Badge>
            <span className="min-w-0 flex-1">
              {row.items.map((k) => k.displayId).join(", ")} — <MediaText text={row.rationale} />
            </span>
            <Badge variant={row.status === "rejected" ? "destructive" : "outline"}>
              {row.status}
            </Badge>
            {d.plan?.plan.status === "draft" && (
              <Form method="post" className="flex gap-1">
                <input type="hidden" name="rowId" value={row.id} />
                <input type="hidden" name="intent" value="row" />
                <Button type="submit" size="xs" variant="ghost" name="status" value="accepted">
                  Accept
                </Button>
                <Button type="submit" size="xs" variant="ghost" name="status" value="rejected">
                  Reject
                </Button>
              </Form>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Cards ({d.cards.length})</h2>
          <Form method="post" className="ml-auto flex gap-2">
            <input type="hidden" name="topicId" value={d.topicId} />
            {drafts.map((c) => (
              <input key={c.card.id} type="hidden" name="cardIds" value={c.card.id} />
            ))}
            {drafts.length > 0 && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="intent"
                value="approve-all"
                disabled={busy}
              >
                Approve {drafts.length} draft(s)
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              name="intent"
              value="approve-set"
              disabled={busy || d.cards.length === 0 || (d.setGate?.blockers.length ?? 0) > 0}
            >
              Approve card set
            </Button>
          </Form>
        </div>
        {d.setGate && d.setGate.blockers.length > 0 && d.cards.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {d.setGate.blockers.slice(0, 3).join("; ")}
          </p>
        )}
        {d.cards.map((entry) => (
          <CardItem key={entry.card.id} entry={entry} />
        ))}
      </section>
    </main>
  );
}
