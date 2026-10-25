import {
  approveGate,
  getLibrary,
  libraryProgress,
  nextStep,
  pendingEnrichment,
  sendFeedback,
  startEnrichment,
  startPlanning,
  startSynthesis,
  stepStates,
  type NextStep,
  type TopicProgress,
} from "@anki-cards/core";
// Values used in the component must come from a browser-safe entry, not the server package.
import { WORKFLOW_STEPS } from "@anki-cards/core/enums";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button, buttonVariants } from "@anki-cards/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@anki-cards/ui/components/card";
import { Check } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";

import { ConfirmSubmit } from "~/components/confirm-submit";
import { Spinner } from "~/components/xdd-face";
import { useActionToast } from "~/lib/action-toast";
import { formatDateTime } from "~/lib/format";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.overview";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const progress = await libraryProgress(db, params.libraryId);
  return {
    library: await getLibrary(db, params.libraryId),
    progress,
    next: nextStep(progress),
    states: stepStates(progress),
    enrichment: (await pendingEnrichment(db, params.libraryId)).length,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const intent = formString(form, "intent");
    if (intent === "synthesise") {
      await startSynthesis(db, params.libraryId);
      return { ok: true, message: "Synthesis started. Progress shows under AI sessions." };
    }
    if (intent === "send-feedback") {
      const jobs = await sendFeedback(db, params.libraryId);
      return {
        ok: true,
        message: `Sent to the AI (${jobs.length} job${jobs.length === 1 ? "" : "s"}).`,
      };
    }
    if (intent === "enrich") {
      await startEnrichment(db, params.libraryId);
      return { ok: true, message: "Research started." };
    }
    if (intent === "plan-all") {
      const progress = await libraryProgress(db, params.libraryId);
      const topics = progress.topics.filter((t) => !t.plan && !t.activeJob);
      for (const t of topics) await startPlanning(db, params.libraryId, t.id);
      return { ok: true, message: `Planning started for ${topics.length} topics.` };
    }
    if (intent === "approve-synthesis") {
      await approveGate(db, params.libraryId, "synthesis");
      return { ok: true, message: "Synthesis approved. You can now plan cards." };
    }
    return { error: "Unknown action" };
  });
}

type Progress = Route.ComponentProps["loaderData"]["progress"];

