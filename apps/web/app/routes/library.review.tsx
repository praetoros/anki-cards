import {
  actOnReviewItem,
  listReviewItems,
  REVIEW_ACTIONS,
  reviewItemDetail,
  reviewItemsWithAi,
  scheduleAutoFeedback,
  sendFeedback,
  type ReviewAction,
  type ReviewStatus,
} from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, Link, useNavigate, useNavigation, useSearchParams } from "react-router";

import { ImagePreview } from "~/components/image-preview";
import { MediaRef, MediaText, MediaValue } from "~/components/media-ref";
import { useActionToast } from "~/lib/action-toast";
import { formatDateTime } from "~/lib/format";
import { formString, handle, rt } from "~/lib/runtime.server";
import { describeTargets } from "~/lib/targets.server";
import type { Route } from "./+types/library.review";

const STATUS_FILTERS: Record<string, ReviewStatus[]> = {
  active: ["open", "awaiting_ai"],
  open: ["open"],
  awaiting_ai: ["awaiting_ai"],
  deferred: ["deferred"],
  done: ["resolved", "excluded"],
};

export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "active";
  const items = await listReviewItems(db, params.libraryId, {
    statuses: STATUS_FILTERS[filter] ?? STATUS_FILTERS["active"],
  });
  const selectedId = url.searchParams.get("item") ?? items[0]?.id ?? null;
  let selected = null;
  if (selectedId) {
    const detail = await reviewItemDetail(db, params.libraryId, selectedId);
    selected = {
      ...detail,
      targetViews: await describeTargets(db, params.libraryId, detail.targets),
    };
  }
  return { items, filter, selected, withAi: [...(await reviewItemsWithAi(db, params.libraryId))] };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const intent = formString(form, "intent");
    if (intent === "send-feedback") {
      await sendFeedback(db, params.libraryId);
      return { ok: true, message: "Sent to the AI." };
    }
    if (!REVIEW_ACTIONS.includes(intent as ReviewAction)) return { error: "Unknown action" };
    const action = intent as ReviewAction;
    await actOnReviewItem(db, params.libraryId, formString(form, "itemId"), {
      action,
      message: formString(form, "message"),
    });
    if (["correct", "comment", "approve", "accept"].includes(action)) {
      await scheduleAutoFeedback(db, params.libraryId);
    }
    return {
      ok: true,
      message: ACTION_DONE[action] ?? "Saved.",
      next: formString(form, "nextItemId") || null,
    };
  });
}

const ACTION_DONE: Partial<Record<ReviewAction, string>> = {
  accept: "Suggestion accepted.",
  correct: "Feedback saved for the AI.",
  approve: "Approved.",
  reject: "Rejected.",
  defer: "Deferred.",
  exclude: "Excluded.",
};

const CATEGORY: Record<string, { label: string; variant: "destructive" | "default" | "outline" }> =
  {
    requires_decision: { label: "Requires decision", variant: "destructive" },
    recommended_review: { label: "Recommended review", variant: "default" },
    informational: { label: "Informational", variant: "outline" },
  };

/** Row ids such as `cpr_01m5…` mean nothing to the user; media ids still show the image. */
const INTERNAL_ID = /^[a-z]+_[0-9a-z]{26}$/;

