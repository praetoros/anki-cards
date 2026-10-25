import {
  change,
  conceptDetail,
  createFeedbackItem,
  libraryOutline,
  resolveRow,
  scheduleAutoFeedback,
  topicOf,
  upsertKnowledgeItem,
} from "@anki-cards/core";
// Values used in the component must come from a browser-safe entry, not the server package.
import { PRIORITIES, type Priority } from "@anki-cards/core/enums";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Input } from "@anki-cards/ui/components/input";
import { Textarea } from "@anki-cards/ui/components/textarea";
import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";

import { ImagePreview } from "~/components/image-preview";
import { MediaText } from "~/components/media-ref";
import { useActionToast } from "~/lib/action-toast";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.knowledge";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const outline = await libraryOutline(db, params.libraryId);
  const conceptParam = new URL(request.url).searchParams.get("concept");
  const first = outline[0]?.subtopics[0]?.concepts[0]?.id;
  const conceptId = conceptParam ?? first ?? null;
  const detail = conceptId ? await conceptDetail(db, params.libraryId, conceptId) : null;
  return { outline, detail };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const lib = params.libraryId;
    const intent = formString(form, "intent");
    const targetTable = formString(form, "table") as "concepts" | "knowledge_items";
    const targetId = formString(form, "id");
    if (intent === "feedback") {
      const row = await resolveRow(db, targetTable, lib, targetId);
      const topicId = await topicOf(
        db,
        targetTable === "concepts" ? { conceptId: row.id } : { knowledgeItemId: row.id },
      );
      await createFeedbackItem(db, lib, {
        target: { table: targetTable, id: row.id },
        title: `Feedback on ${row.displayId}`,
        message: formString(form, "message"),
        topicId,
      });
      await scheduleAutoFeedback(db, lib);
      return { ok: true, message: "Feedback recorded; it waits for the AI." };
    }
    if (intent === "edit-ki") {
      const ki = await resolveRow(db, "knowledge_items", lib, targetId);
      await upsertKnowledgeItem(
        db,
        { ctx: { actor: "user", action: "edit_knowledge_item", libraryId: lib } },
        {
          id: ki.id,
          expectedVersion: Number(formString(form, "version")),
          conceptId: ki.conceptId,
          statement: formString(form, "statement"),
          types: ki.types,
          priority: formString(form, "priority") as Priority,
          origin: ki.origin,
          interpretationStatus: ki.interpretationStatus,
        },
      );
      return { ok: true, message: "Saved." };
    }
    if (intent === "toggle-exclude") {
      const row = await resolveRow(db, targetTable, lib, targetId);
      await change(db, { actor: "user", action: "toggle_exclude", libraryId: lib }, (c) =>
        c.update(targetTable, row.id, { excluded: !row.excluded }),
      );
      return { ok: true };
    }
    return { error: "Unknown action" };
  });
}

const STATUS_VARIANT = {
  supported: "outline",
  tentative: "default",
  unresolved: "destructive",
} as const;

function FeedbackForm({ table, id }: { table: string; id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Feedback
      </Button>
    );
  }
  return (
    <Form method="post" className="flex w-full flex-col gap-1" onSubmit={() => setOpen(false)}>
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <Textarea name="message" rows={2} placeholder="What should change?" required />
      <div className="flex gap-1">
        <Button type="submit" size="xs" name="intent" value="feedback">
          Send
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}

