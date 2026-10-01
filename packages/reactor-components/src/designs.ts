import { MaterialIds, type MaterialId } from "@forgelab/materials";
import { QuaternionMath, type Transform, type Vec3, transform, vec3 } from "@forgelab/shared";
import type { SimulationWorld } from "@forgelab/sim-core";
import { getComponentDefinition } from "./builtin.js";

/**
 * Ready-made designs built only from catalogue parts: the onboarding starter, the
 * structural overload demo, a complete reference fusion plant and a large benchmark.
 *
 * None of them is tuned to pass or fail. The reference plant uses ITER-class presets and
 * whatever it produces is what sim-core computes; players are expected to improve it.
 */

interface PlaceOptions {
  readonly id: string;
  readonly position?: Vec3;
  readonly transform?: Transform;
  readonly materialId?: MaterialId;
  readonly additionalMassKg?: number;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly dimensions?: Readonly<Record<string, number>>;
  readonly label?: string;
}

export function placePart(world: SimulationWorld, type: string, options: PlaceOptions): void {
  const definition = getComponentDefinition(type);
  world.addComponent(
    definition.createSpec({
      id: options.id,
      transform: options.transform ?? transform(options.position ?? vec3(0, 0, 0)),
      ...(options.materialId === undefined ? {} : { materialId: options.materialId }),
      ...(options.additionalMassKg === undefined
        ? {}
        : { additionalMassKg: options.additionalMassKg }),
      ...(options.parameters === undefined ? {} : { parameters: options.parameters }),
      ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
      label: options.label ?? definition.name,
    }),
  );
}

function link(
  world: SimulationWorld,
  from: [string, string],
  to: [string, string],
  id?: string,
): void {
  world.connect(
    { componentId: from[0], connectionPointId: from[1] },
    { componentId: to[0], connectionPointId: to[1] },
    id === undefined ? {} : { id },
  );
}

/* ------------------------------------------------------------------------------------ *
 * Structural demos (Milestone 0 scenes)
 * ------------------------------------------------------------------------------------ */

const PLATFORM_CORNERS = [
  ["bottom-nx-nz", -2.7, -2.7],
  ["bottom-nx-pz", -2.7, 2.7],
  ["bottom-px-nz", 2.7, -2.7],
  ["bottom-px-pz", 2.7, 2.7],
] as const;

const UPRIGHT = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);

function buildRig(
  world: SimulationWorld,
  legMaterialId: MaterialId,
  chamberContentsKg: number,
): void {
  placePart(world, "structural-platform", { id: "platform", position: vec3(0, 4.1, 0) });
  for (const [socket, x, z] of PLATFORM_CORNERS) {
    const legId = `leg-${socket}`;
    placePart(world, "structural-beam", {
      id: legId,
      transform: transform(vec3(x, 2, z), UPRIGHT),
      materialId: legMaterialId,
    });
    link(world, ["platform", socket], [legId, "end-b"]);
  }
  placePart(world, "reactor-chamber", {
    id: "chamber",
    position: vec3(0, 5.7, 0),
    additionalMassKg: chamberContentsKg,
  });
  link(world, ["chamber", "base"], ["platform", "top"]);
}

/** A steel rig carrying an empty chamber, plus a loose equipment block. Within capacity. */
export function buildStarterAssembly(world: SimulationWorld): void {
  buildRig(world, MaterialIds.StructuralSteel, 0);
  placePart(world, "equipment-block", { id: "equipment", position: vec3(6, 0.5, 4) });
  world.solve();
}

/**
 * The same rig with copper legs under 110 t of vessel contents. Copper's 69 MPa annealed
 * yield is simply the wrong material for these columns; nothing is tuned.
 */
export function buildOverloadDemo(world: SimulationWorld): void {
  buildRig(world, MaterialIds.Copper, 110_000);
  world.solve();
}

/* ------------------------------------------------------------------------------------ *
 * Reference tokamak power plant
 * ------------------------------------------------------------------------------------ */

/** Height of the torus centres: the TF coil set (tube radius 4.35 m) rests on the ground. */
export const TOKAMAK_CENTRE_Y = 4.35;

