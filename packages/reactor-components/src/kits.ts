import { SimulationWorld } from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import { placePart } from "./designs.js";

/**
 * Kits: ready-made assemblies of ordinary catalogue parts, joined with ordinary
 * connections. A kit is placed as a group and can be taken apart to its parts at any time;
 * nothing about it is special to the simulation. None is tuned to work: each is whatever
 * sim-core computes for those parts in that arrangement.
 */
export interface Kit {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Builds the kit's parts around the origin (footprint centre at x = z = 0). */
  build(): SimulationWorld;
}

function kit(name: string, build: (world: SimulationWorld) => void): SimulationWorld {
  const world = new SimulationWorld({ name });
  build(world);
  return world;
}

function join(world: SimulationWorld, from: [string, string], to: [string, string]): void {
  world.connect(
    { componentId: from[0], connectionPointId: from[1] },
    { componentId: to[0], connectionPointId: to[1] },
  );
}

/** One blanket module: shield block with its first-wall panel bolted on and cooled in series. */
export function buildBlanketModule(world: SimulationWorld, prefix = ""): void {
  const block = `${prefix}shield-block`;
  const panel = `${prefix}first-wall`;
  placePart(world, "shield-block", { id: block, position: vec3(0, 0.5, 0) });
  placePart(world, "first-wall-panel", { id: panel, position: vec3(0, 0.5, 0.265) });
  join(world, [panel, "shield"], [block, "first-wall"]);
  join(world, [block, "fw-supply"], [panel, "coolant-in"]);
  join(world, [panel, "coolant-out"], [block, "fw-return"]);
}

export const KITS: readonly Kit[] = Object.freeze([
  {
    id: "blanket-module",
    name: "Blanket Module",
    description:
      "Shield block with a beryllium-armoured first-wall panel bolted to its front, cooled in series. Line a tokamak with them (radial array), or take one apart.",
    build: () => kit("Blanket Module", (w) => buildBlanketModule(w)),
  },
  {
    id: "primary-coolant-loop",
    name: "Primary Coolant Loop",
    description:
      "Pump, supply and return pipes and a steam generator in a closed loop. Break the loop and connect its ends to whatever needs cooling.",
    build: () =>
      kit("Primary Coolant Loop", (w) => {
        placePart(w, "coolant-pump", { id: "pump", position: vec3(-6, 1, 0) });
        placePart(w, "coolant-pipe", { id: "pipe-supply", position: vec3(-2, 0.39, 0) });
        placePart(w, "coolant-pipe", { id: "pipe-return", position: vec3(-10, 0.39, 0) });
        placePart(w, "steam-generator", { id: "steam-gen", position: vec3(8, 4, -2) });
        join(w, ["pump", "outlet"], ["pipe-supply", "a"]);
        join(w, ["pipe-supply", "b"], ["steam-gen", "primary-in"]);
        join(w, ["steam-gen", "primary-out"], ["pipe-return", "b"]);
        join(w, ["pipe-return", "a"], ["pump", "inlet"]);
      }),
  },
  {
    id: "power-conversion",
    name: "Turbine–Generator Package",
    description:
      "Steam turbine on a shaft to a generator. Feed it steam from a steam generator and connect the generator to a bus.",
    build: () =>
      kit("Turbine–Generator Package", (w) => {
        placePart(w, "steam-turbine", { id: "turbine", position: vec3(-4, 2, 0) });
        placePart(w, "generator", { id: "generator", position: vec3(4, 2, 0) });
        join(w, ["turbine", "shaft"], ["generator", "shaft"]);
      }),
  },
  {
    id: "protected-feed",
    name: "Protected Power Feed",
    description:
      "Grid connection through a breaker, with a temperature sensor and an interlock that opens the breaker above its setpoint. Wire the sensor to what it should watch.",
    build: () =>
      kit("Protected Power Feed", (w) => {
        placePart(w, "grid-connection", { id: "grid", position: vec3(-4, 1.2, 0) });
        placePart(w, "breaker", { id: "breaker", position: vec3(0, 0.8, 0) });
        placePart(w, "sensor", { id: "sensor", position: vec3(3, 0.15, 1.5) });
        placePart(w, "interlock", {
          id: "interlock",
          position: vec3(3, 0.9, -1.5),
          parameters: { setpoint: 420, comparison: "above", action: "open-breakers" },
        });
        join(w, ["grid", "power"], ["breaker", "line"]);
        join(w, ["interlock", "signal"], ["sensor", "signal"]);
        join(w, ["interlock", "signal"], ["breaker", "control"]);
      }),
  },
  {
    id: "battery-rack",
    name: "Battery Rack (NMC)",
    description:
      "Four NMC modules stacked on a steel deck. Heat one past its runaway trigger and watch whether the next follows.",
    build: () =>
      kit("Battery Rack (NMC)", (w) => {
        placePart(w, "structural-platform", {
          id: "deck",
          position: vec3(0, 0.1, 0),
          dimensions: { spanM: 2, depthM: 0.2, plateM: 0.012 },
        });
        for (let i = 0; i < 4; i += 1) {
          placePart(w, "battery-module-nmc", {
            id: `module-${i + 1}`,
            position: vec3(0, 0.325 + i * 0.25, 0),
          });
          join(w, [`module-${i + 1}`, "base"], i === 0 ? ["deck", "top"] : [`module-${i}`, "top"]);
        }
      }),
  },
]);

export function findKit(id: string): Kit | undefined {
  return KITS.find((k) => k.id === id);
}
