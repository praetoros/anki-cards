import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import {
  buildApkg,
  stableNumericId,
  type DeckDef,
  type MediaDef,
  type NoteDef,
} from "@anki-cards/apkg";
import { desc, eq } from "drizzle-orm";

import { cardPlacement, mediaFiles, NOTE_TYPE_FOR, noteFields } from "./cards.ts";
import type { TDatabase, TDb } from "./db/client.ts";
import { ulid } from "./db/helpers.ts";
import { tExport, tTopic, type ExportCounts, type TCardS } from "./db/schema/index.ts";
import { DomainError } from "./errors.ts";
import { rowsAt } from "./history.ts";
import { getLibrary } from "./libraries.ts";
import type { AppPaths } from "./paths.ts";
import { getSetting } from "./settings.ts";
import { latestSnapshot } from "./snapshots.ts";

const hash = (value: string) => createHash("sha1").update(value).digest("hex");

function deckName(template: string, parts: { library: string; topic: string; subtopic: string }) {
  const clean = (s: string) => s.replaceAll("::", " ").trim();
  return template
    .replaceAll("{library}", clean(parts.library))
    .replaceAll("{topic}", clean(parts.topic))
    .replaceAll("{subtopic}", clean(parts.subtopic))
    .split("::")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("::");
}

const tagSafe = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w:-]/g, "");

/**
 * Builds the whole deck from each topic's latest approved card set. Cards retired since are
 * exported once more with a `removed` tag and a notice.
 */
export async function exportLibrary(db: TDatabase, paths: AppPaths, libraryId: string) {
  const library = await getLibrary(db, libraryId);
  const template = await getSetting(db, "export.deckMapping", libraryId);
  const topics = await db.select().from(tTopic).where(eq(tTopic.libraryId, libraryId));
  const [previous] = await db
    .select()
    .from(tExport)
    .where(eq(tExport.libraryId, libraryId))
    .orderBy(desc(tExport.createdAt))
    .limit(1);
  const before = previous?.cardGuids ?? {};

  const decks = new Map<string, DeckDef>();
  const notes: NoteDef[] = [];
  const media = new Map<string, MediaDef>();
  const guids: Record<string, string> = {};
  const counts: ExportCounts = { added: 0, changed: 0, retired: 0, unchanged: 0, total: 0 };
  let lastSnapshot: string | null = null;

  for (const topic of topics) {
    const snapshot = await latestSnapshot(db, libraryId, "card_set", topic.id);
    if (!snapshot) continue;
    lastSnapshot = snapshot.id;
    const cards = (await rowsAt(db, libraryId, snapshot.changesetSeq, "cards")).filter(
      (c) => c.topicId === topic.id && (c.status === "approved" || c.status === "retired"),
    ) as TCardS[];
    for (const card of cards) {
      const files = await mediaFiles(db, card.mediaIds);
      const names = new Map<string, string>();
      for (const f of files) {
        const name = `ac-${f.sha256.slice(0, 16)}${extname(f.storagePath) || ".png"}`;
        names.set(f.id, name);
        if (!media.has(name))
          media.set(name, { name, data: new Uint8Array(await readFile(f.storagePath)) });
      }
      const retired = card.status === "retired";
      const fields = await noteFields(
        db,
        card,
        (id) => names.get(id) ?? "",
        retired ? "This card was retired from the library. Delete it in Anki." : "",
      );
      const place = await cardPlacement(db, card);
      const name = deckName(template, {
        library: library.name,
        topic: place?.topic ?? topic.title,
        subtopic: place?.subtopic ?? "",
      });
      let deck = decks.get(name);
      if (!deck) {
        deck = { id: stableNumericId(`deck:${libraryId}:${name}`), name };
        decks.set(name, deck);
      }
      const tags = [
        `library::${tagSafe(library.name)}`,
        `${tagSafe(place?.topic ?? topic.title)}::${tagSafe(place?.subtopic ?? "general")}`,
        ...card.tags.map(tagSafe),
      ];
      if (retired) tags.push("removed");
      notes.push({
        guid: card.guid,
        noteTypeId: NOTE_TYPE_FOR[card.cardType].id,
        deckId: deck.id,
        fields,
        tags,
      });
      const digest = hash(JSON.stringify([fields, tags]));
      guids[card.guid] = digest;
      counts.total++;
      if (retired) counts.retired++;
      else if (!(card.guid in before)) counts.added++;
      else if (before[card.guid] !== digest) counts.changed++;
      else counts.unchanged++;
    }
  }
  if (notes.length === 0) {
    throw new DomainError(
      "gate_blocked",
      "No approved card set yet. Approve a topic's cards first.",
    );
  }

  const usedTypes = [...new Set(notes.map((n) => n.noteTypeId))];
  const apkg = buildApkg({
    noteTypes: Object.values(NOTE_TYPE_FOR).filter((t) => usedTypes.includes(t.id)),
    decks: [...decks.values()],
    notes,
    media: [...media.values()],
  });
  const safe = library.name.replace(/[^\w.-]+/g, "-");
  const file = join(
    paths.exports,
    `${safe}-${new Date().toISOString().replace(/[:.]/g, "-")}.apkg`,
  );
  await mkdir(paths.exports, { recursive: true });
  await writeFile(file, apkg);
  const folder = await getSetting(db, "paths.exportFolder");
  let copiedTo: string | null = null;
  if (folder) {
    await mkdir(folder, { recursive: true });
    copiedTo = join(folder, basename(file));
    await copyFile(file, copiedTo);
  }
  const [row] = await db
    .insert(tExport)
    .values({
      id: ulid("exp"),
      libraryId,
      snapshotId: lastSnapshot,
      filePath: file,
      copiedTo,
      counts,
      cardGuids: guids,
    })
    .returning();
  return row!;
}

export async function listExports(db: TDb, libraryId: string) {
  return db
    .select()
    .from(tExport)
    .where(eq(tExport.libraryId, libraryId))
    .orderBy(desc(tExport.createdAt));
}
