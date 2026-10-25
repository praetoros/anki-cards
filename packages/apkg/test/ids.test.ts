import { expect, test } from "vite-plus/test";

import { guidFor, stableNumericId } from "../src/ids.ts";

test("guidFor is deterministic and uses Anki's base91 alphabet", () => {
  expect(guidFor("card-1")).toBe(guidFor("card-1"));
  expect(guidFor("card-1")).not.toBe(guidFor("card-2"));
  expect(guidFor("card-1")).toMatch(/^[a-zA-Z0-9!#$%&()*+,\-./:;<=>?@[\]^_`{|}~]{1,10}$/);
});

test("stableNumericId gives distinct safe integers above 1", () => {
  const ids = ["deck:A", "deck:B", "note-type:basic", ""].map(stableNumericId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(Number.isSafeInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(1);
  }
  expect(stableNumericId("deck:A")).toBe(stableNumericId("deck:A"));
});
