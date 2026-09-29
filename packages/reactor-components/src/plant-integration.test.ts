import { describe, expect, it } from "vitest";
import {
  SimulationWorld,
  deserializeWorld,
  serializeWorld,
  type FailureEvent,
  type SimulationSnapshot,
} from "@forgelab/sim-core";
import { getComponentDefinition } from "./builtin.js";
import { buildReferencePlant, placePart, type ReferencePlantOptions } from "./designs.js";

function plant(options: ReferencePlantOptions = {}): SimulationWorld {
  const world = new SimulationWorld({ name: "Reference Plant" });
  buildReferencePlant(world, options);
  return world;
}

const seconds = (world: SimulationWorld, s: number) => world.stepMany(Math.round(s * 60));

/** A 20 mm first wall (90 t instead of 267 t) heats about three times faster. */
function thinWall(world: SimulationWorld): SimulationWorld {
  const vessel = world.requireComponent("vessel");
  const { geometry, connectionPoints } = getComponentDefinition("tokamak-vessel").reshape(
    { majorRadiusM: 6.2, tubeRadiusM: 2.3, wallM: 0.02 },
    vessel.materialId,
  );
  world.reshapeComponent("vessel", geometry, connectionPoints);
  world.solve();
  return world;
}
const vesselOf = (snapshot: SimulationSnapshot) =>
  snapshot.components.find((c) => c.id === "vessel")!.state.plant.vessel!;
const find = (
  snapshot: SimulationSnapshot,
  type: string,
  componentId?: string,
): FailureEvent | undefined =>
  snapshot.failures.find(
    (f) => f.failureType === type && (componentId === undefined || f.componentId === componentId),
  );

describe("reference tokamak plant", () => {
  it("is fully wired at t = 0: field on, vessel pumped down, loop flowing, no diagnostics", () => {
    const snapshot = plant().getSnapshot();
    expect(snapshot.diagnostics).toEqual([]);
    const vessel = vesselOf(snapshot);
    expect(vessel.plasma.fieldT).toBeCloseTo(5.29, 2);
    expect(vessel.pressurePa).toBeLessThan(1e-4);
    expect(vessel.plasma.phase).toBe("off");
    expect(snapshot.plant.loops).toHaveLength(1);
    expect(snapshot.plant.loops[0]!.closed).toBe(true);
    expect(snapshot.plant.loops[0]!.massFlowKgS).toBeGreaterThan(3000);
    expect(snapshot.plant.islands).toHaveLength(1);
    expect(snapshot.plant.islands[0]!.supplyFraction).toBe(1);
    // Blanket and vessel rest on the coil set through their feet: nothing is falling.
    for (const component of snapshot.components)
      expect(component.state.support.mode).not.toBe("free");
  });

  it("breaks down, ramps to flat-top and burns D–T", { timeout: 30000 }, () => {
    const world = plant();
    seconds(world, 40);
    const snapshot = world.getSnapshot();
    const plasma = vesselOf(snapshot).plasma;
    expect(plasma.phase).toBe("flat-top");
    expect(plasma.plasmaCurrentA).toBeCloseTo(15e6, 0);
    expect(plasma.temperatureKeV).toBeGreaterThan(5);
    expect(plasma.fusionPowerW).toBeGreaterThan(1e8);
    expect(plasma.neutronPowerW / plasma.fusionPowerW).toBeCloseTo(14.07 / 17.59, 3);
    expect(plasma.greenwaldFraction).toBeLessThan(1);
    expect(plasma.safetyFactorQ95).toBeGreaterThan(2);
    expect(snapshot.failures.filter((f) => f.system !== "control")).toEqual([]);
  });

  it(
    "reports net power as gross generation minus everything the plant consumes",
    { timeout: 30000 },
    () => {
      const world = plant();
      seconds(world, 30);
      const { metrics, islands } = world.getSnapshot().plant;
      const consumed = islands.reduce((sum, island) => sum + island.deliveredW + island.lossW, 0);
      expect(metrics.houseLoadW).toBeCloseTo(consumed, 3);
      expect(metrics.netElectricW).toBeCloseTo(metrics.grossElectricW - metrics.houseLoadW, 3);
      // An ITER-class machine with 143 MW of beam power draw is a net consumer.
      expect(metrics.netElectricW).toBeLessThan(0);
      expect(metrics.gridImportW).toBeGreaterThan(0);
    },
  );

  it("shows a large negative net output with fusion but no generator", { timeout: 30000 }, () => {
    const world = plant({ omit: ["generator"] });
    seconds(world, 30);
    const { metrics } = world.getSnapshot().plant;
    expect(metrics.fusionPowerW).toBeGreaterThan(5e7);
    expect(metrics.grossElectricW).toBe(0);
    expect(metrics.netElectricW).toBeCloseTo(-metrics.houseLoadW, 6);
  });

  it(
    "is deterministic: two identical plants give bit-identical results",
    { timeout: 30000 },
    () => {
      const a = plant();
      const b = plant();
      seconds(a, 20);
      seconds(b, 20);
      const pick = (s: SimulationSnapshot) =>
        JSON.stringify({
          metrics: s.plant.metrics,
          vessel: vesselOf(s),
          temps: s.components.map((c) => [c.id, c.state.plant.thermal.temperatureK]),
        });
      expect(pick(a.getSnapshot())).toBe(pick(b.getSnapshot()));
    },
  );

  it("round-trips through a save file and runs identically afterwards", { timeout: 30000 }, () => {
    const original = plant();
    const restored = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(original))));
    expect(restored.listComponents().map((c) => [c.id, c.role, c.parameters])).toEqual(
      original.listComponents().map((c) => [c.id, c.role, c.parameters]),
    );
    expect(restored.listConnections()).toHaveLength(original.listConnections().length);
    seconds(original, 10);
    seconds(restored, 10);
    expect(restored.getSnapshot().plant.metrics).toEqual(original.getSnapshot().plant.metrics);
  });
});

