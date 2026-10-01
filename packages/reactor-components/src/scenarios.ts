import { SimulationWorld } from "@forgelab/sim-core";
import { getComponentDefinition } from "./builtin.js";
import { buildOverloadDemo, buildReferencePlant, type ReferencePlantOptions } from "./designs.js";

/**
 * Showroom fault scenarios: real designs with one deliberate engineering mistake each.
 *
 * Nothing here scripts a failure. Each scenario changes a design parameter the player
 * could change themselves (a thinner bus bar, a switched-off pump, a leaky cryostat) and
 * the simulation decides what happens. They exist so every failure family the showroom
 * presents can be reproduced on demand and tested.
 */
export interface ShowroomScenario {
  readonly id: string;
  readonly name: string;
  /** The engineering mistake, in one line. */
  readonly fault: string;
  /** The failure the simulation is expected to raise first-of-interest. */
  readonly expectedFailureType: string;
  /** Simulated seconds within which it is expected. */
  readonly withinSec: number;
  build(world: SimulationWorld): void;
}

function reference(options: ReferencePlantOptions, thinWall = false) {
  return (world: SimulationWorld) => {
    buildReferencePlant(world, options);
    if (thinWall) {
      // A 20 mm first wall (90 t instead of 267 t) heats about three times faster.
      const vessel = world.requireComponent("vessel");
      const { geometry, connectionPoints } = getComponentDefinition("tokamak-vessel").reshape(
        { majorRadiusM: 6.2, tubeRadiusM: 2.3, wallM: 0.02 },
        vessel.materialId,
      );
      world.reshapeComponent("vessel", geometry, connectionPoints);
      world.solve();
    }
  };
}

/** The reference plant with its hot-leg pipe's wall thinned to `wallM`. */
function thinHotLeg(wallM: number) {
  return (world: SimulationWorld) => {
    buildReferencePlant(world);
    const pipe = world.requireComponent("pipe-hot");
    const definition = getComponentDefinition("coolant-pipe");
    const dims = definition.dimensionsOf!(pipe.geometry);
    const { geometry, connectionPoints } = definition.reshape({ ...dims, wallM }, pipe.materialId);
    world.reshapeComponent("pipe-hot", geometry, connectionPoints);
    world.solve();
  };
}

export const SHOWROOM_SCENARIOS: readonly ShowroomScenario[] = Object.freeze([
  {
    id: "magnet-quench",
    name: "Magnet quench",
    fault: "TF cryostat with a 1 MW heat leak and a cold mass of almost no heat capacity.",
    expectedFailureType: "quench",
    withinSec: 120,
    build: reference({
      parameterOverrides: {
        "tf-coils": { staticHeatLeakW: 1e6, coldMassSpecificHeatJkgK: 0.1 },
      },
    }),
  },
  {
    id: "electrical-bus-fault",
    name: "Electrical bus fault",
    fault: "Main bus bar sized at 1 mm² instead of 2000 mm².",
    expectedFailureType: "over_temperature",
    withinSec: 60,
    build: reference({ parameterOverrides: { bus: { crossSectionM2: 1e-6 } } }),
  },
  {
    id: "pipe-rupture",
    name: "Coolant pipe rupture",
    fault: "Hot-leg pipe with a 20 mm wall instead of 60 mm, on a 15.5 MPa water loop.",
    expectedFailureType: "pipe_rupture",
    withinSec: 5,
    build: thinHotLeg(0.02),
  },
  {
    // The pump's failure: as the loop nears saturation the suction head left above the
    // vapour pressure falls below what the pump needs, it cavitates and loses its head.
    id: "coolant-boiling",
    name: "Coolant boiling & pump cavitation",
    fault:
      "Fouled steam generator (0.1 MW/K instead of 60 MW/K) and a primary pump rated for 300 kg/s.",
    expectedFailureType: "coolant_boiling",
    withinSec: 600,
    build: reference({
      omit: ["interlock", "wall-sensor"],
      parameterOverrides: {
        pump: { ratedMassFlowKgS: 300 },
        "steam-gen": { secondaryConductanceWK: 1e5 },
      },
    }),
  },
  {
    id: "structural-collapse",
    name: "Structural collapse",
    fault: "Annealed copper columns under a 110 t loaded chamber.",
    expectedFailureType: "yield_exceeded",
    withinSec: 5,
    build: buildOverloadDemo,
  },
  {
    id: "plasma-disruption",
    name: "Plasma disruption",
    fault: "Fuelling target set above the Greenwald density limit.",
    expectedFailureType: "disruption",
    withinSec: 60,
    build: reference({ parameterOverrides: { injector: { targetDensityM3: 2e20 } } }),
  },
  {
    id: "cascade",
    name: "Multi-system cascade",
    fault: "Primary pump switched off, wall interlock removed, thin first wall.",
    expectedFailureType: "disruption",
    withinSec: 400,
    build: reference(
      {
        omit: ["interlock", "wall-sensor"],
        parameterOverrides: { pump: { enabled: false } },
      },
      true,
    ),
  },
]);

export function buildScenario(id: string): SimulationWorld {
  const scenario = SHOWROOM_SCENARIOS.find((s) => s.id === id);
  if (scenario === undefined) throw new Error(`Unknown showroom scenario "${id}".`);
  const world = new SimulationWorld({ name: scenario.name });
  scenario.build(world);
  return world;
}
