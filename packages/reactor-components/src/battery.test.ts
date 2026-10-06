import { describe, expect, it } from "vitest";
import { SimulationWorld, cellInventory, failureKey, selfHeatingW } from "@forgelab/sim-core";
import { getSubstance } from "@forgelab/materials";
import { vec3 } from "@forgelab/shared";
import { placePart } from "./designs.js";

/**
 * Battery modules fail from what reaches them, never from proximity. These are oven tests
 * in the spirit of battery abuse standards: the hall air is held at a temperature and the
 * module's own chemistry decides what happens.
 */
function oven(type: string, ambientK: number, seconds: number) {
  const world = new SimulationWorld({ settings: { ambientTemperatureK: ambientK } });
  placePart(world, type, { id: "module", position: vec3(0, 0.125, 0) });
  world.solve();
  let peakK = 0;
  for (let s = 0; s < seconds; s += 1) {
    world.stepMany(60);
    peakK = Math.max(peakK, world.getSnapshot().components[0]!.state.plant.thermal.temperatureK);
  }
  const failures = world.getSnapshot().failures.map((f) => ({ ...f, key: failureKey(f) }));
  const at = (type: string) => failures.find((f) => f.failureType === type);
  return { world, peakK, failures, at, plant: world.getSnapshot().components[0]!.state.plant };
}

describe("battery cells", () => {
  it("calibrate self-heating to the ARC definitions: 0.02 K/min at T1 and 1 K/s at T2", () => {
    const world = new SimulationWorld();
    placePart(world, "battery-module-nmc", { id: "m" });
    const cells = cellInventory(world.requireComponent("m"))!;
    const { selfHeatingOnsetK, triggerK } = cells.runaway;
    expect(selfHeatingW(cells, selfHeatingOnsetK) / cells.heatCapacityJK).toBeCloseTo(
      0.02 / 60,
      12,
    );
    expect(selfHeatingW(cells, triggerK) / cells.heatCapacityJK).toBeCloseTo(1, 9);
    // The module's mass comes from its internals: about half its envelope is cells.
    expect(cells.kg).toBeGreaterThan(100);
    expect(cells.kg).toBeLessThan(250);
  });

  it("an NMC module in a 180 °C oven self-heats, runs away and vents a jet fire", () => {
    const run = oven("battery-module-nmc", 453.15, 180);
    const selfHeating = run.at("battery_self_heating")!;
    const runaway = run.at("thermal_runaway")!;
    const vent = run.at("vent_fire")!;
    expect(selfHeating).toBeDefined();
    expect(runaway.causeKeys ?? []).toContain(selfHeating.key);
    expect((vent.causeKeys ?? []).some((k) => k === runaway.key || k.includes("::fire::"))).toBe(
      true,
    );
    // Runaway follows self-heating in time; it is not instantaneous.
    expect(runaway.timestampSec).toBeGreaterThan(selfHeating.timestampSec + 10);
    // NMC runs away past its vent gas's auto-ignition temperature.
    const nmc = getSubstance("li-ion-nmc-cell").thermalRunaway!;
    expect(run.peakK).toBeGreaterThan(nmc.ventGasAutoIgnitionK);
    expect(run.plant.outputs["runawayStage"]).toBe(3);
  });

  it("an LFP module runs away cooler, below its vent gas's auto-ignition temperature", () => {
    const run = oven("battery-module-lfp", 493.15, 180);
    expect(run.at("thermal_runaway")).toBeDefined();
    const lfp = getSubstance("li-ion-lfp-cell").thermalRunaway!;
    expect(run.peakK).toBeLessThan(lfp.ventGasAutoIgnitionK);
    // Its gas only burns because the module's own wiring caught fire: the cause says so.
    const vent = run.at("vent_fire");
    if (vent !== undefined) {
      expect(vent.cause).toMatch(/meets the fire already burning/);
      expect((vent.causeKeys ?? []).some((k) => k.includes("::fire::"))).toBe(true);
    }
  });

  it("a module at its 60 °C service limit does not run away", () => {
    const run = oven("battery-module-nmc", 333.15, 600);
    expect(run.failures).toEqual([]);
    expect(run.plant.outputs["runawayStage"]).toBe(0);
    expect(run.plant.outputs["selfHeatingW"]).toBeGreaterThan(0);
  });

  it("a module at room temperature beside a part that has failed but emits nothing stays put", () => {
    const world = new SimulationWorld();
    placePart(world, "battery-module-nmc", { id: "module", position: vec3(0, 0.125, 0) });
    placePart(world, "equipment-block", { id: "block", position: vec3(0.9, 0.5, 0) });
    world.solve();
    world.stepMany(60 * 120);
    const module = world.getSnapshot().components.find((c) => c.id === "module")!.state.plant;
    expect(module.thermal.temperatureK).toBeCloseTo(293.15, 3);
    expect(world.getSnapshot().failures).toEqual([]);
  });
});
