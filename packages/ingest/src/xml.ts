import { XMLParser } from "fast-xml-parser";

/** An XML element with its children in document order. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content. */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

type RawNode = Record<string, unknown>;

function isRecord(value: unknown): value is RawNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toElement(name: string, raw: RawNode): XmlElement {
  const attrs: Record<string, string> = {};
  const rawAttrs = raw[":@"];
  if (isRecord(rawAttrs)) {
    for (const [key, value] of Object.entries(rawAttrs)) attrs[key] = String(value);
  }
  const element: XmlElement = { name, attrs, children: [], text: "" };
  const content = raw[name];
  if (Array.isArray(content)) {
    for (const child of content) {
      if (!isRecord(child)) continue;
      if ("#text" in child) {
        element.text += String(child["#text"]);
        continue;
      }
      const childName = Object.keys(child).find((key) => key !== ":@");
      if (childName) element.children.push(toElement(childName, child));
    }
  }
  return element;
}

/** Parses an XML document and returns its root element. */
export function parseXml(xml: string | Uint8Array): XmlElement {
  const text = typeof xml === "string" ? xml : new TextDecoder().decode(xml);
  const nodes: unknown = parser.parse(text);
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const name = Object.keys(node).find((key) => key !== ":@" && key !== "#text");
      if (name) return toElement(name, node);
    }
  }
  throw new Error("XML document has no root element");
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

export function children(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** Follows a path of child names, e.g. `path(sp, "p:spPr", "a:xfrm")`. */
export function path(el: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let current = el;
  for (const name of names) current = child(current, name);
  return current;
}

export function descendants(el: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement) => {
    for (const c of node.children) {
      if (c.name === name) found.push(c);
      visit(c);
    }
  };
  visit(el);
  return found;
}

export function numAttr(el: XmlElement | undefined, name: string): number | undefined {
  const value = el?.attrs[name];
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
