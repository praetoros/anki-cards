// The same checks run against anki-apkg-export@5.0.0 (the oracle) and our writer.

import { describe, expect, test } from "vite-plus/test";

import { checkPackage, guidsOf } from "./support/checks.ts";
import { parseApkg } from "./support/parse.ts";
import { basicScenario, scenarios } from "./support/scenarios.ts";
import { writers } from "./support/writers.ts";

describe.each(writers)("$name", (writer) => {
  test.each(scenarios)("$name", async ({ input, expectedOrds }) => {
    checkPackage(parseApkg(await writer.build(input)), input, expectedOrds);
  });

  test("GUIDs are stable across builds and survive field edits", async () => {
    const input = basicScenario.input;
    const first = guidsOf(parseApkg(await writer.build(input)), input);
    const again = guidsOf(parseApkg(await writer.build(input)), input);
    expect(again).toEqual(first);
    expect(new Set(first).size).toBe(first.length);

    const edited = {
      ...input,
      notes: input.notes.map((note) => ({
        ...note,
        fields: note.fields.map((field, index) => (index === 1 ? `${field} (edited)` : field)),
      })),
    };
    expect(guidsOf(parseApkg(await writer.build(edited)), edited)).toEqual(first);
  });
});
