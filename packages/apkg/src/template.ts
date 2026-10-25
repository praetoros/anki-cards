// The subset of Anki's template language our note types use: {{Field}}, {{#Field}}…{{/Field}},
// {{^Field}}…{{/Field}}, {{FrontSide}}, and the `cloze:` and `text:` filters.

import { revealCloze, type ImageOcclusionRenderer } from "./cloze.ts";
import { fieldIsEmpty, stripHtmlPreservingEntities } from "./html.ts";

export type TemplateNode =
  | { kind: "text"; text: string }
  | { kind: "field"; name: string; filters: string[] }
  | { kind: "section"; name: string; negated: boolean; children: TemplateNode[] };

export function parseTemplate(template: string): TemplateNode[] {
  const root: TemplateNode[] = [];
  const stack: { name: string; children: TemplateNode[] }[] = [{ name: "", children: root }];
  const current = (): TemplateNode[] => stack[stack.length - 1]?.children ?? root;
  let last = 0;
  for (const match of template.matchAll(/\{\{([^{}]*)\}\}/g)) {
    if (match.index > last)
      current().push({ kind: "text", text: template.slice(last, match.index) });
    last = match.index + match[0].length;
    const tag = (match[1] ?? "").trim();
    const marker = tag[0];
    if (marker === "#" || marker === "^") {
      const section: TemplateNode = {
        kind: "section",
        name: tag.slice(1).trim(),
        negated: marker === "^",
        children: [],
      };
      current().push(section);
      stack.push({ name: section.name, children: section.children });
    } else if (marker === "/") {
      const name = tag.slice(1).trim();
      if (stack.length < 2 || stack[stack.length - 1]?.name !== name) {
        throw new Error(`Template closes {{/${name}}} without a matching opening tag`);
      }
      stack.pop();
    } else {
      const parts = tag.split(":");
      current().push({ kind: "field", name: parts.at(-1) ?? "", filters: parts.slice(0, -1) });
    }
  }
  if (stack.length > 1)
    throw new Error(`Template is missing {{/${stack[stack.length - 1]?.name}}}`);
  if (last < template.length) root.push({ kind: "text", text: template.slice(last) });
  return root;
}

export interface RenderContext {
  fields: ReadonlyMap<string, string>;
  /** Rendered question; undefined while rendering the question itself. */
  frontSide: string | undefined;
  /** Card ord (0-based). */
  cardOrd: number;
  imageOcclusion?: ImageOcclusionRenderer;
}

function fieldValue(name: string, context: RenderContext): string {
  if (name === "FrontSide") return context.frontSide ?? "";
  const value = context.fields.get(name);
  if (value === undefined) throw new Error(`Template refers to unknown field "${name}"`);
  return value;
}

function applyFilter(filter: string, text: string, context: RenderContext): string {
  switch (filter) {
    case "cloze":
      return revealCloze(
        text,
        context.cardOrd + 1,
        context.frontSide === undefined,
        context.imageOcclusion,
      );
    case "text":
      return stripHtmlPreservingEntities(text);
    default:
      throw new Error(`Unsupported template filter "${filter}"`);
  }
}

export function renderNodes(nodes: readonly TemplateNode[], context: RenderContext): string {
  let html = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      html += node.text;
    } else if (node.kind === "field") {
      html += node.filters.reduceRight(
        (text, filter) => applyFilter(filter, text, context),
        fieldValue(node.name, context),
      );
    } else if (fieldIsEmpty(fieldValue(node.name, context)) === node.negated) {
      html += renderNodes(node.children, context);
    }
  }
  return html;
}
