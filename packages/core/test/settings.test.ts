import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DomainError } from "../src/errors.ts";
import { createLibrary } from "../src/libraries.ts";
import { getSetting, providerForStage, resolveSettings, setSetting } from "../src/settings.ts";
import { createTestDb, type TestDb } from "./helpers.ts";

describe("settings", () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => {
    t.close();
  });

  it("resolves library over global over default", async () => {
    const lib = await createLibrary(t.db, { name: "Anatomy" });
    expect(await getSetting(t.db, "enrichment.mode", lib.id)).toBe("text");
    await setSetting(t.db, "enrichment.mode", "none", null);
    expect(await getSetting(t.db, "enrichment.mode", lib.id)).toBe("none");
    await setSetting(t.db, "enrichment.mode", "text+images", lib.id);
    expect(await getSetting(t.db, "enrichment.mode", lib.id)).toBe("text+images");
    expect(await getSetting(t.db, "enrichment.mode", null)).toBe("none");

    const resolved = await resolveSettings(t.db, lib.id);
    expect(resolved.find((r) => r.key === "enrichment.mode")?.source).toBe("library");

    await setSetting(t.db, "enrichment.mode", undefined, lib.id);
    expect(await getSetting(t.db, "enrichment.mode", lib.id)).toBe("none");
  });

  it("validates values and scope", async () => {
    const lib = await createLibrary(t.db, { name: "Anatomy" });
    await expect(setSetting(t.db, "enrichment.mode", "everything", null)).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(setSetting(t.db, "paths.backupFolder", "C:/x", lib.id)).rejects.toThrow(
      "only be set globally",
    );
    await expect(setSetting(t.db, "nope", 1, null)).rejects.toThrow("Unknown setting");
  });

  it("falls back to the default provider for unset stages", async () => {
    await setSetting(
      t.db,
      "providers.default",
      { provider: "codex", model: "gpt-5", effort: "medium" },
      null,
    );
    await setSetting(
      t.db,
      "providers.generation",
      { provider: "claude", model: null, effort: null },
      null,
    );
    expect((await providerForStage(t.db, "synthesis", null)).provider).toBe("codex");
    expect((await providerForStage(t.db, "generation", null)).provider).toBe("claude");
  });
});
