import { describe, expect, it } from "vitest";
import { materialColor } from "./appearance.js";
import { breachFor, fragmentPalette, inBreach, pickColor } from "./fracture.js";

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("fracture breach", () => {
  const half = [1, 0.5, 2] as const;

  it("opens the part on the side the failure threw its debris, and keeps the rest", () => {
    const b = breachFor(half, [1, 0, 0], 0.6, seq([0.3, 0.7, 0.5]));
    expect(inBreach(b, [0.98, 0, 0])).toBe(true);
    expect(inBreach(b, [0, 0, 0])).toBe(false);
    expect(inBreach(b, [-0.98, 0, 0])).toBe(false);
    expect(inBreach(b, [0, 0, 1.9])).toBe(false);
  });

  it("reaches deeper the more of the part broke away", () => {
    const shallow = breachFor(half, [0, 0, 1], 0.1, seq([0.5]));
    const deep = breachFor(half, [0, 0, 1], 1, seq([0.5]));
    expect(inBreach(shallow, [0, 0, 0.8])).toBe(false);
    expect(inBreach(deep, [0, 0, 0.8])).toBe(true);
  });

  it("is jagged: its three faces are tilted apart, not one flat cut", () => {
    const b = breachFor(half, [0, 1, 0], 0.5, seq([0.2, 0.9, 0.4]));
    const [a, c] = [b.normals[0]!, b.normals[1]!];
    const dot = a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    expect(dot).toBeLessThan(0.95);
  });
});

describe("fragment palette", () => {
  it("throws casing fragments and pieces of what was inside, but no fluids", () => {
    const palette = fragmentPalette("reactor-chamber", "stainless-steel");
    expect(palette.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
    const tungsten = materialColor("tungsten").getHexString();
    expect(palette.some((p) => p.color.getHexString() === tungsten)).toBe(true);
    // The chamber's fuel gas is not a fragment.
    expect(palette.length).toBeLessThan(4);
  });

  it("is all casing for a part with no internals on record", () => {
    const palette = fragmentPalette("no-such-part", "structural-steel");
    expect(palette).toHaveLength(1);
    expect(pickColor(palette, 0.99).getHexString()).toBe(
      materialColor("structural-steel").getHexString(),
    );
  });
});
