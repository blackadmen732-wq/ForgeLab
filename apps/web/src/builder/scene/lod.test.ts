import { describe, expect, it } from "vitest";
import { trimVisibleAt } from "./lod.js";

describe("fitting detail by distance", () => {
  it("drops a small machine's fittings far away and keeps a big one's", () => {
    expect(trimVisibleAt(20, 1)).toBe(true);
    expect(trimVisibleAt(100, 1)).toBe(false);
    // A 15 m cryostat keeps its ribs anywhere in a 140 m hall.
    expect(trimVisibleAt(150, 15)).toBe(true);
  });
});
