import {
  changesetFieldDiff,
  changesetSummaries,
  listSnapshots,
  restoreLibraryTo,
  revertChangesets,
  revertJob,
  RevertConflictError,
} from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Form, Link, useNavigation, useSearchParams } from "react-router";

import { formatDateTime } from "~/lib/format";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.history";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || undefined;
  const sets = await changesetSummaries(db, params.libraryId, 50, before);
  const selectedId = url.searchParams.get("changeset") ?? sets[0]?.id ?? null;
  return {
    sets,
    selectedId,
    diff: selectedId ? await changesetFieldDiff(db, selectedId) : [],
    snapshots: await listSnapshots(db, params.libraryId),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  const lib = params.libraryId;
  try {
    return await handle(async () => {
      const { db } = await rt();
      const intent = formString(form, "intent");
      const ctx = { actor: "user" as const, action: intent, libraryId: lib };
      if (intent === "revert") {
        await revertChangesets(db, [formString(form, "changesetId")], ctx);
        return { ok: true, message: "Reverted." };
      }
      if (intent === "revert-job") {
        await revertJob(db, formString(form, "jobId"), ctx);
        return { ok: true, message: "Reverted every change of the job." };
      }
      if (intent === "restore") {
        await restoreLibraryTo(db, lib, Number(formString(form, "seq")), ctx);
        return { ok: true, message: "Library restored. The restore can itself be reverted." };
      }
      return { error: "Unknown action" };
    });
  } catch (error) {
    if (error instanceof RevertConflictError) {
      return { error: error.message, message: undefined };
    }
    throw error;
  }
}

function show(value: unknown) {
  if (value === undefined || value === null) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export default function History({ loaderData, actionData }: Route.ComponentProps) {
  const { sets, diff, selectedId, snapshots } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const selected = sets.find((s) => s.id === selectedId);
  const last = sets.at(-1);
  return (
    <main className="grid gap-4 p-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <section className="flex flex-col gap-1">
        {snapshots.length > 0 && (
          <div className="mb-2 flex flex-col gap-1 rounded-md border p-2 text-xs">
            <span className="font-semibold">Snapshots</span>
            {snapshots.map((s) => (
              <span key={s.id}>
                {s.name} <span className="text-muted-foreground">(#{s.changesetSeq})</span>
              </span>
            ))}
          </div>
        )}
        {sets.map((s) => (
          <Link
            key={s.id}
            to={`?${new URLSearchParams({ ...Object.fromEntries(params), changeset: s.id })}`}
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted ${
              s.id === selectedId ? "bg-muted" : ""
            }`}
          >
            <span className="w-10 font-mono text-xs text-muted-foreground">#{s.seq}</span>
            <Badge variant={s.actor === "ai" ? "default" : "outline"}>{s.actor}</Badge>
            <span className="truncate">{s.action.replaceAll("_", " ")}</span>
            <span className="ml-auto text-xs text-muted-foreground">{s.rows}</span>
          </Link>
        ))}
        {sets.length === 50 && last && (
          <Link
            to={`?before=${last.seq}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            Older…
          </Link>
        )}
      </section>
      {selected && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">
              #{selected.seq} {selected.action.replaceAll("_", " ")}
            </h2>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(selected.createdAt)} by {selected.actor}
              {selected.jobKind && ` (${selected.jobKind} job)`}
            </span>
          </div>
          {selected.note && <p className="text-sm text-muted-foreground">{selected.note}</p>}
          {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
          {actionData?.message && (
            <p className="text-sm text-muted-foreground">{actionData.message}</p>
          )}
          <Form method="post" className="flex flex-wrap gap-2">
            <input type="hidden" name="changesetId" value={selected.id} />
            <input type="hidden" name="seq" value={selected.seq} />
            {selected.jobId && <input type="hidden" name="jobId" value={selected.jobId} />}
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="intent"
              value="revert"
              disabled={busy}
            >
              Revert this change
            </Button>
            {selected.jobId && (
              <Button
                type="submit"
                size="sm"
                variant="outline"
                name="intent"
                value="revert-job"
                disabled={busy}
              >
                Revert the whole job
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              name="intent"
              value="restore"
              disabled={busy}
            >
              Restore library to this point
            </Button>
          </Form>
          <div className="flex flex-col gap-2">
            {diff.map((row) => (
              <div
                key={`${row.table}-${row.rowId}-${row.version}`}
                className="rounded-md border p-2 text-sm"
              >
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline">{row.op}</Badge>
                  <span>{row.table.replaceAll("_", " ")}</span>
                  <span className="font-mono">{row.displayId ?? row.rowId}</span>
                  <span className="text-muted-foreground">v{row.version}</span>
                </div>
                <table className="mt-1 w-full text-xs">
                  <tbody>
                    {row.changes.map((c) => (
                      <tr key={c.field} className="align-top">
                        <td className="w-32 pr-2 text-muted-foreground">{c.field}</td>
                        <td className="pr-2 text-destructive line-through">{show(c.before)}</td>
                        <td>{show(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
