import { describe, expect, it } from "vitest";
import { SimulationWorld, planServiceRoutes } from "@forgelab/sim-core";
import { buildIterClassPlant, buildReferencePlant } from "./designs.js";

function routes(build: (world: SimulationWorld) => void) {
  const world = new SimulationWorld();
  build(world);
  return planServiceRoutes(world.listComponents(), world.listConnections(), 0);
}

describe("service routes in the ready-made plants", () => {
  it("routes every pipe, cable and duct of the reference plant clear of its machinery", () => {
    const planned = routes(buildReferencePlant);
    expect(planned.length).toBeGreaterThan(20);
    expect(planned.filter((r) => r.state === "blocked").map((r) => r.id)).toEqual([]);
  });
  it("routes nearly all of the ITER-class plant; the rest wait on its PF coil layout", () => {
    const planned = routes(buildIterClassPlant);
    expect(planned.filter((r) => r.state === "blocked").length).toBeLessThanOrEqual(5);
  });
  it("plans the same routes for the same design", () => {
    expect(routes(buildReferencePlant)).toEqual(routes(buildReferencePlant));
  });
});
