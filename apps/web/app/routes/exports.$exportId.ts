import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { tExport } from "@anki-cards/core";
import { eq } from "drizzle-orm";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/exports.$exportId";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const [row] = await db.select().from(tExport).where(eq(tExport.id, params.exportId));
  if (!row) throw new Response("Not found", { status: 404 });
  return new Response(await readFile(row.filePath), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${basename(row.filePath)}"`,
    },
  });
}
