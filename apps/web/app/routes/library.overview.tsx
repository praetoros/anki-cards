import {
  approveGate,
  cardPlanView,
  gateStatus,
  getLibrary,
  latestSnapshot,
  libraryOutline,
  listCards,
  listExports,
  listReviewItems,
  listSources,
  pendingEnrichment,
  sendFeedback,
  startEnrichment,
  startSynthesis,
  unsynthesisedSources,
} from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button, buttonVariants } from "@anki-cards/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@anki-cards/ui/components/card";
import { Form, Link, useNavigation } from "react-router";

import { ConfirmSubmit } from "~/components/confirm-submit";
import { formatDateTime } from "~/lib/format";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.overview";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const libraryId = params.libraryId;
  const outline = await libraryOutline(db, libraryId);
  const concepts = outline.flatMap((t) => t.subtopics.flatMap((s) => s.concepts));
  const review = await listReviewItems(db, libraryId, { statuses: ["open", "awaiting_ai"] });
  return {
    library: await getLibrary(db, libraryId),
    sources: await listSources(db, libraryId),
    pending: await unsynthesisedSources(db, libraryId),
    counts: {
      topics: outline.length,
      concepts: concepts.length,
      knowledgeItems: concepts.reduce((n, c) => n + c.knowledgeItemCount, 0),
    },
    open: review.filter((r) => r.status === "open").length,
    decisions: review.filter((r) => r.status === "open" && r.category === "requires_decision")
      .length,
    awaitingAi: review.filter((r) => r.status === "awaiting_ai").length,
    synthesisGate: await gateStatus(db, libraryId, "synthesis"),
    enrichment: (await pendingEnrichment(db, libraryId)).length,
    topicCards: await Promise.all(
      outline.map(async (t) => {
        const plan = await cardPlanView(db, t.id);
        const cards = await listCards(db, t.id);
        return {
          id: t.id,
          displayId: t.displayId,
          title: t.title,
          plan: plan?.plan.status ?? null,
          planRows: plan?.rows.length ?? 0,
          cards: cards.filter((c) => c.status !== "retired").length,
          drafts: cards.filter((c) => c.status === "draft").length,
          setApprovedAt: (await latestSnapshot(db, libraryId, "card_set", t.id))?.createdAt ?? null,
        };
      }),
    ),
    lastExport: (await listExports(db, libraryId))[0] ?? null,
  };
}

type TopicCards = Route.ComponentProps["loaderData"]["topicCards"][number];

function nextCardStep(t: TopicCards, synthesisApproved: boolean) {
  if (!synthesisApproved) return "Approve the synthesis first";
  if (!t.plan) return "Plan cards";
  if (t.plan === "draft") return `Review the plan (${t.planRows} rows)`;
  if (t.cards === 0) return "Generate cards";
  if (t.drafts > 0) return `Review ${t.drafts} draft card(s)`;
  if (!t.setApprovedAt) return "Approve the card set";
  return "Ready to export";
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const intent = formString(form, "intent");
    if (intent === "synthesise") {
      await startSynthesis(db, params.libraryId);
      return { ok: true, message: "Synthesis job queued." };
    }
    if (intent === "send-feedback") {
      const jobs = await sendFeedback(db, params.libraryId);
      return { ok: true, message: `${jobs.length} feedback job(s) queued.` };
    }
    if (intent === "enrich") {
      await startEnrichment(db, params.libraryId);
      return { ok: true, message: "Enrichment job queued." };
    }
    if (intent === "approve-synthesis") {
      await approveGate(db, params.libraryId, "synthesis");
      return { ok: true, message: "Synthesis approved and snapshot created." };
    }
    return { error: "Unknown action" };
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default function Overview({ loaderData, actionData }: Route.ComponentProps) {
  const d = loaderData;
  const busy = useNavigation().state !== "idle";
  const partlyCovered = d.pending.filter((s) => s.covered > 0);
  return (
    <main className="flex flex-col gap-4 p-6">
      {d.library.description && (
        <p className="text-sm text-muted-foreground">{d.library.description}</p>
      )}
      {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
      {actionData?.message && <p className="text-sm text-muted-foreground">{actionData.message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>1. Sources and synthesis</CardTitle>
            <CardDescription>
              {d.sources.length} source(s); {d.pending.length} not yet synthesised.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-6">
              <Stat label="topics" value={d.counts.topics} />
              <Stat label="concepts" value={d.counts.concepts} />
              <Stat label="knowledge items" value={d.counts.knowledgeItems} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="../sources"
                relative="path"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Sources
              </Link>
              <ConfirmSubmit
                fields={{ intent: "synthesise" }}
                disabled={busy || d.pending.length === 0}
                confirm={
                  partlyCovered.length > 0
                    ? {
                        title: "Synthesise sources again?",
                        description: `${partlyCovered.map((s) => `${s.displayId} (${s.covered}/${s.units} units)`).join(", ")} already ${partlyCovered.length === 1 ? "has" : "have"} knowledge in the library. The AI will re-read these sources and may change existing knowledge items; the changes can be reverted from History.`,
                        action: "Synthesise",
                      }
                    : null
                }
              >
                Synthesise {d.pending.length} source(s)
              </ConfirmSubmit>
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>
              {d.open} open ({d.decisions} need a decision), {d.awaitingAi} waiting for the AI.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link
              to="../review"
              relative="path"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Review queue
            </Link>
            <Form method="post">
              <Button
                type="submit"
                size="sm"
                name="intent"
                value="send-feedback"
                disabled={busy || d.awaitingAi === 0}
              >
                Send {d.awaitingAi} item(s) to AI
              </Button>
            </Form>
            {d.enrichment > 0 && (
              <Form method="post">
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  name="intent"
                  value="enrich"
                  disabled={busy}
                >
                  Research {d.enrichment} approved request(s)
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Synthesis gate
              {d.synthesisGate.snapshot ? (
                <Badge variant="secondary">approved</Badge>
              ) : (
                <Badge variant="outline">not approved</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Approving freezes a snapshot that card planning reads.
              {d.synthesisGate.snapshot &&
                ` Last: ${formatDateTime(d.synthesisGate.snapshot.createdAt)}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {d.synthesisGate.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {d.synthesisGate.blockers.slice(0, 5).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <Form method="post">
              <Button
                type="submit"
                size="sm"
                name="intent"
                value="approve-synthesis"
                disabled={busy || d.synthesisGate.blockers.length > 0 || d.counts.concepts === 0}
              >
                Approve synthesis
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle>2. Cards and export</CardTitle>
          <CardDescription>
            Each topic is planned, generated and approved on its own; export takes every approved
            card set.
            {d.lastExport &&
              ` Last export ${formatDateTime(d.lastExport.createdAt)}: ${d.lastExport.counts.total} card(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {d.topicCards.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="font-mono text-xs text-muted-foreground">{t.displayId}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {t.cards} card(s){t.setApprovedAt && " · set approved"}
              </span>
              <Link
                to={`../cards?topic=${t.id}`}
                relative="path"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {nextCardStep(t, Boolean(d.synthesisGate.snapshot))}
              </Link>
            </div>
          ))}
          {d.topicCards.length === 0 && (
            <p className="text-xs text-muted-foreground">Topics appear after synthesis.</p>
          )}
          <Link
            to="../export"
            relative="path"
            className={`${buttonVariants({ size: "sm" })} self-start`}
          >
            Export .apkg
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
