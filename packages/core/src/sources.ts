import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";

import {
  detectFileType,
  detectTools,
  extractSource,
  type DetectedTools,
  type ExtractionResult,
} from "@anki-cards/ingest";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import {
  tCoverageEntry,
  tMediaAsset,
  tSource,
  tSourceUnit,
  type TMediaAssetS,
  type TSourceS,
} from "./db/schema/index.ts";
import { nextDisplayId } from "./display-ids.ts";
import { DomainError } from "./errors.ts";
import { emitNotice } from "./events.ts";
import { change, type ChangeContext, type Changes } from "./history.ts";
import type { AppPaths } from "./paths.ts";
import { getSetting } from "./settings.ts";

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jp2": ".jp2",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

let toolsCache: { at: number; tools: DetectedTools } | null = null;

export async function externalTools(): Promise<DetectedTools> {
  if (toolsCache && Date.now() - toolsCache.at < 300_000) return toolsCache.tools;
  const tools = await detectTools();
  toolsCache = { at: Date.now(), tools };
  return tools;
}

/** Throws unless `path` is inside one of the configured readable folders. */
export async function assertReadablePath(db: TDb, path: string) {
  const roots = await getSetting(db, "paths.readableRoots");
  const full = resolve(path);
  const ok = roots.some((root) => {
    const r = resolve(root);
    return (
      full === r || full.toLowerCase().startsWith((r.endsWith(sep) ? r : r + sep).toLowerCase())
    );
  });
  if (!ok) {
    throw new DomainError(
      "forbidden",
      `${full} is outside the folders workers may read (${roots.join(", ")}). Add its folder to "Folders workers may read" in Settings.`,
    );
  }
  return full;
}

