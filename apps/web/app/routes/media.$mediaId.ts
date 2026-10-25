import { readFile } from "node:fs/promises";

import { resolveMedia } from "@anki-cards/core";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/media.$mediaId";

export async function loader({ params }: Route.LoaderArgs) {
  const { db } = await rt();
  const media = await resolveMedia(db, null, params.mediaId);
  const data = await readFile(media.storagePath);
  return new Response(data, {
    headers: {
      "Content-Type": media.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
