import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { backup as sqliteBackup, type DatabaseSync } from "node:sqlite";

import { desc } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { ulid } from "./db/helpers.ts";
import { tBackup } from "./db/schema/index.ts";
import type { AppPaths } from "./paths.ts";
import { getSetting } from "./settings.ts";

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Copies the database consistently, plus the sources, media and exports folders, into `root`. */
export async function writeBackup(client: DatabaseSync, paths: AppPaths, root: string) {
  const target = join(root, `anki-cards-${stamp()}`);
  await mkdir(target, { recursive: true });
  await sqliteBackup(client, join(target, "anki-cards.db"));
  for (const dir of ["sources", "media", "exports"] as const) {
    if (existsSync(paths[dir])) await cp(paths[dir], join(target, dir), { recursive: true });
  }
  return target;
}

export async function recordBackup(db: TDb, path: string, reason: string) {
  const [row] = await db
    .insert(tBackup)
    .values({ id: ulid("bak"), path, reason })
    .returning();
  return row;
}

export async function backupNow(db: TDatabase, paths: AppPaths, reason: string) {
  const root = (await getSetting(db, "paths.backupFolder")) ?? paths.backups;
  const target = await writeBackup(db.$client, paths, root);
  return recordBackup(db, target, reason);
}

export async function listBackups(db: TDb) {
  return db.select().from(tBackup).orderBy(desc(tBackup.createdAt));
}
