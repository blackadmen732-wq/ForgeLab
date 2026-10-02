import { describe, expect, it } from "vitest";
import { buildReferencePlant } from "@forgelab/reactor-components";
import { SimulationWorld } from "@forgelab/sim-core";
import { Vector3 } from "three";
import { explodeOffsets, peeledIds, sectionClipPlane } from "./inspection.js";

const plant = () => {
  const world = new SimulationWorld({ name: "Reference" });
  buildReferencePlant(world);
  return world.getSnapshot().components;
};

describe("inspection views", () => {
  it("peel the machine from the outside in", () => {
    const parts = plant();
    expect(peeledIds(parts, 0).size).toBe(0);
    const services = peeledIds(parts, 1);
    expect(services.has("pump")).toBe(true);
    expect(services.has("tf-coils")).toBe(false);
    expect(peeledIds(parts, 3).has("tf-coils")).toBe(true);
    expect(peeledIds(parts, 3).has("blanket")).toBe(false);
    const deepest = peeledIds(parts, 4);
    expect(deepest.has("blanket")).toBe(true);
    // The vessel is never hidden: it is what the peel exposes.
    expect(deepest.has("vessel")).toBe(false);
  });

  it("pull the machine apart along meaningful directions", () => {
    const offsets = explodeOffsets(plant());
    // Nested shells share the centre: they lift apart in order, the vessel stays.
    expect(offsets.get("vessel")!.length()).toBe(0);
    expect(offsets.get("tf-coils")!.y).toBeGreaterThan(offsets.get("blanket")!.y);
    // Equipment beside the machine moves outward, horizontally.
    const pump = offsets.get("pump")!;
    expect(pump.y).toBe(0);
    expect(pump.length()).toBeGreaterThan(6);
  });

  it("keeps the chosen side of a section plane", () => {
    const keepMinus = sectionClipPlane({ axis: "x", offsetM: 2, flip: false });
    expect(keepMinus.distanceToPoint(new Vector3(0, 0, 0))).toBeGreaterThan(0);
    expect(keepMinus.distanceToPoint(new Vector3(3, 0, 0))).toBeLessThan(0);
    const keepPlus = sectionClipPlane({ axis: "x", offsetM: 2, flip: true });
    expect(keepPlus.distanceToPoint(new Vector3(3, 0, 0))).toBeGreaterThan(0);
  });
});
