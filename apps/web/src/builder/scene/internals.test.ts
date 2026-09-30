import { describe, expect, it } from "vitest";
import { layerScales } from "./Internals.js";

const region = (id: string, volumeFraction?: number) => ({
  id,
  name: id,
  substanceId: "copper",
  purpose: "",
  ...(volumeFraction === undefined ? {} : { volumeFraction }),
});

describe("internals cross-section", () => {
  it("draws equal bands when proportions are unknown", () => {
    const s = layerScales([region("a"), region("b"), region("c"), region("d")]);
    [1, 0.8, 0.6, 0.4].forEach((v, i) => expect(s[i]).toBeCloseTo(v, 9));
  });

  it("sizes bands by volume when every region has a fraction", () => {
    // Outer 7/8 of the volume, inner 1/8: the inner band is half the size.
    const s = layerScales([region("outer", 0.875), region("inner", 0.125)]);
    expect(s[0]).toBe(1);
    expect(s[1]).toBeCloseTo(0.5, 6);
  });
});
