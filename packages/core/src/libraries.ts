import { asc, eq } from "drizzle-orm";

import type { TDatabase, TDb } from "./db/client.ts";
import { tLibrary } from "./db/schema/index.ts";
import { DomainError } from "./errors.ts";
import { change, newId } from "./history.ts";

export async function listLibraries(db: TDb) {
  return db.select().from(tLibrary).orderBy(asc(tLibrary.name));
}

export async function getLibrary(db: TDb, id: string) {
  const [lib] = await db.select().from(tLibrary).where(eq(tLibrary.id, id)).limit(1);
  if (!lib) throw new DomainError("not_found", `Library ${id} not found.`);
  return lib;
}

export async function createLibrary(db: TDatabase, input: { name: string; description?: string }) {
  const name = input.name.trim();
  if (!name) throw new DomainError("invalid", "A library needs a name.");
  const id = newId("libraries");
  const { result } = await change(
    db,
    { actor: "user", action: "create_library", libraryId: id },
    (c) => c.insert("libraries", { id, name, description: input.description?.trim() ?? "" }, id),
  );
  return result;
}

export async function updateLibrary(
  db: TDatabase,
  id: string,
  patch: { name?: string; description?: string },
  expectedVersion?: number,
) {
  const { result } = await change(
    db,
    { actor: "user", action: "update_library", libraryId: id },
    (c) => c.update("libraries", id, patch, expectedVersion),
  );
  return result;
}
