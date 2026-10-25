import { describe, expect, it } from "vite-plus/test";
import { extractSource } from "../src/index.ts";

const encode = (text: string) => new TextEncoder().encode(text);

describe("Markdown and text extraction", () => {
  it("splits Markdown into one text unit per heading section", async () => {
    const markdown = [
      "Intro before any heading.",
      "",
      "# Cardiac cycle",
      "One beat.",
      "",
      "```md",
      "# not a heading",
      "```",
      "",
      "## Systole ##",
      "Contraction.",
      "![trace](trace.png)",
    ].join("\r\n");
    const result = await extractSource("notes.md", encode(markdown));
    expect(result.fileType).toBe("markdown");
    expect(result.pageCount).toBe(1);
    expect(result.units.map((u) => [u.unitType, u.location.label])).toEqual([
      ["text", undefined],
      ["text", "Cardiac cycle"],
      ["text", "Systole"],
    ]);
    expect(result.units[1]?.text).toBe("# Cardiac cycle\nOne beat.\n\n```md\n# not a heading\n```");
    expect(result.limitations).toEqual(["images referenced by the Markdown are not loaded"]);
  });

  it("returns plain text as a single unit, stripping a UTF-8 BOM", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("Line one\r\nLine two\n")]);
    const result = await extractSource("notes.txt", bytes);
    expect(result.fileType).toBe("text");
    expect(result.units).toEqual([
      { unitType: "text", location: {}, text: "Line one\nLine two", textBlocks: [], imageKeys: [] },
    ]);
  });
});
