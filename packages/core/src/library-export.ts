import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { zipSync } from "fflate";

import type { TDatabase } from "./db/client.ts";
import { trackedTables, type TrackedTableName } from "./db/schema/index.ts";
import { latestChangesetSeq, libraryStateAt } from "./history.ts";
import { getLibrary } from "./libraries.ts";
import type { AppPaths } from "./paths.ts";
import { getSetting } from "./settings.ts";

/**
 * Writes one library as a zip: every tracked table's current rows as JSON, plus the source
 * files and media it references, to the backup folder.
 */
export async function exportLibraryArchive(db: TDatabase, paths: AppPaths, libraryId: string) {
  const library = await getLibrary(db, libraryId);
  const state = await libraryStateAt(db, libraryId, await latestChangesetSeq(db));
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  const manifest: Record<string, number> = {};
  for (const table of Object.keys(trackedTables) as TrackedTableName[]) {
    const rows = [...(state.get(table)?.values() ?? [])];
    manifest[table] = rows.length;
    files[`tables/${table}.json`] = encoder.encode(JSON.stringify(rows, null, 2));
    for (const row of rows) {
      const path = row["storagePath"];
      if (typeof path === "string" && existsSync(path)) {
        const folder = table === "sources" ? "sources" : "media";
        const name =
          table === "sources" ? `${String(row["sha256"])}-${basename(path)}` : basename(path);
        files[`${folder}/${name}`] = new Uint8Array(await readFile(path));
      }
    }
  }
  files["manifest.json"] = encoder.encode(
    JSON.stringify(
      { library: library.name, libraryId, exportedAt: new Date().toISOString(), tables: manifest },
      null,
      2,
    ),
  );
  const root = (await getSetting(db, "paths.backupFolder")) ?? paths.backups;
  await mkdir(root, { recursive: true });
  const safe = library.name.replace(/[^\w.-]+/g, "-");
  const target = join(
    root,
    `library-${safe}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
  );
  await writeFile(target, zipSync(files, { level: 6 }));
  return target;
}
