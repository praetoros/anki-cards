import {
  actOnReviewItem,
  listReviewItems,
  REVIEW_ACTIONS,
  reviewItemDetail,
  scheduleAutoFeedback,
  sendFeedback,
  type ReviewAction,
  type ReviewStatus,
} from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

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
  return { items, filter, selected };
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
    if (action === "correct" || action === "comment" || action === "approve") {
      await scheduleAutoFeedback(db, params.libraryId);
    }
    return { ok: true, message: "Saved." };
  });
}

const CATEGORY: Record<string, { label: string; variant: "destructive" | "default" | "outline" }> =
  {
    requires_decision: { label: "Requires decision", variant: "destructive" },
    recommended_review: { label: "Recommended review", variant: "default" },
    informational: { label: "Informational", variant: "outline" },
  };

function Payload({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(
    ([k]) => k !== "conceptIds" && k !== "knowledgeItemIds",
  );
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-2 gap-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="whitespace-pre-wrap">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Review({ loaderData, actionData }: Route.ComponentProps) {
  const { items, selected, filter } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const awaiting = items.filter((i) => i.status === "awaiting_ai").length;
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
          <Form method="post">
            <Button type="submit" size="sm" name="intent" value="send-feedback" disabled={busy}>
              Send {awaiting} item(s) to AI
            </Button>
          </Form>
        )}
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
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
              {item.status === "awaiting_ai" && <Badge variant="secondary">waiting for AI</Badge>}
            </span>
            <span>{item.title}</span>
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
            <p className="text-sm whitespace-pre-wrap">{selected.item.description}</p>
          )}
          <Payload payload={selected.item.payload} />
          {selected.targetViews.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {selected.targetViews.map((t) => (
                <li key={t.id}>
                  {t.href ? (
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
                  {m.action ? ` · ${m.action}` : ""} · {new Date(m.createdAt).toLocaleString()}
                </span>
                {m.body || <em className="text-muted-foreground">(no message)</em>}
              </div>
            ))}
          </div>
          <Form method="post" className="flex flex-col gap-2" key={selected.item.id}>
            <input type="hidden" name="itemId" value={selected.item.id} />
            <Textarea name="message" rows={3} placeholder="Correction or comment for the AI" />
            {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" name="intent" value="correct" disabled={busy}>
                Send correction
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="intent"
                value="comment"
                disabled={busy}
              >
                Comment
              </Button>
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
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                name="intent"
                value="reject"
                disabled={busy}
              >
                Reject
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                name="intent"
                value="defer"
                disabled={busy}
              >
                Defer
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                name="intent"
                value="exclude"
                disabled={busy}
              >
                Exclude
              </Button>
            </div>
          </Form>
        </section>
      )}
    </main>
  );
}
