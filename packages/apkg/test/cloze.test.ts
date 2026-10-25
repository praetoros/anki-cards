// Cases ported from the tests in Anki's rslib/src/cloze.rs.

import { describe, expect, test } from "vite-plus/test";

import { clozeNumbers, parseImageCloze, revealCloze } from "../src/cloze.ts";
import { stripHtml } from "../src/html.ts";

describe("clozeNumbers", () => {
  test.each([
    ["test", []],
    ["{{c2::te}}{{c1::s}}t{{", [1, 2]],
    ["{{c0::te}}s{{c2::t}}s", [2]],
    ["{{c2::te{{c1::s}}}}t{{", [1, 2]],
    ["{{c1,2,3::multi}}", [1, 2, 3]],
    ["öaöaöööaö", []],
  ])("%s", (text, numbers) => {
    expect([...clozeNumbers(text)].sort((a, b) => a - b)).toEqual(numbers);
  });
});

describe("revealCloze", () => {
  test.each([
    ["foo {{c1::bar {{c2::baz}}}}", 1, true, "foo [...]"],
    ["foo {{c1::bar {{c2::baz}}}}", 1, false, "foo bar baz"],
    ["foo {{c1::bar {{c2::baz}}::qux}}", 2, true, "foo bar [...]"],
    ["foo {{c1::bar {{c2::baz}}::qux}}", 2, false, "foo bar baz"],
    ["foo {{c1::bar {{c2::baz}}::qux}}", 1, true, "foo [qux]"],
    ["foo {{c1::bar {{c2::baz}}::qux}}", 1, false, "foo bar baz"],
  ])("%s (cloze %i, question %s) reads %s", (text, ordinal, question, plain) => {
    expect(stripHtml(revealCloze(text, ordinal, question))).toBe(plain);
  });

  test("renders Anki's span markup", () => {
    expect(revealCloze("foo {{c1::bar {{c2::baz}}}}", 1, false)).toBe(
      'foo <span class="cloze" data-ordinal="1">bar <span class="cloze-inactive" data-ordinal="2">baz</span></span>',
    );
    expect(revealCloze("foo {{c1::bar {{c2::baz}}::qux}}", 2, true)).toBe(
      'foo <span class="cloze-inactive" data-ordinal="1">bar <span class="cloze" data-cloze="baz" data-ordinal="2">[...]</span></span>',
    );
  });

  test("returns nothing when the text has no cloze with that number", () => {
    expect(revealCloze("{{c1::a}}", 2, true)).toBe("");
  });

  test("renders image occlusions as data divs", () => {
    expect(
      revealCloze("{{c1::image-occlusion:rect:left=10.0:top=20:width=30:height=10}}", 1, true),
    ).toBe(
      '<div class="cloze" data-ordinal="1" data-shape="rect" data-left="10.0" data-top="20" data-width="30" data-height="10" ></div>',
    );
  });
});

test("parseImageCloze unescapes values", () => {
  expect(parseImageCloze(String.raw`text:left=10:top=20:text=\:l\\ol\::width=30`)).toEqual({
    shape: "text",
    properties: [
      { name: "left", value: "10" },
      { name: "top", value: "20" },
      { name: "text", value: String.raw`:l\ol:` },
      { name: "width", value: "30" },
    ],
  });
});
