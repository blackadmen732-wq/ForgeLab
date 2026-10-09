import { describe, expect, it } from "vitest";
import {
  SimulationWorld,
  resistivityAt,
  deserializeWorld,
  serializeWorld,
  type FailureEvent,
  type SimulationSnapshot,
} from "@forgelab/sim-core";
import { criticalTemperatureK, getSubstance } from "@forgelab/materials";
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

  it("an NbTi toroidal-field set above 14.5 T cannot superconduct and quenches on energising", () => {
    const world = plant({ parameterOverrides: { "tf-coils": { conductor: "nbti" } } });
    seconds(world, 1);
    const quench = find(world.getSnapshot(), "quench", "tf-coils");
    expect(quench).toBeDefined();
    expect(quench!.summary).toContain("field too high");
    expect(quench!.cause).toContain("upper critical field");
    expect((quench!.causalChain ?? []).map((l) => l.failureType)).toEqual(["quench"]);
  });

  it("an NbTi coil's quench limit follows its peak field", { timeout: 30000 }, () => {
    // 25 kA instead of 68 kA: about 6.5 T peak, inside NbTi's critical surface at 4.5 K.
    const world = plant({
      parameterOverrides: { "tf-coils": { conductor: "nbti", currentA: 25000 } },
    });
    seconds(world, 2);
    const coil = world.getSnapshot().components.find((c) => c.id === "tf-coils")!;
    const peak = coil.state.plant.magnet!.peakFieldT;
    expect(peak).toBeGreaterThan(5);
    expect(peak).toBeLessThan(9);
    const limit = coil.state.plant.thermal.limitTemperatureK;
    expect(limit).toBeCloseTo(criticalTemperatureK(getSubstance("nbti").superconductor!, peak), 6);
    expect(limit).toBeLessThan(9.2);
    expect(limit).toBeGreaterThan(4.5);
    expect(find(world.getSnapshot(), "quench", "tf-coils")).toBeUndefined();
  });

  it("an undersized copper bus heats faster as it heats: ρ(T) feeds back into I²R", () => {
    const world = plant({ parameterOverrides: { bus: { crossSectionM2: 1e-5 } } });
    const read = () => {
      const bus = world.getSnapshot().components.find((c) => c.id === "bus")!;
      const current = bus.state.plant.electrical!.currentA;
      return {
        t: bus.state.plant.thermal.temperatureK,
        perAmp2: bus.state.plant.thermal.heatGeneratedW / (current * current),
      };
    };
    seconds(world, 1);
    const early = read();
    seconds(world, 30);
    const late = read();
    expect(late.t).toBeGreaterThan(early.t + 10);
    // The bus's own resistance scales with copper's resistivity (CRC table); the heat
    // booked to it also includes its share of the connecting cables, at fixed resistivity.
    const expected = resistivityAt("copper", late.t) / resistivityAt("copper", early.t);
    const grew = late.perAmp2 / early.perAmp2;
    expect(grew).toBeGreaterThan(1 + 0.7 * (expected - 1));
    expect(grew).toBeLessThanOrEqual(expected + 1e-9);
    expect(expected).toBeGreaterThan(1.05);
  });

  it("a hot-leg pipe with too thin a wall ruptures and the loop blows down", () => {
    const world = plant();
    const pipe = world.requireComponent("pipe-hot");
    const { geometry, connectionPoints } = getComponentDefinition("coolant-pipe").reshape(
      { lengthM: 4, outerRadiusM: 0.39, wallM: 0.02 },
      pipe.materialId,
    );
    world.reshapeComponent("pipe-hot", geometry, connectionPoints);
    world.solve();
    seconds(world, 2);
    const snapshot = world.getSnapshot();
    const rupture = find(snapshot, "pipe_rupture", "pipe-hot");
    expect(rupture).toBeDefined();
    expect(rupture!.cause).toContain("Lamé");
    expect(rupture!.measuredValue).toBeGreaterThan(rupture!.limitValue);
    const loop = snapshot.plant.loops.find((l) => l.componentIds.includes("pipe-hot"))!;
    expect(loop.closed).toBe(false);
    expect(loop.massFlowKgS).toBe(0);
    const lost = find(snapshot, "loss_of_flow");
    expect(lost?.cause).toContain('pipe "pipe-hot" has ruptured');
    expect(lost!.causalChain!.map((l) => l.failureType)).toEqual(["pipe_rupture", "loss_of_flow"]);
  });

  it("the default pipe holds its loop with margin", () => {
    const world = plant();
    seconds(world, 2);
    const pipe = world.getSnapshot().components.find((c) => c.id === "pipe-hot")!;
    const u = pipe.state.plant.outputs["hoopUtilization"]!;
    expect(u).toBeGreaterThan(0.2);
    expect(u).toBeLessThan(0.6);
    expect(find(world.getSnapshot(), "pipe_rupture")).toBeUndefined();
  });

  it(
    "an overheating loop boils, its pump cavitates and the flow collapses",
    { timeout: 60000 },
    () => {
      const world = plant({
        omit: ["interlock", "wall-sensor"],
        parameterOverrides: {
          pump: { ratedMassFlowKgS: 300 },
          "steam-gen": { secondaryConductanceWK: 1e5 },
        },
      });
      let lost: FailureEvent | undefined;
      for (let i = 0; i < 700 && lost === undefined; i += 1) {
        seconds(world, 1);
        lost = find(world.getSnapshot(), "loss_of_flow");
      }
      const snapshot = world.getSnapshot();
      const cavitation = find(snapshot, "pump_cavitation", "pump")!;
      expect(cavitation).toBeDefined();
      expect(cavitation.cause).toContain("vapour pressure");
      expect(find(snapshot, "coolant_boiling")!.timestampSec).toBeLessThan(cavitation.timestampSec);
      expect(lost).toBeDefined();
      expect(lost!.cause).toContain("cavitating");
      expect(lost!.causalChain!.map((l) => l.failureType)).toEqual([
        "coolant_boiling",
        "pump_cavitation",
        "loss_of_flow",
      ]);
    },
  );

  it(
    "a quench holds its current until protection detects it, then dumps it",
    { timeout: 60000 },
    () => {
      const world = plant({
        parameterOverrides: {
          "tf-coils": {
            staticHeatLeakW: 1e6,
            coldMassSpecificHeatJkgK: 0.1,
            quenchDetectionDelayS: 2,
          },
        },
      });
      const coilState = () =>
        world.getSnapshot().components.find((c) => c.id === "tf-coils")!.state.plant.magnet!;
      seconds(world, 1);
      const before = coilState();
      expect(before.storedEnergyJ).toBeCloseTo(0.5 * before.inductanceH * before.currentA ** 2, 0);
      expect(before.storedEnergyJ).toBeGreaterThan(1e9);
      let quench: FailureEvent | undefined;
      for (let i = 0; i < 6000 && quench === undefined; i += 1) {
        world.stepMany(1);
        quench = find(world.getSnapshot(), "quench", "tf-coils");
      }
      expect(quench).toBeDefined();
      expect(quench!.cause).toContain("½LI²");
      // Heat the refrigeration could not take was boiling helium before the quench.
      expect(coilState().heliumBoilOffKgS).toBeGreaterThan(0);
      // Still holding its current inside the detection time…
      seconds(world, 1);
      const held = coilState();
      expect(held.quenched).toBe(true);
      expect(held.dumping).toBe(false);
      expect(held.currentA).toBeCloseTo(before.currentA, 6);
      // …then the dump circuit opens and the current decays with τ.
      seconds(world, 1.5);
      const dumped = coilState();
      expect(dumped.dumping).toBe(true);
      expect(dumped.currentA).toBeLessThan(held.currentA);
      expect(dumped.dumpPowerW).toBeGreaterThan(0);
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

  it("says when a coil's field reaches no plasma, without pretending it was not computed", () => {
    const world = new SimulationWorld();
    placePart(world, "tf-coil-set", { id: "lonely", position: { x: 0, y: 4.35, z: 0 } });
    world.solve();
    const snapshot = world.getSnapshot();
    const magnetics = snapshot.plant.confidence.subsystems.find(
      (s) => s.subsystem === "magnetics",
    )!;
    expect(magnetics.level).toBe("approximate");
    expect(magnetics.reasons.join(" ")).toMatch(/negligible/);
    expect(snapshot.components[0]!.state.plant.warnings.join(" ")).toContain(
      "does not reach any vessel's plasma",
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