/** Stores the original file and records the source. Extraction runs in the background unless `wait`. */
export async function registerSource(
  db: TDatabase,
  paths: AppPaths,
  input: { libraryId: string; fileName: string; bytes: Uint8Array; title?: string; wait?: boolean },
  ctx: ChangeContext,
): Promise<TSourceS> {
  const fileName = basename(input.fileName);
  const fileType = detectFileType(fileName, input.bytes);
  if (!fileType) throw new DomainError("invalid", `Unsupported file type: ${fileName}`);
  const hash = sha256(input.bytes);
  const [existing] = await db
    .select()
    .from(tSource)
    .where(and(eq(tSource.libraryId, input.libraryId), eq(tSource.sha256, hash)));
  if (existing) return existing;

  const dir = join(paths.sources, hash);
  await mkdir(dir, { recursive: true });
  const storagePath = join(dir, fileName);
  if (!existsSync(storagePath)) await writeFile(storagePath, input.bytes);

  const { result } = await change(db, { ...ctx, libraryId: input.libraryId }, async (c) =>
    c.insert("sources", {
      displayId: await nextDisplayId(c.tx, input.libraryId, "sources"),
      title: input.title?.trim() || fileName.replace(/\.[^.]+$/, ""),
      fileName,
      fileType,
      sha256: hash,
      storagePath,
      pageCount: 0,
      extractionStatus: "pending",
      limitations: [],
    }),
  );
  if (input.wait) {
    await extractStoredSource(db, paths, result.id);
    return await resolveSource(db, input.libraryId, result.id);
  }
  void extractStoredSource(db, paths, result.id).catch((error: unknown) => {
    emitNotice({
      level: "error",
      title: `Extraction failed: ${fileName}`,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return result;
}

export async function registerSourceFromPath(
  db: TDatabase,
  paths: AppPaths,
  input: { libraryId: string; path: string; title?: string },
  ctx: ChangeContext,
) {
  const full = await assertReadablePath(db, input.path);
  if (!existsSync(full)) throw new DomainError("not_found", `No file at ${full}.`);
  const bytes = new Uint8Array(await readFile(full));
  return registerSource(
    db,
    paths,
    { libraryId: input.libraryId, fileName: basename(full), bytes, title: input.title, wait: true },
    ctx,
  );
}

async function storeMedia(
  c: Changes,
  paths: AppPaths,
  libraryId: string,
  sourceId: string,
  image: ExtractionResult["images"][number],
  known: Map<string, TMediaAssetS>,
): Promise<TMediaAssetS> {
  const existing = known.get(image.sha256);
  if (existing) return existing;
  const ext = MIME_EXT[image.mime] ?? extname(String(image.provenance["path"] ?? "")) ?? ".bin";
  const storagePath = join(paths.media, `${image.sha256}${ext}`);
  if (!existsSync(storagePath)) await writeFile(storagePath, image.data);
  const row = await c.insert("media_assets", {
    displayId: await nextDisplayId(c.tx, libraryId, "media_assets"),
    sha256: image.sha256,
    storagePath,
    mime: image.mime,
    width: image.width,
    height: image.height,
    origin: "source",
    sourceId,
    provenance: {
      kind: image.kind,
      bbox: image.bbox,
      renderDpi: typeof image.provenance["dpi"] === "number" ? image.provenance["dpi"] : undefined,
      detail: { ...image.provenance, ...image.location },
    },
    relevance: image.kind === "render" ? "supporting" : "uncertain",
  });
  known.set(image.sha256, row);
  return row;
}

/** Runs extraction for a stored source and writes its units and media as one changeset. */
export async function extractStoredSource(db: TDatabase, paths: AppPaths, sourceId: string) {
  const [source] = await db.select().from(tSource).where(eq(tSource.id, sourceId));
  if (!source) throw new DomainError("not_found", `Source ${sourceId} not found.`);
  const ctx: ChangeContext = {
    actor: "system",
    action: "extract_source",
    libraryId: source.libraryId,
  };
  await change(db, ctx, (c) => c.update("sources", source.id, { extractionStatus: "extracting" }));

  let result: ExtractionResult;
  try {
    const tools = await externalTools();
    const bytes = new Uint8Array(await readFile(source.storagePath));
    result = await extractSource(source.fileName, bytes, {
      libreOfficePath: tools.libreOffice?.path ?? null,
      ffmpegPath: tools.ffmpeg?.path ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await change(db, ctx, (c) =>
      c.update("sources", source.id, { extractionStatus: "failed", limitations: [message] }),
    );
    throw error;
  }

  await change(db, ctx, async (c) => {
    const previous = await c.tx
      .select()
      .from(tSourceUnit)
      .where(eq(tSourceUnit.sourceId, source.id));
    for (const unit of previous) await c.remove("source_units", unit.id);
    const known = new Map<string, TMediaAssetS>();
    const libraryMedia = await c.tx
      .select()
      .from(tMediaAsset)
      .where(eq(tMediaAsset.libraryId, source.libraryId));
    for (const m of libraryMedia) known.set(m.sha256, m);
    const byKey = new Map(result.images.map((i) => [i.key, i]));
    let ordinal = 0;
    for (const unit of result.units) {
      const mediaIds: string[] = [];
      let renderMediaId: string | null = null;
      for (const key of unit.imageKeys) {
        const image = byKey.get(key);
        if (!image) continue;
        const media = await storeMedia(c, paths, source.libraryId, source.id, image, known);
        if (image.kind === "render" && !renderMediaId) renderMediaId = media.id;
        else mediaIds.push(media.id);
      }
      await c.insert("source_units", {
        displayId: await nextDisplayId(c.tx, source.libraryId, "source_units"),
        sourceId: source.id,
        ordinal: ordinal++,
        unitType: unit.unitType,
        location: unit.location,
        text: unit.text,
        textBlocks: unit.textBlocks,
        renderMediaId,
        mediaIds,
        width: unit.size ? Math.round(unit.size.width) : null,
        height: unit.size ? Math.round(unit.size.height) : null,
      });
    }
    await c.update("sources", source.id, {
      extractionStatus: "extracted",
      pageCount: result.pageCount,
      limitations: result.limitations,
    });
  });
  emitNotice({
    level: "info",
    title: `Extracted ${source.fileName}`,
    message: `${result.units.length} units, ${result.images.length} images${result.limitations.length ? `, ${result.limitations.length} limitation(s)` : ""}.`,
  });
}

export async function listSources(db: TDb, libraryId: string) {
  return db
    .select()
    .from(tSource)
    .where(eq(tSource.libraryId, libraryId))
    .orderBy(asc(tSource.displayId));
}

export async function resolveSource(db: TDb, libraryId: string, idOrDisplay: string) {
  const [row] = await db
    .select()
    .from(tSource)
    .where(
      and(
        eq(tSource.libraryId, libraryId),
        idOrDisplay.includes("_")
          ? eq(tSource.id, idOrDisplay)
          : eq(tSource.displayId, idOrDisplay),
      ),
    );
  if (!row) throw new DomainError("not_found", `Source ${idOrDisplay} not found.`);
  return row;
}

export async function sourceUnits(db: TDb, sourceId: string) {
  return db
    .select()
    .from(tSourceUnit)
    .where(eq(tSourceUnit.sourceId, sourceId))
    .orderBy(asc(tSourceUnit.ordinal));
}

export async function resolveSourceUnit(db: TDb, libraryId: string, idOrDisplay: string) {
  const [row] = await db
    .select()
    .from(tSourceUnit)
    .where(
      and(
        eq(tSourceUnit.libraryId, libraryId),
        idOrDisplay.includes("_")
          ? eq(tSourceUnit.id, idOrDisplay)
          : eq(tSourceUnit.displayId, idOrDisplay),
      ),
    );
  if (!row) throw new DomainError("not_found", `Source unit ${idOrDisplay} not found.`);
  return row;
}

export async function resolveMedia(db: TDb, libraryId: string | null, idOrDisplay: string) {
  const conditions = [
    idOrDisplay.includes("_")
      ? eq(tMediaAsset.id, idOrDisplay)
      : eq(tMediaAsset.displayId, idOrDisplay),
  ];
  if (libraryId) conditions.push(eq(tMediaAsset.libraryId, libraryId));
  const [row] = await db
    .select()
    .from(tMediaAsset)
    .where(and(...conditions));
  if (!row) throw new DomainError("not_found", `Media ${idOrDisplay} not found.`);
  return row;
}

export async function mediaByIds(db: TDb, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(tMediaAsset).where(inArray(tMediaAsset.id, ids));
}

export async function coverageForSource(db: TDb, sourceId: string) {
  return db
    .select({ entry: tCoverageEntry, unit: tSourceUnit })
    .from(tCoverageEntry)
    .innerJoin(tSourceUnit, eq(tCoverageEntry.sourceUnitId, tSourceUnit.id))
    .where(eq(tSourceUnit.sourceId, sourceId));
}
