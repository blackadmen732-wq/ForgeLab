import { describe, expect, it } from "vitest";
import { distanceToAabb, segmentIntersectsAabb, SpatialHash } from "./spatial-hash.js";
import type { Aabb } from "../geometry.js";

/** Deterministic pseudo-random sequence for test data (no Math.random anywhere). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("spatial broad phase", () => {
  const next = lcg(42);
  const boxes = new Map<string, Aabb>();
  for (let i = 0; i < 300; i += 1) {
    const x = next() * 80 - 40;
    const y = next() * 20;
    const z = next() * 80 - 40;
    const s = 0.2 + next() * 3;
    boxes.set(`c${String(i).padStart(3, "0")}`, {
      minM: { x, y, z },
      maxM: { x: x + s, y: y + s * next(), z: z + s },
    });
  }
  const hash = new SpatialHash(4);
  for (const [id, box] of boxes) hash.insert(id, box);

  it("returns exactly what a brute-force scan returns, sorted", () => {
    for (let q = 0; q < 50; q += 1) {
      const center = { x: next() * 80 - 40, y: next() * 20, z: next() * 80 - 40 };
      const radius = next() * 15;
      const brute = [...boxes.entries()]
        .filter(([, box]) => distanceToAabb(center, box) <= radius)
        .map(([id]) => id)
        .sort();
      expect(hash.querySphere(center, radius)).toEqual(brute);
    }
  });

  it("handles a query far larger than the occupied space without walking empty cells", () => {
    const all = hash.querySphere({ x: 0, y: 0, z: 0 }, 10_000);
    expect(all.length).toBe(boxes.size);
  });

  it("detects line-of-sight blockage by a box", () => {
    const wall: Aabb = { minM: { x: -0.1, y: 0, z: -2 }, maxM: { x: 0.1, y: 3, z: 2 } };
    expect(segmentIntersectsAabb({ x: -3, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, wall)).toBe(true);
    expect(segmentIntersectsAabb({ x: -3, y: 5, z: 0 }, { x: 3, y: 5, z: 0 }, wall)).toBe(false);
    expect(segmentIntersectsAabb({ x: -3, y: 1, z: 3 }, { x: 3, y: 1, z: 3 }, wall)).toBe(false);
  });
});
