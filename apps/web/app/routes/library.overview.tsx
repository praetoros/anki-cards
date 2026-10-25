import {
  approveGate,
  gateStatus,
  getLibrary,
  libraryOutline,
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
  };
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
              <Form method="post">
                <Button
                  type="submit"
                  size="sm"
                  name="intent"
                  value="synthesise"
                  disabled={busy || d.pending.length === 0}
                >
                  Synthesise {d.pending.length} source(s)
                </Button>
              </Form>
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
    </main>
  );
}
