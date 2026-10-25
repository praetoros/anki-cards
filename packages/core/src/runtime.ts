import { existsSync, readdirSync } from "node:fs";

import { recordBackup, writeBackup } from "./backup.ts";
import { createDb, migrationsFolder, runMigrations, type TDatabase } from "./db/client.ts";
import { resolvePaths, type AppPaths } from "./paths.ts";

export interface Runtime {
  db: TDatabase;
  paths: AppPaths;
  port: number;
}

function pendingMigrations(db: TDatabase): number {
  const total = readdirSync(migrationsFolder, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  ).length;
  try {
    const row = db.$client.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as
      | { n: number }
      | undefined;
    return total - (row?.n ?? 0);
  } catch {
    return total;
  }
}

/** Opens the database, backing it up first when migrations are about to change it. */
export async function openAppDatabase(paths: AppPaths): Promise<TDatabase> {
  const existed = existsSync(paths.db);
  const db = createDb(paths.db);
  const backupPath =
    existed && pendingMigrations(db) > 0
      ? await writeBackup(db.$client, paths, paths.backups)
      : null;
  runMigrations(db);
  if (backupPath) await recordBackup(db, backupPath, "before migration");
  return db;
}

const key = Symbol.for("anki-cards.runtime");
const store = globalThis as unknown as Record<symbol, Promise<Runtime> | undefined>;

type RuntimeHook = (runtime: Runtime) => Promise<void> | void;
const hooksKey = Symbol.for("anki-cards.runtime-hooks");
const hookStore = globalThis as unknown as Record<symbol, RuntimeHook[] | undefined>;
const hooks = (hookStore[hooksKey] ??= []);

/** Registers work to run once when the runtime starts (job runner, provider checks). */
export function onRuntimeStart(hook: RuntimeHook) {
  hooks.push(hook);
}

/** The process-wide runtime, created on first use and shared across dev-server reloads. */
export function getRuntime(): Promise<Runtime> {
  store[key] ??= (async () => {
    const paths = resolvePaths();
    const db = await openAppDatabase(paths);
    const runtime: Runtime = { db, paths, port: Number(process.env.ANKI_CARDS_PORT ?? 4317) };
    for (const hook of hooks) await hook(runtime);
    return runtime;
  })();
  return store[key];
}
