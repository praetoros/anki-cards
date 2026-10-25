import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tApproval,
  tReviewItem,
  tSession,
  tTrustedSource,
  type TConceptS,
} from "./db/schema/index.ts";
import { nextDisplayId } from "./display-ids.ts";
import { DomainError } from "./errors.ts";
import { change, type Changes } from "./history.ts";
import { enqueueJob } from "./jobs.ts";
import type { AppPaths } from "./paths.ts";
import { resolveRow } from "./resolve.ts";
import { assertApproved, raiseReviewItem } from "./review.ts";
import { DEFAULT_TRUSTED_SOURCES, getSetting } from "./settings.ts";
import { ensureSession } from "./workflow-actions.ts";

export async function listTrustedSources(db: TDb, libraryId: string | null) {
  return db
    .select()
    .from(tTrustedSource)
    .where(
      libraryId
        ? or(isNull(tTrustedSource.libraryId), eq(tTrustedSource.libraryId, libraryId))
        : isNull(tTrustedSource.libraryId),
    );
}

/** Seeds the global list with the medical defaults the first time it is read. */
export async function ensureDefaultTrustedSources(db: TDatabase) {
  const existing = await listTrustedSources(db, null);
  if (existing.length > 0) return;
  await change(
    db,
    { actor: "system", action: "seed_trusted_sources", libraryId: null },
    async (c) => {
      for (const domain of DEFAULT_TRUSTED_SOURCES) {
        await c.insert("trusted_sources", { domain, note: "default" }, null);
      }
    },
  );
}

export async function addTrustedSource(
  db: TDatabase,
  libraryId: string | null,
  domain: string,
  note = "",
) {
  const clean = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!clean.includes("."))
    throw new DomainError("invalid", "Enter a domain such as radiopaedia.org.");
  const { result } = await change(
    db,
    { actor: "user", action: "add_trusted_source", libraryId },
    (c) => c.insert("trusted_sources", { domain: clean, note }, libraryId),
  );
  return result;
}

export async function removeTrustedSource(db: TDatabase, id: string) {
  const [row] = await db.select().from(tTrustedSource).where(eq(tTrustedSource.id, id));
  if (!row) return;
  await change(
    db,
    { actor: "user", action: "remove_trusted_source", libraryId: row.libraryId },
    (c) => c.remove("trusted_sources", id),
  );
}

export async function isTrustedUrl(db: TDb, libraryId: string, url: string): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const list = await listTrustedSources(db, libraryId);
  return list.some((t) => host === t.domain || host.endsWith(`.${t.domain}`));
}

export async function assertEnrichmentAllowed(db: TDb, libraryId: string, images = false) {
  const mode = await getSetting(db, "enrichment.mode", libraryId);
  if (mode === "none")
    throw new DomainError("forbidden", "Enrichment is turned off for this library.");
  if (images && mode !== "text+images") {
    throw new DomainError(
      "forbidden",
      "External images are turned off (enrichment mode is text only).",
    );
  }
}

/**
 * Checks an external citation for an already-written knowledge item: flags it as trusted or,
 * when the trusted list is in use and the source is not on it, raises a review item.
 */
