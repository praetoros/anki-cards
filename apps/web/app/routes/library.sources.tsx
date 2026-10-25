import { listSources, registerSource, sourceCoverage, startSynthesis } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@anki-cards/ui/components/table";
import { useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import { ConfirmSubmit } from "~/components/confirm-submit";
import { useActionToast } from "~/lib/action-toast";
import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.sources";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const coverage = await sourceCoverage(db, params.libraryId);
  return {
    sources: await listSources(db, params.libraryId),
    coverage: Object.fromEntries(
      coverage.map((c) => [c.id, { units: c.units, covered: c.covered }]),
    ),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db, paths } = await rt();
    if (formString(form, "intent") === "synthesise") {
      await startSynthesis(db, params.libraryId, [formString(form, "sourceId")], { again: true });
      return { ok: true, message: "Synthesis job queued." };
    }
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return { error: "Choose at least one file." };
    for (const file of files) {
      await registerSource(
        db,
        paths,
        {
          libraryId: params.libraryId,
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        { actor: "user", action: "upload_source", libraryId: params.libraryId },
      );
    }
    return {
      ok: true,
      message: `Uploaded ${files.length} file(s). Extraction runs in the background.`,
    };
  });
}

const STATUS: Record<string, "secondary" | "outline" | "destructive" | "default"> = {
  extracted: "secondary",
  pending: "outline",
  extracting: "default",
  failed: "destructive",
};

const ACCEPT = ".pdf,.pptx,.docx,.md,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.mp3,.m4a,.wav";

/** A large drop area; dropping or choosing files uploads them straight away. */
function DropZone({ uploading }: { uploading: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = () => {
    if (input.current?.files?.length) form.current?.requestSubmit();
  };
  return (
    <Form ref={form} method="post" encType="multipart/form-data">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!input.current || e.dataTransfer.files.length === 0) return;
          input.current.files = e.dataTransfer.files;
          upload();
        }}
        className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          over ? "border-rose-gold bg-accent/30" : "border-muted-foreground/30 hover:bg-muted/40"
        }`}
      >
        <span className="text-base font-medium">
          {uploading ? "Uploading…" : "Drop lecture files here, or click to choose"}
        </span>
        <span className="text-xs text-muted-foreground">
          PDF, PowerPoint, Word, Markdown, text, images, audio or video
        </span>
        <input
          ref={input}
          type="file"
          name="files"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={upload}
        />
      </label>
    </Form>
  );
}

export default function Sources({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const uploading =
    navigation.state === "submitting" && navigation.formEncType === "multipart/form-data";
  useActionToast(actionData);
  return (
    <main className="flex flex-col gap-4 p-6">
      <DropZone uploading={uploading} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Pages</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Covered</TableHead>
            <TableHead>Limitations</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loaderData.sources.map((s) => {
            const coverage = loaderData.coverage[s.id];
            return (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.displayId}</TableCell>
                <TableCell>
                  <Link to={s.id} className="hover:underline">
                    {s.title}
                  </Link>
                </TableCell>
                <TableCell>{s.fileType}</TableCell>
                <TableCell>{s.pageCount}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[s.extractionStatus] ?? "outline"}>
                    {s.extractionStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {coverage ? `${coverage.covered}/${coverage.units} units` : "—"}
                </TableCell>
                <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">
                  {s.limitations.join("; ")}
                </TableCell>
                <TableCell>
                  {coverage && (
                    <ConfirmSubmit
                      size="xs"
                      variant={coverage.covered > 0 ? "outline" : "default"}
                      disabled={navigation.state !== "idle"}
                      fields={{ intent: "synthesise", sourceId: s.id }}
                      confirm={
                        coverage.covered > 0
                          ? {
                              title: `Synthesise ${s.displayId} again?`,
                              description: `${coverage.covered} of ${coverage.units} units of "${s.title}" are already in the library. The AI will re-read every unit and may change existing knowledge items; the changes can be reverted from History.`,
                              action: "Synthesise again",
                            }
                          : null
                      }
                    >
                      {coverage.covered === 0
                        ? "Synthesise"
                        : coverage.covered < coverage.units
                          ? "Synthesise rest"
                          : "Synthesise again"}
                    </ConfirmSubmit>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {loaderData.sources.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-muted-foreground">
                No sources yet. Upload lecture PDFs, slide decks, documents or images.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </main>
  );
}
