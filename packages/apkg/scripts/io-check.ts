// Writes a deck with one Image Occlusion note and one Basic note, to import into Anki desktop.
// Usage: vpx packages/apkg/scripts/io-check.ts <out.apkg>

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApkg } from "../src/index.ts";
import { ioCheckInput } from "./io-check-deck.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: vpx packages/apkg/scripts/io-check.ts <out.apkg>");
  process.exit(1);
}

const path = resolve(target);
writeFileSync(path, buildApkg(ioCheckInput()));
console.log(`Wrote ${path}
Import it into Anki desktop (23.10 or later), then check that:
  1. The "Anki Cards IO check" deck has 3 cards: 2 Image Occlusion and 1 Basic.
  2. Image Occlusion card 1 hides "CPU" and card 2 hides "RAM"; the other label is masked too.
  3. "Toggle Masks" on the back works, and Back Extra and the source line show.
  4. In the browser, Edit on the IO note opens the Image Occlusion editor with both masks.`);
