import { describe, expect, it } from "vitest";
import { type SimulationWorld, failureKey } from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import { placePart } from "./designs.js";
import { buildScenario } from "./scenarios.js";

/**
 * Rooms and storeys: walls and slabs are ordinary parts, and the hazard model blocks heat
 * with their true extent. The fire is the reference bus fault (its XLPE sleeve burning at
 * megawatts); the target is a battery module 3 m away that shares no port with it.
 */
function burn(build: (world: SimulationWorld) => void) {
  const world = buildScenario("electrical-bus-fault");
  placePart(world, "battery-module-nmc", { id: "target", position: vec3(18, 0.125, 7) });
  build(world);
  world.solve();
  let peakInW = 0;
  let fromBusW = 0;
  let peakK = 0;
  let fire = false;
  for (let s = 0; s < 90; s += 1) {
    world.stepMany(60);
    const snapshot = world.getSnapshot();
    const target = snapshot.components.find((c) => c.id === "target")!.state.plant.thermal;
    if (target.spatialHeatSourceId === "bus") fromBusW = Math.max(fromBusW, target.spatialHeatInW);
    peakInW = Math.max(peakInW, target.spatialHeatInW);
    peakK = Math.max(peakK, target.temperatureK);
    fire ||=
      snapshot.components.find((c) => c.id === "bus")!.state.plant.combustion?.burning ?? false;
  }
  const failures = world.getSnapshot().failures.map((f) => ({ ...f, key: failureKey(f) }));
  return { world, peakInW, fromBusW, peakK, fire, failures };
}

describe("rooms", () => {
  it("a concrete wall between a fire and a battery module keeps the fire's heat off it", () => {
    const open = burn(() => {});
    const walled = burn((world) =>
      // 6 m long along x, 4 m high, 300 mm thick, standing between the bus and the module.
      placePart(world, "concrete-wall", { id: "wall", position: vec3(18, 2, 5.5) }),
    );
    // The same fire burns either way: the wall changes what it reaches, not the fire.
    expect(open.fire && walled.fire).toBe(true);
    expect(open.fromBusW).toBeGreaterThan(1e3);
    // Behind the wall the fire is out of sight; what is left comes from elsewhere in the plant.
    expect(walled.fromBusW).toBe(0);
    expect(walled.peakInW).toBeLessThan(open.peakInW * 0.05);
    expect(walled.peakK).toBeLessThan(open.peakK);
  }, 120_000);
});

describe("walls are parts", () => {
  it("of sourced plain concrete, with its mass from its size", () => {
    const world = buildScenario("electrical-bus-fault");
    placePart(world, "concrete-wall", { id: "wall", position: vec3(0, 2, 30) });
    world.solve();
    const wall = world.requireComponent("wall");
    expect(wall.materialId).toBe("concrete-c30");
    // 6 × 4 × 0.3 m at 2400 kg/m³.
    expect(wall.state.physical.massKg).toBeCloseTo(6 * 4 * 0.3 * 2400, 0);
  });
});
