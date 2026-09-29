import {
  buildBenchmark,
  buildOverloadDemo,
  buildReferencePlant,
  buildStarterAssembly,
  getComponentDefinition,
} from "@forgelab/reactor-components";
import { SimulationWorld } from "@forgelab/sim-core";

/**
 * Optional starting points. The default workspace is empty; these are blueprints a player
 * may choose to load. None is tuned to succeed or fail — each is whatever sim-core computes.
 */
export interface Blueprint {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly size: string;
  build(): SimulationWorld;
}

function world(name: string, build: (world: SimulationWorld) => void): SimulationWorld {
  const w = new SimulationWorld({ name });
  build(w);
  w.solve();
  return w;
}

/**
 * The interactive starter: the reference plant with its primary pump switched off and a
 * 20 mm first wall, so the consequence shows up within a few simulated minutes. The
 * onboarding hints walk the player through running it, reading the failure chain, and
 * fixing it.
 */
export function buildInteractiveStarter(): SimulationWorld {
  return world("My First Plant", (w) => {
    buildReferencePlant(w, { parameterOverrides: { pump: { enabled: false } } });
    const vessel = w.requireComponent("vessel");
    const { geometry, connectionPoints } = getComponentDefinition("tokamak-vessel").reshape(
      { majorRadiusM: 6.2, tubeRadiusM: 2.3, wallM: 0.02 },
      vessel.materialId,
    );
    w.reshapeComponent("vessel", geometry, connectionPoints);
  });
}

export const BLUEPRINTS: readonly Blueprint[] = [
  {
    id: "reference-plant",
    name: "Reference tokamak plant",
    description:
      "An ITER-class tokamak with blanket, superconducting coils, heating, a water loop, steam cycle, generator and grid. It burns D-T — improving its net output is up to you.",
    size: "16 parts",
    build: () => world("Reference Tokamak Plant", (w) => buildReferencePlant(w)),
  },
  {
    id: "starter-rig",
    name: "Structural rig",
    description:
      "A steel platform on four legs carrying an empty chamber, plus a loose equipment block.",
    size: "7 parts",
    build: () => world("Structural Rig", buildStarterAssembly),
  },
  {
    id: "overload-demo",
    name: "Overload demo",
    description:
      "The same rig on copper legs under a filled vessel. It fails — find out why and fix it.",
    size: "6 parts",
    build: () => world("Overload Demo", buildOverloadDemo),
  },
  {
    id: "benchmark",
    name: "Benchmark lattice",
    description:
      "64 platforms on 256 legs with 64 blocks: a performance test for the viewport and solver.",
    size: "384 parts",
    build: () => world("Benchmark Lattice", (w) => buildBenchmark(w, 8)),
  },
];
