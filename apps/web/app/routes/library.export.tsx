import { exportLibrary, listExports } from "@anki-cards/core";
import { Button } from "@anki-cards/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@anki-cards/ui/components/table";
import { Form, useNavigation } from "react-router";

import { formatDateTime } from "~/lib/format";
import { handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.export";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  return { exports: await listExports(db, params.libraryId) };
}

export async function action({ params }: Route.ActionArgs) {
  return handle(async () => {
    const { db, paths } = await rt();
    const row = await exportLibrary(db, paths, params.libraryId);
    return {
      ok: true,
      message: `Exported ${row.counts.total} card(s)${row.copiedTo ? ` and copied to ${row.copiedTo}` : ""}.`,
    };
  });
}

export default function Export({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <main className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Exports every topic&apos;s latest approved card set as one .apkg. Re-importing updates
          existing notes in Anki (stable ids). Retired cards are sent once more tagged{" "}
          <code>removed</code> so you can delete them in Anki.
        </p>
        <Form method="post">
          <Button type="submit" disabled={busy}>
            {busy ? "Exporting…" : "Export .apkg"}
          </Button>
        </Form>
        {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
        {actionData?.message && <p className="text-sm">{actionData.message}</p>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Added</TableHead>
            <TableHead>Changed</TableHead>
            <TableHead>Unchanged</TableHead>
            <TableHead>Retired</TableHead>
            <TableHead>File</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loaderData.exports.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{formatDateTime(e.createdAt)}</TableCell>
              <TableCell>{e.counts.added}</TableCell>
              <TableCell>{e.counts.changed}</TableCell>
              <TableCell>{e.counts.unchanged}</TableCell>
              <TableCell>{e.counts.retired}</TableCell>
              <TableCell>
                <a href={`/exports/${e.id}`} className="underline" download>
                  Download
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </main>
  );
}
