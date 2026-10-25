// Ports of the HTML helpers in Anki's rslib/src/text.rs, reduced to what notes and templates need.

const HTML =
  /<!--[\s\S]*?-->|<style[^>]*>[\s\S]*?<\/style>|<script[^>]*>[\s\S]*?<\/script>|<[^>]*>/gi;
const MEDIA_TAG =
  /<\b(?:img|audio|video|object|source)\b(?:[^>]|"[^"]+?"|'[^']+?')+?\b(?:src|data)\b=(?:"([^"]+?)"[^>]*>|'([^']+?)'[^>]*>|([^ >]+?)(?: [^>]*>|\/>|>))/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(HTML, ""));
}

/** Tags removed, entities kept: safe to insert back into HTML (used by the `text:` filter). */
export function stripHtmlPreservingEntities(html: string): string {
  return html.replace(HTML, "");
}

/** What Anki stores in `sfld` and hashes into `csum`. */
export function stripHtmlPreservingMediaFilenames(html: string): string {
  const withNames = html.replace(
    MEDIA_TAG,
    (_match, dq?: string, sq?: string, bare?: string) => ` ${dq ?? sq ?? bare ?? ""} `,
  );
  return stripHtml(withNames);
}

/** Anki treats a field holding only whitespace, `<br>` or empty `<div>`s as empty. */
export function fieldIsEmpty(html: string): boolean {
  return /^(?:\s|&nbsp;|<\/?(?:br|div)\s*\/?>)*$/i.test(html);
}

export function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
