import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import { repoRoot } from "../paths.ts";
import { relations } from "./relations.ts";

export const migrationsFolder = join(repoRoot, "packages", "core", "drizzle");

export function createDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const client = new DatabaseSync(path);
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return drizzle({ client, relations });
}

export type TDatabase = ReturnType<typeof createDb>;
/**
 * drizzle's node:sqlite driver only allows synchronous transaction callbacks, so async
 * transactions run as BEGIN/COMMIT on the single connection under the write lock
 * (see lock.ts). Inside one, queries go through the same `TDatabase`.
 */
export type TTransaction = TDatabase;
export type TDb = TDatabase;

export async function inTransaction<T>(
  db: TDatabase,
  fn: (tx: TTransaction) => Promise<T>,
): Promise<T> {
  db.$client.exec("BEGIN IMMEDIATE");
  try {
    const result = await fn(db);
    db.$client.exec("COMMIT");
    return result;
  } catch (error) {
    db.$client.exec("ROLLBACK");
    throw error;
  }
}

export function runMigrations(db: TDatabase) {
  const result = migrate(db, { migrationsFolder });
  if (result) {
    throw new Error(`Database migration failed: ${JSON.stringify(result)}`);
  }
}
