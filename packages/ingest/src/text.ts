import type { ExtractedUnit, ExtractionResult } from "./types.ts";

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  // The UTF-8 decoder strips a BOM by default.
  return new TextDecoder("utf-8").decode(bytes);
}

function textUnit(text: string, label?: string): ExtractedUnit {
  return {
    unitType: "text",
    location: label ? { label } : {},
    text,
    textBlocks: [],
    imageKeys: [],
  };
}

/** Splits Markdown into sections at ATX headings, ignoring headings inside fenced code. */
export function markdownSections(markdown: string): { heading?: string; text: string }[] {
  const sections: { heading?: string; lines: string[] }[] = [{ lines: [] }];
  let fence: string | undefined;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    const heading = fence ? undefined : /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (heading) sections.push({ heading: heading[1] ?? "", lines: [] });
    sections[sections.length - 1]?.lines.push(line);
  }
  return sections
    .map((s) => ({
      ...(s.heading !== undefined ? { heading: s.heading } : {}),
      text: s.lines.join("\n").trim(),
    }))
    .filter((s) => s.text !== "");
}

export function extractMarkdown(bytes: Uint8Array): ExtractionResult {
  const markdown = decodeText(bytes);
  const sections = markdownSections(markdown);
  return {
    fileType: "markdown",
    pageCount: 1,
    units: sections.map((s) => textUnit(s.text, s.heading)),
    images: [],
    limitations: /!\[[^\]]*\]\(/.test(markdown)
      ? ["images referenced by the Markdown are not loaded"]
      : [],
  };
}

export function extractText(bytes: Uint8Array): ExtractionResult {
  return {
    fileType: "text",
    pageCount: 1,
    units: [textUnit(decodeText(bytes).replace(/\r\n?/g, "\n").trim())],
    images: [],
    limitations: [],
  };
}
