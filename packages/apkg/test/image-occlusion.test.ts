import { describe, expect, test } from "vite-plus/test";

import { clozeNumbers, parseImageCloze } from "../src/cloze.ts";
import { floatToDisplay, occlusionsToCloze } from "../src/image-occlusion.ts";

test.each([
  [0, ".0000"],
  [0.1, ".1"],
  [0.23456, ".2346"],
  [0.5, ".5"],
  [1, "1."],
])("floatToDisplay(%d) is %s, as in Anki", (value, text) => {
  expect(floatToDisplay(value)).toBe(text);
});

describe("occlusionsToCloze", () => {
  test("writes Anki's rect syntax with occlude-inactive", () => {
    expect(
      occlusionsToCloze([
        { shape: "rect", left: 0.1, top: 0.2, width: 0.3, height: 0.05 },
        { shape: "rect", left: 0.6, top: 0.2, width: 0.25, height: 0.05 },
      ]),
    ).toBe(
      "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.05:oi=1}}<br>" +
        "{{c2::image-occlusion:rect:left=.6:top=.2:width=.25:height=.05:oi=1}}<br>",
    );
  });

  test("writes ellipses and polygons", () => {
    expect(
      occlusionsToCloze(
        [
          { shape: "ellipse", left: 0.1, top: 0.1, rx: 0.05, ry: 0.1 },
          {
            shape: "polygon",
            points: [
              { x: 0.5, y: 0.2 },
              { x: 0.7, y: 0.4 },
              { x: 0.4, y: 0.6 },
            ],
          },
        ],
        { occludeInactive: false },
      ),
    ).toBe(
      "{{c1::image-occlusion:ellipse:left=.1:top=.1:rx=.05:ry=.1}}<br>" +
        "{{c2::image-occlusion:polygon:left=.4:top=.2:points=.5,.2 .7,.4 .4,.6}}<br>",
    );
  });

  test("keeps given ordinals and fills the gaps for the rest", () => {
    const text = occlusionsToCloze([
      { shape: "rect", left: 0, top: 0, width: 0.1, height: 0.1, ordinal: 2 },
      { shape: "rect", left: 0.2, top: 0, width: 0.1, height: 0.1 },
      { shape: "rect", left: 0.4, top: 0, width: 0.1, height: 0.1, ordinal: 2 },
      { shape: "rect", left: 0.6, top: 0, width: 0.1, height: 0.1 },
    ]);
    expect([...text.matchAll(/\{\{c(\d+)::/g)].map((match) => Number(match[1]))).toEqual([
      2, 1, 2, 3,
    ]);
    expect([...clozeNumbers(text)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  test("round-trips through Anki's parser", () => {
    const text = occlusionsToCloze([
      { shape: "rect", left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
    ]);
    const body = /\{\{c1::image-occlusion:(.*)\}\}/.exec(text)?.[1] ?? "";
    expect(parseImageCloze(body)).toEqual({
      shape: "rect",
      properties: [
        { name: "left", value: ".1" },
        { name: "top", value: ".2" },
        { name: "width", value: ".3" },
        { name: "height", value: ".4" },
        { name: "oi", value: "1" },
      ],
    });
  });
});
