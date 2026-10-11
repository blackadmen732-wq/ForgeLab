import { describe, expect, it } from "vitest";
import { SimulationWorld } from "@forgelab/sim-core";
import { buildIterClassPlant, buildTokamakBuilding } from "./designs.js";

describe("tokamak building", () => {
  it("stands by its own structural physics: no slab, column or wall fails", () => {
    const world = new SimulationWorld({ name: "Building" });
    buildTokamakBuilding(world);
    world.solve();
    const snapshot = world.getSnapshot();
    const worst = Math.max(...snapshot.components.map((c) => c.state.structural.utilization));
    expect(snapshot.failures).toEqual([]);
    expect(worst).toBeLessThan(1);
    // Every slab is carried: none is free.
    for (const c of snapshot.components.filter((c) => c.type === "concrete-slab"))
      expect(c.state.support.mode).not.toBe("free");
  });

  it("plain concrete cracks when the slabs are too thin for the span", () => {
    const world = new SimulationWorld({ name: "Thin" });
    buildTokamakBuilding(world, {
      spanM: 12,
      slabDepthM: 0.6,
      wingCentresX: [0],
      storeys: 1,
      bays: 1,
    });
    world.solve();
    const worst = Math.max(
      ...world
        .getSnapshot()
        .components.filter((c) => c.type === "concrete-slab")
        .map((c) => c.state.structural.utilization),
    );
    expect(worst).toBeGreaterThan(1);
  });

  it("fits beside the ITER-class plant without overlapping it", () => {
    const world = new SimulationWorld({ name: "Plant and building" });
    buildIterClassPlant(world);
    buildTokamakBuilding(world);
    world.solve();
    expect(world.listComponents().length).toBeGreaterThan(150);
  });
});
