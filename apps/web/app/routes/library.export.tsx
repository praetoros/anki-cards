import { exportLibrary, libraryProgress, listExports } from "@anki-cards/core";
import { Button, buttonVariants } from "@anki-cards/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@anki-cards/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@anki-cards/ui/components/table";
import { Check, Download } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";

import { useActionToast } from "~/lib/action-toast";
import { formatDateTime } from "~/lib/format";
import { handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/library.export";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const progress = await libraryProgress(db, params.libraryId);
  return {
    exports: await listExports(db, params.libraryId),
    topics: progress.topics.map((t) => ({
      id: t.id,
      title: t.title,
      cards: t.cards,
      approved: t.setApprovedAt !== null,
    })),
  };
}

export async function action({ params }: Route.ActionArgs) {
  return handle(async () => {
    const { db, paths } = await rt();
    const row = await exportLibrary(db, paths, params.libraryId);
    return {
      ok: true,
      message: `Exported ${row.counts.total} cards${row.copiedTo ? ` and copied to ${row.copiedTo}` : ""}.`,
    };
  });
}

export default function Export({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  useActionToast(actionData);
  const { topics, exports } = loaderData;
  const included = topics.filter((t) => t.approved);
  const latest = exports[0];
  return (
    <main className="flex flex-col gap-4 p-6">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Export to Anki</CardTitle>
          <CardDescription>
            One .apkg with every topic&apos;s latest approved card set. Importing it again later
            updates the notes already in Anki instead of duplicating them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1">
            {topics.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {t.approved ? (
                  <Check className="size-4 text-highlight" />
                ) : (
                  <span className="size-4" />
                )}
                <span className={t.approved ? "" : "text-muted-foreground"}>{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.approved ? `${t.cards} cards` : "not included: approve its card set first"}
                </span>
                {!t.approved && (
                  <Link
                    to={`../cards?topic=${t.id}`}
                    relative="path"
                    className="text-xs text-highlight underline"
                  >
                    Open cards
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Form method="post">
            <Button type="submit" disabled={busy || included.length === 0}>
              {busy ? "Exporting…" : "Export .apkg"}
            </Button>
          </Form>
        </CardContent>
      </Card>

      {latest && (
        <Card size="sm" className="border-highlight/40">
          <CardHeader>
            <CardTitle>Latest export</CardTitle>
            <CardDescription>
              {formatDateTime(latest.createdAt)}: {latest.counts.total} cards ({latest.counts.added}{" "}
              new, {latest.counts.changed} changed
              {latest.counts.retired > 0 && `, ${latest.counts.retired} retired`}).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <a href={`/exports/${latest.id}`} download className={`${buttonVariants()} self-start`}>
              <Download className="size-4" /> Download .apkg
            </a>
            <p className="text-xs text-muted-foreground">
              In Anki, choose File → Import and pick the file. Retired cards arrive tagged{" "}
              <code>removed</code> so you can find and delete them.
            </p>
          </CardContent>
        </Card>
      )}

      {exports.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Earlier exports</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>New</TableHead>
                <TableHead>Changed</TableHead>
                <TableHead>Unchanged</TableHead>
                <TableHead>Retired</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exports.slice(1).map((e) => (
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
        </section>
      )}
    </main>
  );
}