function Stepper({ states }: { states: Route.ComponentProps["loaderData"]["states"] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
      {WORKFLOW_STEPS.map((step, i) => {
        const state = states[step.id];
        return (
          <li key={step.id} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium ${
                state === "done"
                  ? "bg-highlight/20 text-highlight"
                  : state === "current"
                    ? "bg-highlight text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={
                state === "current"
                  ? "font-medium text-foreground"
                  : state === "done"
                    ? "text-foreground/80"
                    : "text-muted-foreground"
              }
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function NextStepCard({ next, progress }: { next: NextStep; progress: Progress }) {
  const busy = useNavigation().state !== "idle";
  const action = next.action;
  const partlyCovered = progress.sources.pending.filter((s) => s.covered > 0);
  return (
    <Card className="border-highlight/40 bg-linear-to-br from-accent/30 to-transparent">
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-wide text-highlight uppercase">
          {next.done ? "Done" : "Next step"}
        </CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          {!action && <Spinner size="md" className="text-highlight" />}
          {next.title}
        </CardTitle>
        <CardDescription>{next.detail}</CardDescription>
      </CardHeader>
      {action && (
        <CardContent>
          {action.kind === "link" ? (
            <Link to={action.to} className={buttonVariants()}>
              {action.label}
            </Link>
          ) : (
            <ConfirmSubmit
              size="default"
              fields={{ intent: action.intent }}
              disabled={busy}
              confirm={
                action.intent === "synthesise" && partlyCovered.length > 0
                  ? {
                      title: "Synthesise sources again?",
                      description: `${partlyCovered.map((s) => `${s.displayId} (${s.covered}/${s.units} units)`).join(", ")} already ${partlyCovered.length === 1 ? "has" : "have"} knowledge in the library. The AI will re-read them and may change existing knowledge items; the changes can be reverted from History.`,
                      action: "Synthesise",
                    }
                  : null
              }
            >
              {action.label}
            </ConfirmSubmit>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function topicStatus(t: TopicProgress) {
  if (t.activeJob === "planning") return "planning…";
  if (t.activeJob === "generation") return "writing cards…";
  if (!t.plan) return "not planned";
  if (t.plan === "draft") return `plan to review (${t.planRows})`;
  if (t.cards === 0) return "plan approved";
  if (t.drafts > 0) return `${t.drafts} of ${t.cards} cards to review`;
  if (!t.setApprovedAt) return `${t.cards} cards approved`;
  return `${t.cards} cards · set approved`;
}

export default function Overview({ loaderData, actionData }: Route.ComponentProps) {
  const { progress: p, next, states } = loaderData;
  const busy = useNavigation().state !== "idle";
  useActionToast(actionData);
  const synthesisApproved = p.synthesis.approvedAt !== null;
  return (
    <main className="flex flex-col gap-4 p-6">
      {loaderData.library.description && (
        <p className="text-sm text-muted-foreground">{loaderData.library.description}</p>
      )}
      <Stepper states={states} />
      <NextStepCard next={next} progress={p} />

      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Sources and knowledge</CardTitle>
            <CardDescription>
              {p.sources.total} source{p.sources.total === 1 ? "" : "s"}
              {p.sources.pending.length > 0 && `, ${p.sources.pending.length} not synthesised`}
              {p.activeJobs.includes("synthesis") && ", synthesis running"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex gap-6">
              <Stat label="topics" value={p.knowledge.topics} />
              <Stat label="concepts" value={p.knowledge.concepts} />
              <Stat label="knowledge items" value={p.knowledge.knowledgeItems} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="sources" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Sources
              </Link>
              {p.knowledge.topics > 0 && (
                <Link to="knowledge" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Knowledge
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <CardDescription>
              {p.review.open} open
              {p.review.decisions > 0 && ` (${p.review.decisions} need a decision)`}
              {p.review.awaitingAi > 0 && `, ${p.review.awaitingAi} ready for the AI`}
              {p.review.withAi > 0 && `, ${p.review.withAi} with the AI`}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link to="review" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Review queue
            </Link>
            {p.review.awaitingAi > 0 &&
              !(next.action?.kind === "intent" && next.action.intent === "send-feedback") && (
                <Form method="post">
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    name="intent"
                    value="send-feedback"
                    disabled={busy}
                  >
                    Send {p.review.awaitingAi} to the AI
                  </Button>
                </Form>
              )}
            {loaderData.enrichment > 0 && p.activeJobs.length === 0 && (
              <Form method="post">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  name="intent"
                  value="enrich"
                  disabled={busy}
                >
                  Research {loaderData.enrichment} approved request
                  {loaderData.enrichment === 1 ? "" : "s"}
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Synthesis approval
              <Badge variant={synthesisApproved ? "secondary" : "outline"}>
                {synthesisApproved ? "approved" : "not approved"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {synthesisApproved
                ? `Approved ${formatDateTime(p.synthesis.approvedAt!)}. Approve again after changing the knowledge so new plans use it.`
                : "Fixes this version of the knowledge library; cards are planned from it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {p.synthesis.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {p.synthesis.blockers.slice(0, 5).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {next.action?.kind !== "intent" || next.action.intent !== "approve-synthesis" ? (
              <Form method="post">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  name="intent"
                  value="approve-synthesis"
                  disabled={busy || p.synthesis.blockers.length > 0 || p.knowledge.concepts === 0}
                >
                  {synthesisApproved ? "Approve again" : "Approve synthesis"}
                </Button>
              </Form>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Cards by topic</CardTitle>
          <CardDescription>
            Each topic is planned, written and approved on its own. Export takes every approved card
            set.
            {p.lastExport &&
              ` Last export ${formatDateTime(p.lastExport.at)}: ${p.lastExport.total} cards.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {p.topics.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="font-mono text-xs text-muted-foreground">{t.displayId}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground">{topicStatus(t)}</span>
              {synthesisApproved && (
                <Link
                  to={`cards?topic=${t.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open cards
                </Link>
              )}
            </div>
          ))}
          {p.topics.length === 0 && (
            <p className="text-xs text-muted-foreground">Topics appear after synthesis.</p>
          )}
          {!synthesisApproved && p.topics.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Cards can be planned once the synthesis is approved.
            </p>
          )}
          {p.topics.some((t) => t.setApprovedAt) && (
            <Link
              to="export"
              className={`${buttonVariants({ variant: "outline", size: "sm" })} self-start`}
            >
              Exports
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
