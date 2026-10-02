import { describe, expect, it } from "vitest";
import { buildReferencePlant } from "@forgelab/reactor-components";
import { SimulationWorld } from "@forgelab/sim-core";
import { STANDARD_GRAVITY_MPS2 } from "@forgelab/shared";
import { loadSummary } from "./loads.js";

describe("load summary", () => {
  it("sums the plant's weight into the ground and finds its heaviest part", () => {
    const world = new SimulationWorld({ name: "Reference" });
    buildReferencePlant(world);
    world.solve();
    const parts = world.getSnapshot().components;
    const s = loadSummary(parts);
    expect(s.count).toBe(parts.length);
    expect(s.totalMassKg).toBeCloseTo(
      parts.reduce((sum, c) => sum + c.massKg, 0),
      3,
    );
    // Everything ends up on the ground: the floor carries the whole plant's weight.
    expect(s.groundLoadN).toBeCloseTo(s.totalMassKg * STANDARD_GRAVITY_MPS2, -2);
    expect(s.heaviest!.massKg).toBe(Math.max(...parts.map((c) => c.massKg)));
    // The nested tori bear on each other: the largest reaction is at least the heaviest
    // part's own weight.
    expect(s.largestReaction!.loadN).toBeGreaterThanOrEqual(
      s.heaviest!.massKg * STANDARD_GRAVITY_MPS2 * 0.999,
    );
    expect(s.centreOfMassM).not.toBeNull();
  });

  it("is empty for nothing", () => {
    const s = loadSummary([]);
    expect(s.totalMassKg).toBe(0);
    expect(s.centreOfMassM).toBeNull();
    expect(s.largestReaction).toBeNull();
  });
});
