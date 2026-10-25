import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateLectureDocx } from "./lecture-docx.ts";
import { generateLecturePdf } from "./lecture-pdf.ts";
import { generateLecturePptx } from "./lecture-pptx.ts";

const outDir = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const files = {
  "lecture.pdf": generateLecturePdf(),
  "lecture.pptx": generateLecturePptx(),
  "lecture.docx": generateLectureDocx(),
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(`${outDir}${name}`, bytes);
  console.log(`wrote ${name} (${bytes.length} bytes)`);
}
