import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, runMigrations, type TDatabase } from "../src/db/client.ts";

export interface TestDb {
  db: TDatabase;
  dir: string;
  close: () => void;
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "anki-cards-test-"));
  const db = createDb(join(dir, "test.db"));
  runMigrations(db);
  return {
    db,
    dir,
    close: () => {
      db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
