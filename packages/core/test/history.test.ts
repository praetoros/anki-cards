import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { tLibrary } from "../src/db/schema/index.ts";
import {
  change,
  changesetDiff,
  latestChangesetSeq,
  restoreLibraryTo,
  revertChangesets,
  RevertConflictError,
  rowsAt,
  StaleVersionError,
} from "../src/history.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const user = { actor: "user" as const, action: "test" };

describe("history", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.close();
  });

  async function createLibrary(name: string) {
    const { result } = await change(t.db, { ...user, libraryId: null }, async (c) => {
      const id = "lib_test";
      return c.insert("libraries", { id, name }, id);
    });
    return result;
  }

  it("records every version and its changeset", async () => {
    const lib = await createLibrary("Cardiology");
    expect(lib.version).toBe(1);
    const { result: updated, changesetId } = await change(
      t.db,
      { ...user, libraryId: lib.id },
      (c) => c.update("libraries", lib.id, { name: "Cardio" }, 1),
    );
    expect(updated.version).toBe(2);
    const diff = await changesetDiff(t.db, changesetId as string);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.before?.["name"]).toBe("Cardiology");
    expect(diff[0]?.after?.["name"]).toBe("Cardio");
  });

  it("rejects a stale expected version", async () => {
    const lib = await createLibrary("A");
    await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.update("libraries", lib.id, { name: "B" }),
    );
    await expect(
      change(t.db, { ...user, libraryId: lib.id }, (c) =>
        c.update("libraries", lib.id, { name: "C" }, 1),
      ),
    ).rejects.toBeInstanceOf(StaleVersionError);
  });

  it("rolls back the whole changeset when a write fails", async () => {
    const lib = await createLibrary("A");
    await expect(
      change(t.db, { ...user, libraryId: lib.id }, async (c) => {
        await c.update("libraries", lib.id, { name: "B" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const [row] = await t.db.select().from(tLibrary);
    expect(row?.name).toBe("A");
  });

  it("discards changesets with no writes", async () => {
    const lib = await createLibrary("A");
    const { changesetId } = await change(t.db, { ...user, libraryId: lib.id }, async () => 1);
    expect(changesetId).toBeNull();
  });

  it("reverts a changeset and refuses when a row changed since", async () => {
    const lib = await createLibrary("A");
    const { changesetId: renameId } = await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.update("libraries", lib.id, { name: "B" }),
    );
    await revertChangesets(t.db, [renameId as string], { ...user, libraryId: lib.id });
    const [reverted] = await t.db.select().from(tLibrary);
    expect(reverted?.name).toBe("A");
    expect(reverted?.version).toBe(3);

    const { changesetId: second } = await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.update("libraries", lib.id, { name: "C" }),
    );
    await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.update("libraries", lib.id, { name: "D" }),
    );
    await expect(
      revertChangesets(t.db, [second as string], { ...user, libraryId: lib.id }),
    ).rejects.toBeInstanceOf(RevertConflictError);
  });

  it("reverting an insert deletes the row", async () => {
    const lib = await createLibrary("A");
    const { changesetId } = await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.insert("topics", { displayId: "TOP-1", title: "Heart" }),
    );
    await revertChangesets(t.db, [changesetId as string], { ...user, libraryId: lib.id });
    const topics = await t.db.query.tTopic.findMany();
    expect(topics).toHaveLength(0);
  });

  it("reads and restores a point in time", async () => {
    const lib = await createLibrary("A");
    await change(t.db, { ...user, libraryId: lib.id }, (c) =>
      c.insert("topics", { id: "top_1", displayId: "TOP-1", title: "Heart" }),
    );
    const seq = await latestChangesetSeq(t.db);
    await change(t.db, { ...user, libraryId: lib.id }, async (c) => {
      await c.update("topics", "top_1", { title: "Heart and vessels" });
      await c.insert("topics", { id: "top_2", displayId: "TOP-2", title: "Lungs" });
    });

    const past = await rowsAt(t.db, lib.id, seq, "topics");
    expect(past.map((r) => r.title)).toEqual(["Heart"]);

    await restoreLibraryTo(t.db, lib.id, seq, { ...user, libraryId: lib.id });
    const now = await t.db.query.tTopic.findMany();
    expect(now.map((r) => r.title)).toEqual(["Heart"]);
  });
});
