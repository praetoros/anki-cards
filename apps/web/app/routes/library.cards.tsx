import {
  approveGate,
  DomainError,
  cardPlanView,
  createFeedbackItem,
  EDITABLE_FIELDS,
  gateStatus,
  latestSnapshot,
  libraryOutline,
  libraryProgress,
  resolveRow,
  scheduleAutoFeedback,
  sendFeedback,
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
import { Button, buttonVariants } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ImageModal } from "~/components/image-preview";
import { MaskEditor } from "~/components/mask-editor";
import { useActionToast } from "~/lib/action-toast";
import { formatDateTime } from "~/lib/format";
import { MediaText } from "~/components/media-ref";
import { cardsWithPreviews } from "~/lib/cards.server";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.cards";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const lib = params.libraryId;
  const progress = await libraryProgress(db, lib);
  const topics = (await libraryOutline(db, lib)).map((t) => {
    const p = progress.topics.find((x) => x.id === t.id);
    return {
      id: t.id,
      title: t.title,
      activeJob: p?.activeJob ?? null,
      setApproved: Boolean(p?.setApprovedAt),
    };
  });
  const topicId = new URL(request.url).searchParams.get("topic") ?? topics[0]?.id ?? null;
  if (!topicId)
    return {
      topics,
      topicId: null,
      activeJob: null,
      synthesisApproved: false,
      plan: null,
      cards: [],
      readyForAi: 0,
    };
  return {
    topics,
    topicId,
    activeJob: topics.find((t) => t.id === topicId)?.activeJob ?? null,
    synthesisApproved: Boolean(await latestSnapshot(db, lib, "synthesis")),
    plan: await cardPlanView(db, topicId),
    planGate: await gateStatus(db, lib, "card_plan", topicId),
    setGate: await gateStatus(db, lib, "card_set", topicId),
    cards: await cardsWithPreviews(db, topicId),
    readyForAi: progress.review.awaitingAi,
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
      case "accept-all-rows": {
        const plan = await cardPlanView(db, topicId);
        for (const row of plan?.rows.filter((r) => r.status === "proposed") ?? []) {
          await updatePlanRow(db, w, { rowId: row.id, status: "accepted" });
        }
        return { ok: true };
      }
      case "approve-plan":
        await approveGate(db, lib, "card_plan", topicId);
        // With automatic triggering on, approving has already queued generation.
        await startGeneration(db, lib, topicId).catch((error: unknown) => {
          if (!(error instanceof DomainError && error.code === "conflict")) throw error;
        });
        return { ok: true, message: "Plan approved. The AI is writing the cards." };
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
        return { ok: true, message: "Feedback saved. Send it to the AI when you are ready." };
      }
      case "send-feedback": {
        const jobs = await sendFeedback(db, lib);
        return {
          ok: true,
          message: `Sent to the AI (${jobs.length} job${jobs.length === 1 ? "" : "s"}).`,
        };
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

/**
 * Sends clicks on images inside the preview frame to the page, which shows them in a modal.
 * A srcdoc frame's `location.origin` is "null", so the target is "*"; the page checks the sender.
 */
const PREVIEW_IMAGE_SCRIPT = `<script>document.addEventListener("click",e=>{if(e.target.tagName==="IMG")parent.postMessage({type:"preview-image",src:e.target.src},"*")})</script>`;

function Preview({ css, html }: { css: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent<{ type?: string; src?: string }>) => {
      if (e.source === frame.current?.contentWindow && e.data.type === "preview-image")
        setImage(e.data.src ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <>
      <iframe
        ref={frame}
        title="Card preview"
        className="h-56 w-full rounded border bg-white"
        srcDoc={`<style>${css} body{margin:0} img{cursor:zoom-in;max-height:140px;width:auto}</style><div class="card">${html}</div>${PREVIEW_IMAGE_SCRIPT}`}
      />
      {image && (
        <ImageModal src={image} alt="Card image" open onOpenChange={(o) => !o && setImage(null)} />
      )}
    </>
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
        {entry.pendingFeedback && (
          <Link to={`../review?status=active`} relative="path">
            <Badge variant="default">feedback pending</Badge>
          </Link>
        )}
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
      {(mode === "view" || mode === "feedback") && preview && (
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
  useActionToast(actionData);
  const [show, setShow] = useState<"review" | "approved" | "all">(() =>
    d.cards.some((c) => c.card.status === "draft") ? "review" : "all",
  );
  if (!d.topicId) {
    return <main className="p-6 text-sm text-muted-foreground">No topics yet.</main>;
  }
  const drafts = d.cards.filter((c) => c.card.status === "draft");
  const approvable = drafts.filter((c) => !c.pendingFeedback);
  const shown = d.cards.filter((c) =>
    show === "review"
      ? c.card.status === "draft"
      : show === "approved"
        ? c.card.status === "approved"
        : true,
  );
  const setApproved = Boolean(d.setGate?.snapshot) && d.setGate?.blockers.length === 0;
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
            {t.activeJob && <LoaderCircle className="ml-1 inline size-3 animate-spin" />}
            {!t.activeJob && t.setApproved && (
              <Check className="ml-1 inline size-3 text-rose-gold" />
            )}
          </Link>
        ))}
      </nav>
      {d.activeJob && (
        <p className="flex items-center gap-2 rounded-md border border-rose-gold/40 bg-accent/20 p-2 text-sm">
          <LoaderCircle className="size-4 animate-spin text-rose-gold" />
          {d.activeJob === "planning"
            ? "The AI is planning the cards for this topic. The plan appears here when it is ready."
            : "The AI is writing the cards. They appear below as they are written."}
        </p>
      )}
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
              disabled={busy || !d.synthesisApproved || Boolean(d.activeJob)}
            >
              {d.plan ? "Re-plan" : "Plan cards"}
            </Button>
            {d.plan?.plan.status === "draft" &&
              d.plan.rows.some((r) => r.status === "proposed") && (
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  name="intent"
                  value="accept-all-rows"
                  disabled={busy}
                >
                  Accept all rows
                </Button>
              )}
            {d.plan?.plan.status === "draft" && (
              <Button
                type="submit"
                size="sm"
                name="intent"
                value="approve-plan"
                disabled={busy}
                title="Rows you have not rejected are written as cards."
              >
                Approve plan and write cards
              </Button>
            )}
            {d.plan?.plan.status === "approved" && !d.activeJob && (
              <Button
                type="submit"
                size="sm"
                variant={d.cards.length > 0 ? "outline" : "default"}
                name="intent"
                value="generate"
                disabled={busy}
                title={
                  d.cards.length > 0
                    ? "The AI writes cards for rows that have none yet and updates the rest."
                    : undefined
                }
              >
                {d.cards.length > 0 ? "Generate again" : "Generate cards"}
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
        {d.plan?.plan.status === "draft" && (
          <p className="text-xs text-muted-foreground">
            Reject the rows you don't want; every other row becomes a card when you approve.
          </p>
        )}
        {d.plan && d.plan.rows.length > 0 && (
          <details open={d.plan.plan.status === "draft"} className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground">
              {d.plan.rows.length} planned note(s)
            </summary>
            {d.plan.rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 border-t pt-2 text-sm">
                <Badge variant="outline">{row.cardType.replace("_", " ")}</Badge>
                <span className="min-w-0 flex-1">
                  {row.items.map((k) => k.displayId).join(", ")} —{" "}
                  <MediaText text={row.rationale} />
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
          </details>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Cards ({d.cards.length})</h2>
          {d.setGate?.snapshot && (
            <Badge variant={setApproved ? "secondary" : "outline"}>
              card set approved {formatDateTime(d.setGate.snapshot.createdAt)}
            </Badge>
          )}
          {setApproved && (
            <Link
              to="../export"
              relative="path"
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Export
            </Link>
          )}
          <Form method="post" className="ml-auto flex gap-2">
            <input type="hidden" name="topicId" value={d.topicId} />
            {approvable.map((c) => (
              <input key={c.card.id} type="hidden" name="cardIds" value={c.card.id} />
            ))}
            {approvable.length > 0 && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="intent"
                value="approve-all"
                disabled={busy}
                title={
                  approvable.length < drafts.length
                    ? "Cards with feedback pending stay drafts until the AI has updated them."
                    : undefined
                }
              >
                Approve {approvable.length} draft{approvable.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              variant={setApproved ? "outline" : "default"}
              name="intent"
              value="approve-set"
              disabled={busy || d.cards.length === 0 || (d.setGate?.blockers.length ?? 0) > 0}
              title={
                setApproved
                  ? "Approve again after changing cards so the export uses them."
                  : undefined
              }
            >
              {setApproved ? "Approve again" : "Approve card set"}
            </Button>
          </Form>
        </div>
        {d.setGate && d.setGate.blockers.length > 0 && d.cards.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {d.setGate.blockers.slice(0, 3).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {d.readyForAi > 0 && (
          <Form
            method="post"
            className="flex flex-wrap items-center gap-2 rounded-md border border-rose-gold/40 bg-accent/20 p-2 text-sm"
          >
            <span className="flex-1">
              {d.readyForAi === 1
                ? "1 piece of feedback is"
                : `${d.readyForAi} pieces of feedback are`}{" "}
              ready for the AI. Send them when you have finished reviewing.
            </span>
            <Button type="submit" size="sm" name="intent" value="send-feedback" disabled={busy}>
              Send to the AI
            </Button>
          </Form>
        )}
        {d.cards.length > 0 && (
          <nav className="flex gap-1 text-xs">
            {(
              [
                ["review", `To review (${drafts.length})`],
                [
                  "approved",
                  `Approved (${d.cards.filter((c) => c.card.status === "approved").length})`,
                ],
                ["all", `All (${d.cards.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setShow(value)}
                className={`rounded-md px-2 py-1 ${show === value ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        {shown.map((entry) => (
          <CardItem key={entry.card.id} entry={entry} />
        ))}
        {d.cards.length > 0 && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {show === "review" ? "Every card is approved." : "No cards here."}
          </p>
        )}
      </section>
    </main>
  );
}
