import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { generateLecturePdf } from "../../../tests/fixtures/lecture-pdf.ts";
import { tMediaAsset } from "../src/db/schema/index.ts";
import { createLibrary } from "../src/libraries.ts";
import { resolvePaths } from "../src/paths.ts";
import { assertReadablePath, listSources, registerSource, sourceUnits } from "../src/sources.ts";
import { setSetting } from "../src/settings.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

const user = { actor: "user" as const, action: "upload_source", libraryId: null };

describe("sources", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.close();
  });

  it("stores, extracts and dedupes a PDF", async () => {
    const paths = resolvePaths(join(t.dir, "data"));
    const lib = await createLibrary(t.db, { name: "Cardio" });
    const bytes = generateLecturePdf();
    const source = await registerSource(
      t.db,
      paths,
      { libraryId: lib.id, fileName: "lecture.pdf", bytes, wait: true },
      user,
    );
    expect(source.displayId).toBe("SRC-001");

    const [stored] = await listSources(t.db, lib.id);
    expect(stored?.extractionStatus).toBe("extracted");
    const units = await sourceUnits(t.db, source.id);
    expect(units.filter((u) => u.unitType === "page").length).toBe(stored?.pageCount);
    expect(units[0]?.renderMediaId).toBeTruthy();
    expect(units.some((u) => u.textBlocks.length > 0)).toBe(true);
    const media = await t.db.select().from(tMediaAsset);
    expect(media.some((m) => m.provenance.kind === "embedded")).toBe(true);

    const again = await registerSource(
      t.db,
      paths,
      { libraryId: lib.id, fileName: "copy.pdf", bytes },
      user,
    );
    expect(again.id).toBe(source.id);
  });

  it("only reads paths inside the readable folders", async () => {
    await setSetting(t.db, "paths.readableRoots", [t.dir], null);
    await expect(assertReadablePath(t.db, join(t.dir, "x.pdf"))).resolves.toContain("x.pdf");
    await expect(assertReadablePath(t.db, "C:/Windows/system.ini")).rejects.toThrow(
      "outside the folders",
    );
  });
});