describe("explained failure chains", () => {
  it("pump off → loss of flow → first wall overheats → plasma disrupts", { timeout: 60000 }, () => {
    const world = thinWall(
      plant({
        omit: ["interlock", "wall-sensor"],
        parameterOverrides: { pump: { enabled: false } },
      }),
    );
    let disruption: FailureEvent | undefined;
    for (let i = 0; i < 400 && disruption === undefined; i += 1) {
      seconds(world, 1);
      disruption = find(world.getSnapshot(), "disruption");
    }
    const snapshot = world.getSnapshot();
    const lossOfFlow = find(snapshot, "loss_of_flow");
    expect(lossOfFlow).toBeDefined();
    expect(lossOfFlow!.cause).toContain("switched off");

    const overheat = find(snapshot, "over_temperature", "vessel");
    expect(overheat).toBeDefined();
    expect(overheat!.causalChain!.map((l) => l.failureType)).toEqual([
      "loss_of_flow",
      "over_temperature",
    ]);

    expect(disruption).toBeDefined();
    expect(disruption!.causalChain!.map((l) => l.failureType)).toEqual([
      "loss_of_flow",
      "over_temperature",
      "disruption",
    ]);
    expect(disruption!.cause).toContain("struck the wall");
    expect(vesselOf(snapshot).plasma.phase).toBe("disrupted");
  });

  it(
    "the wall interlock trips first and shuts the plasma down without a disruption",
    { timeout: 60000 },
    () => {
      const world = thinWall(plant({ parameterOverrides: { pump: { enabled: false } } }));
      seconds(world, 200);
      const snapshot = world.getSnapshot();
      expect(find(snapshot, "interlock_trip", "interlock")).toBeDefined();
      expect(find(snapshot, "disruption")).toBeUndefined();
      expect(["shutdown", "ended"]).toContain(vesselOf(snapshot).plasma.phase);
    },
  );

  it(
    "a coil quench collapses the field and the plasma disrupts on the kink limit",
    { timeout: 60000 },
    () => {
      // A cold mass with little heat capacity and a failing cryostat: it warms past T_c fast.
      const world = plant({
        parameterOverrides: { "tf-coils": { staticHeatLeakW: 1e6, coldMassSpecificHeatJkgK: 0.1 } },
      });
      let disruption: FailureEvent | undefined;
      for (let i = 0; i < 120 && disruption === undefined; i += 1) {
        seconds(world, 1);
        disruption = find(world.getSnapshot(), "disruption");
      }
      const quench = find(world.getSnapshot(), "quench", "tf-coils");
      expect(quench).toBeDefined();
      expect(quench!.cause).toContain("critical temperature");
      expect(disruption).toBeDefined();
      expect(disruption!.causalChain!.map((l) => l.failureType)).toEqual(["quench", "disruption"]);
    },
  );

  it("fuelling past the Greenwald limit disrupts with an explanation", { timeout: 60000 }, () => {
    const world = plant({ parameterOverrides: { injector: { targetDensityM3: 2e20 } } });
    let disruption: FailureEvent | undefined;
    for (let i = 0; i < 60 && disruption === undefined; i += 1) {
      seconds(world, 1);
      disruption = find(world.getSnapshot(), "disruption");
    }
    expect(disruption).toBeDefined();
    expect(disruption!.summary).toContain("Greenwald");
    expect(disruption!.cause).toContain("n_G");
  });

  it("a starved grid raises supply shortfalls on every load", () => {
    const world = plant({ parameterOverrides: { grid: { maxPowerW: 5e6 } } });
    seconds(world, 1);
    const shortfalls = world
      .getSnapshot()
      .failures.filter((f) => f.failureType === "supply_shortfall");
    expect(shortfalls.length).toBeGreaterThan(0);
    expect(world.getSnapshot().plant.islands[0]!.supplyFraction).toBeLessThan(1);
  });
});