export interface ReferencePlantOptions {
  /** Leave out parts to build a partial plant (used by onboarding and tests). */
  readonly omit?: readonly string[];
  readonly parameterOverrides?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * A complete tokamak power plant: vessel inside a breeding blanket inside a
 * superconducting TF coil set; neutral-beam heating, fuelling and cryopumps; a pressurised
 * water loop through vessel, blanket and a steam generator; a turbine-generator; a grid
 * connection; and a temperature interlock on the vessel.
 */
export function buildReferencePlant(
  world: SimulationWorld,
  options: ReferencePlantOptions = {},
): void {
  const omit = new Set(options.omit ?? []);
  const overrides = options.parameterOverrides ?? {};
  const put = (type: string, id: string, position: Vec3, extra: Partial<PlaceOptions> = {}) => {
    if (omit.has(id)) return;
    placePart(world, type, {
      id,
      position,
      ...extra,
      ...(overrides[id] === undefined
        ? {}
        : { parameters: { ...(extra.parameters ?? {}), ...overrides[id] } }),
    });
  };
  const has = (id: string) => !omit.has(id) && world.getComponent(id) !== undefined;
  const join = (from: [string, string], to: [string, string]) => {
    if (has(from[0]) && has(to[0])) link(world, from, to);
  };

  const c = TOKAMAK_CENTRE_Y;
  put("tf-coil-set", "tf-coils", vec3(0, c, 0), { label: "TF Coil Set" });
  put("breeding-blanket", "blanket", vec3(0, c, 0), { label: "Breeding Blanket" });
  put("tokamak-vessel", "vessel", vec3(0, c, 0), { label: "Vacuum Vessel" });
  for (const suffix of ["px", "nx", "pz", "nz"]) {
    join(["blanket", `foot-${suffix}`], ["tf-coils", `cradle-${suffix}`]);
    join(["vessel", `foot-${suffix}`], ["blanket", `cradle-${suffix}`]);
  }

  // Heating, fuelling, vacuum on the outboard side.
  put("neutral-beam", "nbi", vec3(0, 1.2, 15), {
    label: "Neutral Beam",
    transform: transform(
      vec3(0, 1.2, 15),
      QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
    ),
  });
  put("fuel-injector", "injector", vec3(-14, 0.7, 0), { label: "Fuel Injector" });
  put("vacuum-pump", "cryopump", vec3(14, 1, 3), { label: "Cryopump Bank" });
  join(["nbi", "port"], ["vessel", "heating"]);
  join(["injector", "fuel"], ["vessel", "fuel"]);
  join(["cryopump", "vacuum"], ["vessel", "vacuum"]);

  // Primary coolant loop: pump → pipe → vessel → blanket → steam generator → pipe → pump.
  put("coolant-pump", "pump", vec3(-6, 1, -16), { label: "Primary Pump" });
  put("coolant-pipe", "pipe-hot", vec3(-2, 0.39, -16), { label: "Supply Pipe" });
  put("coolant-pipe", "pipe-cold", vec3(-10, 0.39, -16), { label: "Return Pipe" });
  put("steam-generator", "steam-gen", vec3(8, 4, -18), { label: "Steam Generator" });
  join(["pump", "outlet"], ["pipe-hot", "a"]);
  join(["pipe-hot", "b"], ["vessel", "coolant-in"]);
  join(["vessel", "coolant-out"], ["blanket", "coolant-in"]);
  join(["blanket", "coolant-out"], ["steam-gen", "primary-in"]);
  join(["steam-gen", "primary-out"], ["pipe-cold", "b"]);
  join(["pipe-cold", "a"], ["pump", "inlet"]);

  // Power conversion.
  put("steam-turbine", "turbine", vec3(20, 2, -18), { label: "Steam Turbine" });
  put("generator", "generator", vec3(28, 2, -18), { label: "Generator" });
  join(["steam-gen", "steam"], ["turbine", "steam"]);
  join(["turbine", "shaft"], ["generator", "shaft"]);

  // Electrical: grid and generator feed a bus that feeds every load.
  put("grid-connection", "grid", vec3(22, 1.2, 8), { label: "Grid Connection" });
  put("bus-bar", "bus", vec3(18, 0.05, 4), { label: "Main Bus" });
  join(["grid", "power"], ["bus", "b"]);
  join(["generator", "power"], ["bus", "b"]);
  for (const [id, socket] of [
    ["nbi", "power"],
    ["injector", "power"],
    ["cryopump", "power"],
    ["pump", "power"],
    ["tf-coils", "power"],
  ] as const) {
    join([id, socket], ["bus", "a"]);
  }

  // Protection: shut the plasma down if the vessel wall passes 900 K.
  put("sensor", "wall-sensor", vec3(12, 0.15, -4), { label: "Wall Temperature Sensor" });
  put("interlock", "interlock", vec3(12, 0.9, -6), {
    label: "Wall Interlock",
    parameters: { setpoint: 900, comparison: "above", action: "shutdown-plasma" },
  });
  join(["wall-sensor", "signal"], ["vessel", "sensor"]);
  join(["interlock", "signal"], ["wall-sensor", "signal"]);
  join(["interlock", "signal"], ["nbi", "control"]);
  join(["interlock", "signal"], ["injector", "control"]);

  world.solve();
}

/* ------------------------------------------------------------------------------------ *
 * Benchmark
 * ------------------------------------------------------------------------------------ */

/**
 * A large lattice of platforms, legs and equipment for performance measurement:
 * `bays × bays` platforms on four legs each, with a block on every deck.
 * bays = 8 gives 384 components.
 */
export function buildBenchmark(world: SimulationWorld, bays = 8): void {
  for (let i = 0; i < bays; i += 1) {
    for (let j = 0; j < bays; j += 1) {
      const x = i * 7;
      const z = j * 7;
      const deck = `deck-${i}-${j}`;
      placePart(world, "structural-platform", { id: deck, position: vec3(x, 4.1, z) });
      for (const [socket, dx, dz] of PLATFORM_CORNERS) {
        const leg = `leg-${i}-${j}-${socket}`;
        placePart(world, "structural-beam", {
          id: leg,
          transform: transform(vec3(x + dx, 2, z + dz), UPRIGHT),
        });
        link(world, [deck, socket], [leg, "end-b"]);
      }
      const block = `block-${i}-${j}`;
      placePart(world, "equipment-block", { id: block, position: vec3(x, 4.7, z) });
      link(world, [block, "bottom"], [deck, "top"]);
    }
  }
  world.solve();
}
