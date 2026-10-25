import {
  getLibrary,
  libraryOutline,
  listJobs,
  listSessions,
  sessionSummaryFor,
  startTopicSession,
} from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import { NavLink, Outlet, useFetcher } from "react-router";

import { JobsPanel } from "~/components/jobs-panel";
import { SessionActions } from "~/components/session-actions";
import { handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const libraryId = params.libraryId;
  const sessions = await listSessions(db, libraryId);
  const summaries: Record<string, { id: string; body: string; edited: boolean } | null> = {};
  for (const s of sessions) {
    const summary = await sessionSummaryFor(db, s);
    summaries[s.id] = summary
      ? { id: summary.id, body: summary.body, edited: summary.edited }
      : null;
  }
  const outline = await libraryOutline(db, libraryId);
  return {
    library: await getLibrary(db, libraryId),
    sessions,
    summaries,
    topics: outline.map((t) => ({ id: t.id, title: t.title })),
    jobs: await listJobs(db, { libraryId, limit: 100 }),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const topicIds = form.getAll("topicIds").filter((v): v is string => typeof v === "string");
    await startTopicSession(db, params.libraryId, topicIds);
    return { ok: true, message: "Topic session created." };
  });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.library.name ?? "Library"} · Anki Cards` }];
}

export const LIBRARY_TABS = [
  { to: "", label: "Overview", end: true },
  { to: "sources", label: "Sources" },
  { to: "knowledge", label: "Knowledge" },
  { to: "objectives", label: "Objectives" },
  { to: "review", label: "Review" },
  { to: "cards", label: "Cards" },
  { to: "export", label: "Export" },
  { to: "chat", label: "Chat" },
  { to: "history", label: "History" },
  { to: "settings", label: "Settings" },
];

function NewTopicSession({ topics }: { topics: { id: string; title: string }[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  if (topics.length === 0) return null;
  return (
    <fetcher.Form method="post" className="flex flex-col gap-1 rounded-lg border border-dashed p-2">
      <span className="text-xs font-medium">New topic session</span>
      <select
        name="topicIds"
        multiple
        className="rounded border p-1 text-xs"
        size={Math.min(4, topics.length)}
      >
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <Button type="submit" size="xs" variant="outline" disabled={fetcher.state !== "idle"}>
        Create
      </Button>
      {fetcher.data?.error && (
        <span className="text-xs text-destructive">{fetcher.data.error}</span>
      )}
    </fetcher.Form>
  );
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { library } = loaderData;
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <h1 className="font-semibold">{library.name}</h1>
        <nav className="flex flex-wrap gap-1">
          {LIBRARY_TABS.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `rounded-md px-2 py-1 text-sm ${
                  isActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
        <JobsPanel
          sessions={loaderData.sessions}
          jobs={loaderData.jobs}
          renderActions={(s) => (
            <SessionActions session={s} summary={loaderData.summaries[s.id] ?? null} />
          )}
          footer={<NewTopicSession topics={loaderData.topics} />}
        />
      </div>
    </div>
  );
}