export default function Knowledge({ loaderData, actionData }: Route.ComponentProps) {
  const { outline, detail } = loaderData;
  const [params] = useSearchParams();
  useActionToast(actionData);
  const [editing, setEditing] = useState<string | null>(null);
  if (outline.length === 0) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        No knowledge yet. Upload sources and run synthesis from the overview.
      </main>
    );
  }
  return (
    <main className="grid gap-4 p-4 lg:grid-cols-[minmax(0,300px)_1fr]">
      <nav className="flex flex-col gap-2 text-sm">
        {outline.map((t) => (
          <div key={t.id}>
            <div className="font-semibold">
              <span className="font-mono text-xs text-muted-foreground">{t.displayId}</span>{" "}
              {t.title}
            </div>
            {t.subtopics.map((s) => (
              <div key={s.id} className="ml-3">
                <div className="text-muted-foreground">{s.title}</div>
                {s.concepts.map((c) => (
                  <Link
                    key={c.id}
                    to={`?concept=${c.id}`}
                    className={`ml-3 flex items-center gap-1 rounded px-1 hover:bg-muted ${
                      params.get("concept") === c.id || detail?.concept.id === c.id
                        ? "bg-muted"
                        : ""
                    } ${c.excluded ? "line-through opacity-60" : ""}`}
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {c.knowledgeItemCount}
                    </span>
                    {c.tentative > 0 && <span className="text-xs text-amber-600">?</span>}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ))}
      </nav>
      {detail && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{detail.concept.displayId}</span>
            <h2 className="text-lg font-semibold">{detail.concept.title}</h2>
            <Badge variant={STATUS_VARIANT[detail.concept.interpretationStatus]}>
              {detail.concept.interpretationStatus}
            </Badge>
            {detail.concept.userEdited && <Badge variant="outline">edited by you</Badge>}
            <span className="text-xs text-muted-foreground">in {detail.subtopic.title}</span>
            <Form method="post" className="ml-auto">
              <input type="hidden" name="table" value="concepts" />
              <input type="hidden" name="id" value={detail.concept.id} />
              <Button size="xs" variant="ghost" name="intent" value="toggle-exclude">
                {detail.concept.excluded ? "Include" : "Exclude"}
              </Button>
            </Form>
            <FeedbackForm table="concepts" id={detail.concept.id} />
          </div>
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            <MediaText text={detail.concept.explanation} />
          </div>
          {detail.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...new Map(detail.media.map((m) => [m.media.id, m.media])).values()].map(
                (media) => {
                  const links = detail.media
                    .filter((m) => m.media.id === media.id)
                    .map((m) => m.link);
                  return (
                    <figure key={media.id} className="flex max-w-xs flex-col gap-1 text-xs">
                      <ImagePreview
                        src={`/media/${media.id}`}
                        alt={media.description}
                        title={`${media.displayId} · ${media.description}`}
                        imgClassName="max-h-48 rounded border object-contain"
                      />
                      <figcaption className="text-muted-foreground">
                        {media.displayId} ·{" "}
                        {[...new Set(links.map((l) => l.role.replace("_", " ")))].join(", ")}
                        {links
                          .map((l) => l.component)
                          .filter(Boolean)
                          .map((c) => ` · ${c}`)
                          .join("")}
                      </figcaption>
                    </figure>
                  );
                },
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {detail.knowledgeItems.map((ki) => {
              const evidence = detail.evidence.filter((e) => e.knowledgeItemId === ki.id);
              return (
                <div
                  key={ki.id}
                  id={ki.displayId}
                  className={`flex flex-col gap-1 rounded-md border p-2 ${ki.excluded ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">{ki.displayId}</span>
                    <Badge variant={ki.priority === "P1" ? "default" : "outline"}>
                      {ki.priority}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[ki.interpretationStatus]}>
                      {ki.interpretationStatus}
                    </Badge>
                    {ki.origin === "external" && <Badge variant="secondary">external</Badge>}
                    <span className="text-muted-foreground">{ki.types.join(", ")}</span>
                    <span className="ml-auto flex gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setEditing(ki.id)}>
                        Edit
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="table" value="knowledge_items" />
                        <input type="hidden" name="id" value={ki.id} />
                        <Button size="xs" variant="ghost" name="intent" value="toggle-exclude">
                          {ki.excluded ? "Include" : "Exclude"}
                        </Button>
                      </Form>
                      <FeedbackForm table="knowledge_items" id={ki.id} />
                    </span>
                  </div>
                  {editing === ki.id ? (
                    <Form
                      method="post"
                      className="flex flex-col gap-1"
                      onSubmit={() => setEditing(null)}
                    >
                      <input type="hidden" name="id" value={ki.id} />
                      <input type="hidden" name="version" value={ki.version} />
                      <Input name="statement" defaultValue={ki.statement} />
                      <div className="flex gap-1">
                        <select
                          name="priority"
                          defaultValue={ki.priority}
                          className="rounded border px-1 text-sm"
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                        <Button type="submit" size="xs" name="intent" value="edit-ki">
                          Save
                        </Button>
                      </div>
                    </Form>
                  ) : (
                    <p className="text-sm">
                      <MediaText text={ki.statement} />
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {evidence.map((e) =>
                      e.kind === "external" && e.external ? (
                        <a
                          key={e.id}
                          href={e.external.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {e.external.publisher}: {e.external.title}
                        </a>
                      ) : (
                        <Link
                          key={e.id}
                          to={`../sources/${e.unit?.sourceId ?? ""}#${e.unit?.displayId ?? ""}`}
                          relative="path"
                          className="underline"
                        >
                          {e.unit?.displayId ?? "source"}
                        </Link>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {detail.objectives.length > 0 && (
            <div className="text-sm">
              <h3 className="font-semibold">Learning objectives</h3>
              <ul className="list-disc pl-5">
                {detail.objectives.map(({ mapping, objective }) => (
                  <li key={mapping.id}>
                    {objective.text}{" "}
                    <span className="text-xs text-muted-foreground">
                      (source {mapping.sourceCoverage}, library {mapping.libraryCoverage})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
