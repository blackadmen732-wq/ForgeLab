import { describe, expect, it } from "vitest";
import { SimulationWorld, failureKey, fuelInventory } from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import { placePart } from "./designs.js";
import { buildScenario } from "./scenarios.js";

/**
 * The reference cascade: one engineering mistake (a main bus sized at 1 mm²) and nothing
 * scripted. Each step is the next system's own physics reacting to the world the last
 * step changed — and with protection fitted, the same mistake stops at the breaker.
 */
const plant = (world: SimulationWorld, id: string) =>
  world.getSnapshot().components.find((c) => c.id === id)!.state.plant;

const events = (world: SimulationWorld) =>
  world.getSnapshot().failures.map((f) => ({ ...f, key: failureKey(f) }));

function run(world: SimulationWorld, seconds: number, each?: () => void) {
  for (let s = 0; s < seconds; s += 1) {
    world.stepMany(60);
    each?.();
  }
}

/** A thermocouple on the bus and an interlock that opens a breaker on the grid feed. */
function protect(world: SimulationWorld) {
  const feed = world
    .listConnections()
    .find(
      (c) =>
        (c.from.componentId === "grid" && c.to.componentId === "bus") ||
        (c.from.componentId === "bus" && c.to.componentId === "grid"),
    )!;
  world.disconnect(feed.id);
  placePart(world, "breaker", { id: "breaker", position: vec3(20, 0.8, 6) });
  placePart(world, "sensor", { id: "bus-sensor", position: vec3(18, 0.35, 5) });
  placePart(world, "interlock", {
    id: "bus-interlock",
    position: vec3(21, 0.9, 2),
    // Trip below the copper's 200 °C service limit and well below XLPE's ignition.
    parameters: { setpoint: 420, comparison: "above", action: "open-breakers" },
  });
  const join = (a: [string, string], b: [string, string]) =>
    world.connect(
      { componentId: a[0], connectionPointId: a[1] },
      { componentId: b[0], connectionPointId: b[1] },
    );
  join(["grid", "power"], ["breaker", "line"]);
  join(["breaker", "load"], ["bus", "b"]);
  join(["bus-sensor", "signal"], ["bus", "sensor"]);
  join(["bus-interlock", "signal"], ["bus-sensor", "signal"]);
  join(["bus-interlock", "signal"], ["breaker", "control"]);
  world.solve();
}

describe("reference cascade: an undersized bus", () => {
  it("overheats, sets its insulation alight, heats its neighbours, melts and blacks out the plant", () => {
    const world = buildScenario("electrical-bus-fault");
    let peakFireW = 0;
    let neighbourHeatW = 0;
    run(world, 90, () => {
      peakFireW = Math.max(peakFireW, plant(world, "bus").combustion?.heatReleaseW ?? 0);
      for (const c of world.getSnapshot().components) {
        const t = c.state.plant.thermal;
        if (c.id !== "bus" && t.spatialHeatSourceId === "bus")
          neighbourHeatW = Math.max(neighbourHeatW, t.spatialHeatInW);
      }
    });
    const log = events(world);
    const at = (id: string, type: string) =>
      log.find((e) => e.componentId === id && e.failureType === type);
    const hot = at("bus", "over_temperature")!;
    const fire = at("bus", "fire")!;
    const melted = at("bus", "melted")!;
    const disruption = at("vessel", "disruption")!;
    for (const e of [hot, fire, melted, disruption]) expect(e).toBeDefined();
    // In order, each caused by the one before.
    expect(hot.timestampSec).toBeLessThan(fire.timestampSec);
    expect(fire.timestampSec).toBeLessThan(melted.timestampSec);
    expect(melted.timestampSec).toBeLessThanOrEqual(disruption.timestampSec);
    expect(fire.causeKeys).toContain(hot.key);
    expect(melted.causeKeys).toContain(hot.key);
    expect(fire.limitValue).toBeCloseTo(623.15, 2);
    expect(melted.limitValue).toBeCloseTo(1357.77, 2);
    expect(fire.cause).toMatch(/Insulating sleeve/);
    // The fire is the sleeve's XLPE burning at its sourced rate: megawatts, not a number
    // picked for effect (0.026 kg/(m²·s) × 3.26 m² × 43.3 MJ/kg ≈ 3.7 MW).
    expect(peakFireW).toBeGreaterThan(3e6);
    expect(peakFireW).toBeLessThan(4.5e6);
    // Its neighbours, which share no port with it, receive its heat through space.
    expect(neighbourHeatW).toBeGreaterThan(1e3);
    // The blackout reaches the loads through the network, attributed to the melt.
    const shortfall = log.find((e) => e.failureType === "supply_shortfall")!;
    expect(shortfall.timestampSec).toBeGreaterThanOrEqual(melted.timestampSec);
    // The fire keeps burning after the circuit opens: its fuel decides, not the event.
    expect(plant(world, "bus").combustion!.burning).toBe(true);
  }, 60_000);

  it("the same mistake stops at the breaker when the bus is protected", () => {
    const world = buildScenario("electrical-bus-fault");
    protect(world);
    run(world, 90);
    const log = events(world);
    const trip = log.find((e) => e.failureType === "interlock_trip")!;
    expect(trip.componentId).toBe("bus-interlock");
    expect(trip.measuredValue).toBeGreaterThan(420);
    // No over-temperature, no fire, no melt: the cascade stopped where it was designed to.
    for (const type of ["over_temperature", "fire", "melted"])
      expect(log.filter((e) => e.componentId === "bus" && e.failureType === type)).toEqual([]);
    const bus = plant(world, "bus");
    expect(bus.combustion!.burning).toBe(false);
    expect(bus.combustion!.fuelRemainingKg).toBe(bus.combustion!.fuelKg);
    expect(bus.thermal.temperatureK).toBeLessThan(473);
  }, 60_000);

  it("is deterministic", () => {
    const a = buildScenario("electrical-bus-fault");
    const b = buildScenario("electrical-bus-fault");
    run(a, 40);
    run(b, 40);
    expect(plant(b, "bus")).toEqual(plant(a, "bus"));
    expect(events(b).map((e) => e.key)).toEqual(events(a).map((e) => e.key));
  }, 60_000);
});

describe("burnable inventory", () => {
  it("comes from the bus bar's XLPE sleeve, with the sourced burning data", () => {
    const world = new SimulationWorld({ name: "Bus" });
    placePart(world, "bus-bar", { id: "bus", position: vec3(0, 0.05, 0) });
    placePart(world, "breaker", { id: "breaker", position: vec3(3, 0.8, 0) });
    const [bus, breaker] = ["bus", "breaker"].map((id) =>
      world.getSnapshot().components.find((c) => c.id === id)!,
    );
    const fuel = fuelInventory(bus!)!;
    // 13 % of the 4 m × 0.1 m × 0.3 m envelope at 920 kg/m³.
    expect(fuel.kg).toBeCloseTo(0.13 * 0.12 * 920, 9);
    expect(fuel.substanceIds).toEqual(["xlpe"]);
    expect(fuel.heatOfCombustionJPerKg).toBeCloseTo(43.3e6, 0);
    // Steel does not burn.
    expect(fuelInventory(breaker!)).toBeNull();
  });
});
