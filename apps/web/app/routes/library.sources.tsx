import { listSources, registerSource } from "@anki-cards/core";
import { Badge } from "@anki-cards/ui/components/badge";
import { Button } from "@anki-cards/ui/components/button";
import { Input } from "@anki-cards/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@anki-cards/ui/components/table";
import { Form, Link, useNavigation } from "react-router";

import { handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.sources";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { sources: await listSources(db, params.libraryId) };
}

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db, paths } = await rt();
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

export default function Sources({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return (
    <main className="flex flex-col gap-4 p-6">
      <Form
        method="post"
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2"
      >
        <Input
          type="file"
          name="files"
          multiple
          accept=".pdf,.pptx,.docx,.md,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.mp3,.m4a,.wav"
          className="max-w-md"
        />
        <Button type="submit" disabled={navigation.state !== "idle"}>
          {navigation.state === "submitting" ? "Uploading…" : "Upload"}
        </Button>
        {actionData?.error && <span className="text-sm text-destructive">{actionData.error}</span>}
        {actionData?.message && (
          <span className="text-sm text-muted-foreground">{actionData.message}</span>
        )}
      </Form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Pages</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Limitations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loaderData.sources.map((s) => (
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
              <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">
                {s.limitations.join("; ")}
              </TableCell>
            </TableRow>
          ))}
          {loaderData.sources.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                No sources yet. Upload lecture PDFs, slide decks, documents or images.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </main>
  );
}