describe("model confidence", () => {
  it("labels a burning standard tokamak approximate, never supported", { timeout: 30000 }, () => {
    const world = plant();
    seconds(world, 20);
    const confidence = world.getSnapshot().plant.confidence;
    expect(confidence.level).toBe("approximate");
    expect(
      confidence.subsystems.some((s) => s.reasons.some((r) => r.includes("attenuation"))),
    ).toBe(true);
  });

  it("labels a linear (cylindrical) plasma device experimental", () => {
    const world = new SimulationWorld();
    placePart(world, "reactor-chamber", { id: "chamber", position: { x: 0, y: 1.5, z: 0 } });
    placePart(world, "solenoid-coil", { id: "coil", position: { x: 0, y: 1.5, z: 0 } });
    placePart(world, "neutral-beam", { id: "nbi", position: { x: 0, y: 1.2, z: 8 } });
    world.connect(
      { componentId: "nbi", connectionPointId: "port" },
      { componentId: "chamber", connectionPointId: "heating" },
    );
    world.solve();
    const confidence = world.getSnapshot().plant.confidence;
    expect(confidence.level).toBe("experimental");
  });

  it("does not call an empty chamber a plasma experiment", () => {
    const world = new SimulationWorld();
    placePart(world, "reactor-chamber", { id: "chamber", position: { x: 0, y: 1.5, z: 0 } });
    world.solve();
    expect(world.getSnapshot().plant.confidence.level).not.toBe("experimental");
  });

  it("labels a coil that encloses nothing experimental and says why", () => {
    const world = new SimulationWorld();
    placePart(world, "tf-coil-set", { id: "lonely", position: { x: 0, y: 4.35, z: 0 } });
    world.solve();
    const snapshot = world.getSnapshot();
    expect(snapshot.plant.confidence.level).toBe("experimental");
    expect(snapshot.components[0]!.state.plant.warnings.join(" ")).toContain(
      "field is not computed",
    );
  });
});

describe("resizing parts", () => {
  it("reshapes a vessel, keeps its connections and changes the plasma volume", () => {
    const world = plant();
    const before = vesselOf(world.getSnapshot()).plasma.volumeM3;
    const vessel = world.requireComponent("vessel");
    const connections = vessel.connections.length;
    const definition = getComponentDefinition("tokamak-vessel");
    const { geometry, connectionPoints } = definition.reshape(
      { majorRadiusM: 6.2, tubeRadiusM: 2.0, wallM: 0.06 },
      vessel.materialId,
    );
    world.reshapeComponent("vessel", geometry, connectionPoints);
    world.solve();
    expect(world.requireComponent("vessel").connections).toHaveLength(connections);
    const after = vesselOf(world.getSnapshot()).plasma.volumeM3;
    expect(after).toBeLessThan(before);
    expect(definition.dimensionsOf(geometry)["tubeRadiusM"]).toBeCloseTo(2.0, 12);
  });
});
