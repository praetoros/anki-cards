import { describe, expect, it } from "vite-plus/test";
import { generateLectureDocx } from "../../../tests/fixtures/lecture-docx.ts";
import { extractSource } from "../src/index.ts";

describe("DOCX extraction without LibreOffice", async () => {
  const result = await extractSource("handout.docx", generateLectureDocx());
  const sections = result.units.filter((u) => u.unitType === "text");

  it("splits paragraphs into sections at headings and keeps the headings", () => {
    expect(result.fileType).toBe("docx");
    expect(sections.map((s) => s.location.label)).toEqual([
      "The Cardiac Cycle",
      "Systole",
      "Diastole",
    ]);
    expect(sections[0]?.text).toBe(
      "# The Cardiac Cycle\nOne heartbeat consists of systole followed by diastole.",
    );
    expect(sections[2]?.text).toContain("## Diastole");
    expect(sections[2]?.text).toContain("Phase\tDuration\nSystole\t0.3 s");
  });

  it("attaches word/media images to the section that draws them", () => {
    expect(result.images.map((i) => [i.key, i.mime, i.width, i.height, i.provenance.path])).toEqual(
      [["media1", "image/png", 96, 72, "word/media/image1.png"]],
    );
    expect(sections[1]?.imageKeys).toEqual(["media1"]);
    expect(result.units.filter((u) => u.unitType === "figure").map((u) => u.imageKeys)).toEqual([
      ["media1"],
    ]);
  });

  it("records that layout and renders need LibreOffice", () => {
    expect(result.limitations[0]).toMatch(/LibreOffice not installed/);
  });
});
