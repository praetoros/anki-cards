import {
  archiveSession,
  compactSession,
  editSessionSummary,
  getSession,
  replaceSession,
} from "@anki-cards/core";

import { formString, handle, rt } from "~/lib/runtime.server";
import type { Route } from "./+types/api.sessions.$sessionId";

export async function action({ params, request }: Route.ActionArgs) {
  const form = await request.formData();
  return handle(async () => {
    const { db } = await rt();
    const session = await getSession(db, params.sessionId);
    switch (formString(form, "intent")) {
      case "new":
        await replaceSession(db, session.id, false);
        return { ok: true, message: "Started a new session." };
      case "compact":
        await compactSession(db, session.id);
        return { ok: true, message: "Compaction job queued." };
      case "archive":
        await archiveSession(db, session.id);
        return { ok: true, message: "Archived." };
      case "edit-summary":
        await editSessionSummary(
          db,
          session.libraryId,
          formString(form, "summaryId"),
          formString(form, "body"),
        );
        return { ok: true, message: "Summary saved." };
      default:
        return { error: "Unknown action" };
    }
  });
}
