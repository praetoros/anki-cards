import { describe, expect, it } from "vite-plus/test";

import { normaliseMaskOrdinals } from "../src/cards.ts";

const rect = (ordinal?: number) => ({
  shape: "rect" as const,
  left: 0.1,
  top: 0.1,
  width: 0.2,
  height: 0.2,
  ...(ordinal === undefined ? {} : { ordinal }),
});

describe("normaliseMaskOrdinals", () => {
  it("shifts zero-based ordinals to start at 1 and keeps groups", () => {
    const out = normaliseMaskOrdinals([rect(0), rect(1), rect(1), rect(3)]);
    expect(out.map((s) => s.ordinal)).toEqual([1, 2, 2, 4]);
  });

  it("leaves one-based ordinals and missing ordinals alone", () => {
    const out = normaliseMaskOrdinals([rect(1), rect(), rect(2)]);
    expect(out.map((s) => s.ordinal)).toEqual([1, undefined, 2]);
  });
});
