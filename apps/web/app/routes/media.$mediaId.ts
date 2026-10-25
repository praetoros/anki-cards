import { readFile } from "node:fs/promises";

import { DomainError, resolveMedia } from "@anki-cards/core";

import { rt } from "~/lib/runtime.server";
import type { Route } from "./+types/media.$mediaId";

/** Serves a media file by id, or by display id (`MED-003`) with `?library=`. */
export async function loader({ params, request }: Route.LoaderArgs) {
  const { db } = await rt();
  const library = new URL(request.url).searchParams.get("library");
  try {
    const media = await resolveMedia(db, library, params.mediaId);
    const data = await readFile(media.storagePath);
    return new Response(data, {
      headers: {
        "Content-Type": media.mime,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) throw new Response("Not found", { status: 404 });
    throw error;
  }
}