export async function checkExternalSource(
  c: Changes,
  libraryId: string,
  knowledgeItemId: string,
  url: string,
): Promise<boolean> {
  const trusted = await isTrustedUrl(c.tx, libraryId, url);
  const enforce = await getSetting(c.tx, "enrichment.trustedSourcesEnabled", libraryId);
  if (!trusted && enforce) {
    await raiseReviewItem(c, {
      libraryId,
      kind: "untrusted_source",
      title: `Source not on the trusted list: ${new URL(url).hostname}`,
      description: `A knowledge item cites ${url}. Approve to keep it; reject to exclude the item.`,
      payload: { url },
      targets: [{ table: "knowledge_items", id: knowledgeItemId }],
      raisedBy: "system",
    });
  }
  return trusted;
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/** Downloads an external image and raises a visual proposal for the user to approve. */
export async function proposeExternalMedia(
  db: TDatabase,
  paths: AppPaths,
  ctx: { libraryId: string; jobId?: string | null; sessionId?: string | null },
  input: {
    imageUrl: string;
    pageUrl: string;
    creator: string;
    licence: string;
    attribution: string;
    purpose: string;
    conceptIds: string[];
  },
) {
  await assertEnrichmentAllowed(db, ctx.libraryId, true);
  const concepts: TConceptS[] = [];
  for (const id of input.conceptIds)
    concepts.push(await resolveRow(db, "concepts", ctx.libraryId, id));
  for (const c of concepts) {
    await assertApproved(
      db,
      ctx.libraryId,
      "visual_search",
      { conceptId: c.id },
      "Searching for external images",
    );
  }
  const response = await fetch(input.imageUrl, { signal: AbortSignal.timeout(30_000) });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!response.ok || !IMAGE_EXT[mime]) {
    throw new DomainError(
      "invalid",
      `Could not download an image from ${input.imageUrl} (${response.status} ${mime}).`,
    );
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > 10_000_000)
    throw new DomainError("invalid", "The image is larger than 10 MB.");
  const sha = createHash("sha256").update(data).digest("hex");
  const storagePath = join(paths.media, `${sha}${IMAGE_EXT[mime]}`);
  if (!existsSync(storagePath)) await writeFile(storagePath, data);
  const { result } = await change(
    db,
    { actor: "ai", action: "propose_external_media", ...ctx },
    async (c) => {
      const media = await c.insert("media_assets", {
        displayId: await nextDisplayId(c.tx, ctx.libraryId, "media_assets"),
        sha256: sha,
        storagePath,
        mime,
        width: null,
        height: null,
        origin: "external",
        sourceId: null,
        provenance: {
          kind: "external",
          externalUrl: input.imageUrl,
          pageUrl: input.pageUrl,
          creator: input.creator,
          licence: input.licence,
          attribution: input.attribution,
        },
        relevance: "uncertain",
        description: input.purpose,
      });
      return raiseReviewItem(c, {
        libraryId: ctx.libraryId,
        kind: "visual_proposal",
        title: `Add external image to ${concepts.map((x) => x.displayId).join(", ")}`,
        description: `${input.purpose}\n\nCreator: ${input.creator}\nLicence: ${input.licence}\nAttribution: ${input.attribution}\nPage: ${input.pageUrl}`,
        payload: {
          mediaId: media.id,
          conceptIds: concepts.map((x) => x.id),
          imageUrl: input.imageUrl,
          pageUrl: input.pageUrl,
          licence: input.licence,
          attribution: input.attribution,
          purpose: input.purpose,
        },
        targets: concepts.map((x) => ({ table: "concepts" as const, id: x.id })),
        raisedBy: "ai",
      });
    },
  );
  return result;
}

/** Approved enrichment requests that still wait for research. */
export async function pendingEnrichment(db: TDb, libraryId: string) {
  const approvals = await db
    .select()
    .from(tApproval)
    .where(
      and(
        eq(tApproval.libraryId, libraryId),
        eq(tApproval.status, "active"),
        inArray(tApproval.kind, ["text_enrichment", "visual_search"]),
      ),
    );
  const itemIds = [...new Set(approvals.map((a) => a.reviewItemId))];
  if (itemIds.length === 0) return [];
  return db
    .select()
    .from(tReviewItem)
    .where(and(inArray(tReviewItem.id, itemIds), eq(tReviewItem.status, "awaiting_ai")));
}

export async function startEnrichment(db: TDatabase, libraryId: string) {
  await assertEnrichmentAllowed(db, libraryId);
  const items = await pendingEnrichment(db, libraryId);
  if (items.length === 0)
    throw new DomainError("invalid", "No approved enrichment is waiting for research.");
  const mode = await getSetting(db, "enrichment.mode", libraryId);
  const trusted = (await listTrustedSources(db, libraryId)).map((t) => t.domain);
  const sessions = await db.select().from(tSession).where(eq(tSession.libraryId, libraryId));
  const session =
    sessions.find(
      (s) =>
        s.status !== "archived" &&
        s.kind === "topic" &&
        items.every((i) => i.topicId && s.scope.topicIds.includes(i.topicId)),
    ) ??
    (await ensureSession(db, {
      libraryId,
      kind: "ingest",
      scope: { kind: "library", topicIds: [] },
      title: "Ingest",
      jobKind: "enrichment",
    }));
  return enqueueJob(db, {
    sessionId: session.id,
    kind: "enrichment",
    trigger: "button",
    reviewItemIds: items.map((i) => i.id),
    prompt: [
      "Research the approved enrichment requests below, following the enrichment instructions.",
      ...items.map((i) => `- ${i.displayId} ${i.title}`),
      "",
      `Enrichment mode: ${mode}. ${mode === "text+images" ? "You may propose external images where an approval includes visual search." : "Do not propose images."}`,
      `Trusted sources (prefer these): ${trusted.join(", ") || "none listed"}.`,
      "Reply on each review item when done, then call complete_job.",
    ].join("\n"),
  });
}
