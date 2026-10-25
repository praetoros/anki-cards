import type { TJobS, TSessionS } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Progress } from "@anki-cards/ui/components/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@anki-cards/ui/components/sheet";
import { useState } from "react";
import { useFetcher } from "react-router";

import { formatTime } from "~/lib/format";

import { JobStream } from "./job-stream";

const CONTEXT_WINDOW: Record<string, number> = { claude: 200_000, codex: 272_000 };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  running: "default",
  queued: "outline",
  waiting: "outline",
  paused: "destructive",
  failed: "destructive",
  cancelled: "outline",
  done: "secondary",
};

export function JobStatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "outline"}>{status}</Badge>;
}

function JobRow({ job, onOpen }: { job: TJobS; onOpen: () => void }) {
  const fetcher = useFetcher();
  const active = ["running", "queued", "waiting", "paused"].includes(job.status);
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
      >
        <JobStatusBadge status={job.status} />
        <span className="truncate">{job.kind}</span>
        {job.resumeAfter && job.status === "waiting" && (
          <span className="text-xs text-muted-foreground">until {formatTime(job.resumeAfter)}</span>
        )}
      </button>
      {active && (
        <fetcher.Form method="post" action={`/api/jobs/${job.id}`}>
          <Button type="submit" size="xs" variant="ghost" name="intent" value="cancel">
            Cancel
          </Button>
        </fetcher.Form>
      )}
    </div>
  );
}

export function SessionCard({
  session,
  jobs,
  onOpenJob,
  actions,
}: {
  session: TSessionS;
  jobs: TJobS[];
  onOpenJob: (id: string) => void;
  actions?: React.ReactNode;
}) {
  const window = CONTEXT_WINDOW[session.provider] ?? 200_000;
  const pct = Math.min(100, Math.round((session.contextTokens / window) * 100));
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{session.title}</span>
        <Badge variant="outline">{session.provider}</Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-24 shrink-0">Context {pct}%</span>
        <Progress value={pct} className="flex-1" />
      </div>
      <div className="flex flex-col gap-1">
        {jobs.slice(0, 5).map((job) => (
          <JobRow key={job.id} job={job} onOpen={() => onOpenJob(job.id)} />
        ))}
        {jobs.length === 0 && <span className="text-xs text-muted-foreground">No jobs yet.</span>}
      </div>
      {actions}
    </div>
  );
}

export function JobSheet({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  return (
    <Sheet open={jobId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Job</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">{jobId && <JobStream jobId={jobId} />}</div>
      </SheetContent>
    </Sheet>
  );
}

export function JobsPanel({
  sessions,
  jobs,
  renderActions,
  footer,
}: {
  sessions: TSessionS[];
  jobs: TJobS[];
  renderActions?: (session: TSessionS) => React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [openJob, setOpenJob] = useState<string | null>(null);
  return (
    <aside className="flex w-full flex-col gap-2 border-l p-3 lg:w-80">
      <h2 className="text-sm font-semibold">AI sessions</h2>
      {sessions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sessions appear here when you start AI work.
        </p>
      )}
      {sessions.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          jobs={jobs.filter((j) => j.sessionId === s.id)}
          onOpenJob={setOpenJob}
          actions={renderActions?.(s)}
        />
      ))}
      {footer}
      <JobSheet jobId={openJob} onClose={() => setOpenJob(null)} />
    </aside>
  );
}