/** `includeVisualSearch` → `Include visual search`. */
function fieldLabel(key: string) {
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\burl\b/g, "URL");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Payload({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(
    ([k, v]) =>
      k !== "conceptIds" &&
      k !== "knowledgeItemIds" &&
      !(typeof v === "string" && INTERNAL_ID.test(v) && !v.startsWith("med_")),
  );
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{fieldLabel(k)}</dt>
          <dd className="whitespace-pre-wrap">
            {typeof v === "boolean" ? v ? "yes" : "no" : <MediaValue value={v} max={2000} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function Review({ loaderData, actionData }: Route.ComponentProps) {
  const { items, selected, filter } = loaderData;
  const [params] = useSearchParams();
  useActionToast(actionData);
  const busy = useNavigation().state !== "idle";
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  useEffect(() => setMessage(""), [selected?.item.id]);
  // After a decision, move on to the next open item so the queue can be worked top to bottom.
  const open = items.filter((i) => i.status === "open");
  const at = open.findIndex((i) => i.id === selected?.item.id);
  const nextItem = (at >= 0 ? [...open.slice(at + 1), ...open.slice(0, at)] : open)[0]?.id;
  useEffect(() => {
    if (actionData && "next" in actionData && actionData.next) {
      const target = new URLSearchParams(params);
      target.set("item", actionData.next);
      void navigate(`?${target.toString()}`, { replace: true, preventScrollReset: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  const withAi = new Set(loaderData.withAi);
  const awaiting = items.filter((i) => i.status === "awaiting_ai" && !withAi.has(i.id)).length;
  const working = items.filter((i) => i.status === "awaiting_ai" && withAi.has(i.id)).length;
  const media: unknown = selected?.item.payload["mediaId"];
  const proposalMedia = typeof media === "string" ? media : null;
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    return `?${next.toString()}`;
  };

  return (
    <main className="grid gap-4 p-4 lg:grid-cols-[minmax(0,380px)_1fr]">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {Object.keys(STATUS_FILTERS).map((f) => (
            <Link
              key={f}
              to={`?status=${f}`}
              className={`rounded-md px-2 py-1 text-xs ${f === filter ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              {f.replace("_", " ")}
            </Link>
          ))}
        </div>
        {awaiting > 0 && (
          <Form
            method="post"
            className="flex flex-col gap-2 rounded-md border border-rose-gold/40 bg-accent/20 p-2 text-sm"
          >
            <span>
              {awaiting === 1 ? "1 item is" : `${awaiting} items are`} ready for the AI. Send them
              when you have finished reviewing; the AI works through them together.
            </span>
            <Button
              type="submit"
              size="sm"
              name="intent"
              value="send-feedback"
              disabled={busy}
              className="self-start"
            >
              Send {awaiting} to the AI
            </Button>
          </Form>
        )}
        {working > 0 && (
          <p className="flex items-center gap-2 rounded-md border p-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-rose-gold" />
            The AI is working on {working === 1 ? "1 item" : `${working} items`}. Its replies appear
            on each item.
          </p>
        )}
        {items.length === 0 &&
          (filter === "active" ? (
            <p className="text-sm text-muted-foreground">
              Nothing needs your review.{" "}
              <Link to=".." className="text-rose-gold underline">
                See the next step
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing here.</p>
          ))}
        {items.map((item) => (
          <Link
            key={item.id}
            to={link({ item: item.id })}
            className={`flex flex-col gap-1 rounded-md border p-2 text-sm hover:bg-muted/50 ${selected?.item.id === item.id ? "border-primary" : ""}`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{item.displayId}</span>
              <Badge variant={CATEGORY[item.category]?.variant ?? "outline"}>
                {item.kind.replaceAll("_", " ")}
              </Badge>
              {item.status === "awaiting_ai" && (
                <Badge variant="secondary">
                  {withAi.has(item.id) ? "with the AI" : "ready for the AI"}
                </Badge>
              )}
            </span>
            <span>{item.title}</span>
            {item.suggestion && item.status === "open" && (
              <span className="line-clamp-2 text-xs text-muted-foreground">
                Suggested: {item.suggestion}
              </span>
            )}
          </Link>
        ))}
      </section>
      {selected && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{selected.item.displayId}</span>
            <h2 className="font-semibold">{selected.item.title}</h2>
            <Badge variant={CATEGORY[selected.item.category]?.variant ?? "outline"}>
              {CATEGORY[selected.item.category]?.label}
            </Badge>
            <Badge variant="outline">{selected.item.status.replace("_", " ")}</Badge>
            <Badge variant="outline">raised by {selected.item.raisedBy}</Badge>
          </div>
          {selected.item.description && (
            <p className="text-sm whitespace-pre-wrap">
              <MediaText text={selected.item.description} />
            </p>
          )}
          {proposalMedia && (
            <ImagePreview
              src={`/media/${proposalMedia}`}
              alt="Proposed image"
              className="self-start"
              imgClassName="max-h-64 rounded border object-contain"
            />
          )}
          <Payload payload={selected.item.payload} />
          {selected.targetViews.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {selected.targetViews.map((t) => (
                <li key={t.id}>
                  {t.table === "media_assets" ? (
                    <MediaRef id={t.id} size="md" />
                  ) : t.href ? (
                    <Link to={t.href} className="font-mono text-xs hover:underline">
                      {t.displayId}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{t.displayId}</span>
                  )}{" "}
                  <span className="text-muted-foreground">{t.label}</span>
                </li>
              ))}
            </ul>
          )}
          {selected.approvals.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Approvals: {selected.approvals.map((a) => `${a.kind} (${a.status})`).join(", ")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {selected.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md p-2 text-sm whitespace-pre-wrap ${m.author === "ai" ? "bg-muted" : "border"}`}
              >
                <span className="mb-1 block text-xs text-muted-foreground">
                  {m.author === "ai" ? "AI" : "You"}
                  {m.action ? ` · ${m.action}` : ""} · {formatDateTime(m.createdAt)}
                </span>
                {m.body ? (
                  <MediaText text={m.body} />
                ) : (
                  <em className="text-muted-foreground">(no message)</em>
                )}
              </div>
            ))}
          </div>
          {selected.item.suggestion && (
            <Form
              method="post"
              className="flex flex-col gap-2 rounded-md border border-primary/40 bg-muted/40 p-3"
              key={`suggestion-${selected.item.id}`}
            >
              <input type="hidden" name="itemId" value={selected.item.id} />
              {nextItem && <input type="hidden" name="nextItemId" value={nextItem} />}
              <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Suggested resolution
              </span>
              <p className="text-sm whitespace-pre-wrap">
                <MediaText text={selected.item.suggestion} />
              </p>
              {(selected.item.status === "open" || selected.item.status === "deferred") && (
                <Button
                  type="submit"
                  size="sm"
                  name="intent"
                  value="accept"
                  disabled={busy}
                  className="self-start"
                >
                  Accept suggestion
                </Button>
              )}
            </Form>
          )}
          {withAi.has(selected.item.id) ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-rose-gold" />
              The AI is working on this item. You can act on it again once it replies.
            </p>
          ) : (
            <Form method="post" className="flex flex-col gap-2" key={selected.item.id}>
              <input type="hidden" name="itemId" value={selected.item.id} />
              {nextItem && <input type="hidden" name="nextItemId" value={nextItem} />}
              <Textarea
                name="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder={
                  selected.item.suggestion
                    ? "Or tell the AI what to do instead"
                    : "Correction or comment for the AI"
                }
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant={selected.item.suggestion ? "outline" : "default"}
                  name="intent"
                  value="correct"
                  disabled={busy || message.trim() === ""}
                  title="The AI changes the library as you describe and replies here."
                >
                  Send feedback
                </Button>
                {!selected.item.suggestion && (
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    name="intent"
                    value="approve"
                    disabled={busy}
                  >
                    Approve
                  </Button>
                )}
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    name="intent"
                    value="defer"
                    disabled={busy}
                    title="Set it aside for later. A deferred item no longer blocks approval."
                  >
                    Defer
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    name="intent"
                    value="reject"
                    disabled={busy}
                    title="Close it without any change."
                  >
                    Reject
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    name="intent"
                    value="exclude"
                    disabled={busy}
                    title="Close it and leave the knowledge it is about out of the cards."
                  >
                    Exclude
                  </Button>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Defer sets it aside, Reject closes it unchanged, Exclude also keeps the affected
                knowledge out of the cards.
              </p>
            </Form>
          )}
        </section>
      )}
    </main>
  );
}
