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
 * A square hollow-section steel sleeper on the floor under each coolant pipe, carrying it
 * at the pump's nozzle height. Added after every other join so existing connection ids hold.
 */
function pipeSleepers(
  world: SimulationWorld,
  pipes: readonly string[],
  has: (id: string) => boolean,
): void {
  for (const pipe of pipes) {
    const component = has(pipe) ? world.getComponent(pipe) : undefined;
    if (component?.geometry.kind !== "cylinder") continue;
    const position = component.transform.positionM;
    const sectionM = position.y - component.geometry.radiusM;
    placePart(world, "structural-beam", {
      id: `${pipe}-sleeper`,
      label: "Pipe Sleeper",
      transform: transform(
        vec3(position.x, sectionM / 2, position.z),
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
      ),
      dimensions: { lengthM: 1.2, sectionM, wallM: 0.012 },
    });
    link(world, [`${pipe}-sleeper`, "top"], [pipe, "bottom"]);
  }
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
  // Pipes run at the pump's nozzle height so each joins it with one straight spool.
  put("coolant-pipe", "pipe-hot", vec3(-2, 1, -16), { label: "Supply Pipe" });
  put("coolant-pipe", "pipe-cold", vec3(-10, 1, -16), { label: "Return Pipe" });
  // Primary nozzles face back toward the coolant loop, away from the turbine's inlet.
  put("steam-generator", "steam-gen", vec3(8, 4, -18), {
    label: "Steam Generator",
    transform: transform(vec3(8, 4, -18), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI)),
  });
  join(["pump", "outlet"], ["pipe-hot", "a"]);
  join(["pipe-hot", "b"], ["vessel", "coolant-in"]);
  join(["vessel", "coolant-out"], ["blanket", "coolant-in"]);
  join(["blanket", "coolant-out"], ["steam-gen", "primary-in"]);
  join(["steam-gen", "primary-out"], ["pipe-cold", "a"]);
  join(["pipe-cold", "b"], ["pump", "inlet"]);

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
  pipeSleepers(world, ["pipe-hot", "pipe-cold"], has);

  world.solve();
}

/* ------------------------------------------------------------------------------------ *
 * ITER-class plant at true scale
 * ------------------------------------------------------------------------------------ */

/** Plasma centre height of the ITER-class plant: the core stands on 4 m gravity supports. */
export const ITER_CLASS_CENTRE_Y = 8.35;

/**
 * Poloidal-field coils as (ring radius, height above the plasma centre), m — ITER's six
 * PF coils, approximately (ITER Design Description). They sit outside this plant's
 * circular-section TF set.
 */
const PF_LAYOUT: readonly [string, number, number][] = [
  ["pf1", 3.9, 7.5],
  ["pf2", 8.4, 6.5],
  ["pf3", 12, 3.3],
  ["pf4", 12, -2.2],
  ["pf5", 8.4, -6.7],
  ["pf6", 4.4, -7.6],
];

/**
 * The reference plant's machine at true scale, with what surrounds it in a real hall: the
 * tokamak core standing on four steel gravity supports, six poloidal-field coils and a
 * central solenoid, a 29 m cryostat around it all, and the heating, fuelling, pumping,
 * cooling, power-conversion and electrical plant outside its wall, with a maintenance
 * platform and stairs. Every piece is a catalogue part; nothing is decoration.
 *
 * The PF coils and central solenoid are pinned in place: in a real machine they are clamped
 * to the TF coil cases, which ForgeLab does not model yet. Not tuned to succeed or fail.
 */
export function buildIterClassPlant(world: SimulationWorld): void {
  const c = ITER_CLASS_CENTRE_Y;
  const put = (type: string, id: string, label: string, extra: Partial<PlaceOptions> = {}) =>
    placePart(world, type, { id, label, ...extra });
  const join = (from: [string, string], to: [string, string]) => link(world, from, to);

  // The core: TF set, blanket and vessel nested on one centre, on gravity supports.
  put("tf-coil-set", "tf-coils", "TF Coil Set", { position: vec3(0, c, 0) });
  put("breeding-blanket", "blanket", "Breeding Blanket", { position: vec3(0, c, 0) });
  put("tokamak-vessel", "vessel", "Vacuum Vessel", { position: vec3(0, c, 0) });
  const tubeRadius = 4.35;
  const supportM = c - tubeRadius;
  for (const [suffix, x, z] of [
    ["px", 6.2, 0],
    ["nx", -6.2, 0],
    ["pz", 0, 6.2],
    ["nz", 0, -6.2],
  ] as const) {
    join(["blanket", `foot-${suffix}`], ["tf-coils", `cradle-${suffix}`]);
    join(["vessel", `foot-${suffix}`], ["blanket", `cradle-${suffix}`]);
    const id = `support-${suffix}`;
    put("structural-beam", id, `Gravity Support ${suffix.toUpperCase()}`, {
      transform: transform(vec3(x, supportM / 2, z), UPRIGHT),
      dimensions: { lengthM: supportM, sectionM: 1.2, wallM: 0.05 },
    });
    join([id, "end-b"], ["tf-coils", `foot-${suffix}`]);
  }

  // Poloidal-field coils and the central solenoid (pinned: see above).
  for (const [id, ringRadiusM, dz] of PF_LAYOUT) {
    put("pf-coil", id, id.toUpperCase(), {
      position: vec3(0, c + dz, 0),
      dimensions: { ringRadiusM, windingRadiusM: 0.5, wallM: 0.1 },
    });
    world.setAnchored(id, true);
  }
  put("central-solenoid", "cs", "Central Solenoid", { position: vec3(0, c, 0) });
  world.setAnchored("cs", true);

  // The cryostat around the whole machine.
  put("cryostat", "cryostat", "Cryostat", { position: vec3(0, 13, 0) });

  // Heating, fuelling and pumping outside the cryostat wall.
  put("neutral-beam", "nbi", "Neutral Beam", {
    transform: transform(
      vec3(0, 1.2, 22),
      QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
    ),
  });
  put("fuel-injector", "injector", "Fuel Injector", { position: vec3(-20, 0.7, 6) });
  put("vacuum-pump", "cryopump", "Cryopump Bank", { position: vec3(20, 1, 6) });
  join(["nbi", "port"], ["vessel", "heating"]);
  join(["injector", "fuel"], ["vessel", "fuel"]);
  join(["cryopump", "vacuum"], ["vessel", "vacuum"]);

  // Primary coolant loop and power conversion, north of the cryostat.
  put("coolant-pump", "pump", "Primary Pump", { position: vec3(-10, 1, -24) });
  put("coolant-pipe", "pipe-hot", "Supply Pipe", { position: vec3(-6, 1, -24) });
  put("coolant-pipe", "pipe-cold", "Return Pipe", { position: vec3(-14, 1, -24) });
  put("steam-generator", "steam-gen", "Steam Generator", {
    transform: transform(vec3(10, 4, -26), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI)),
  });
  put("steam-turbine", "turbine", "Steam Turbine", { position: vec3(24, 2, -26) });
  put("generator", "generator", "Generator", { position: vec3(32, 2, -26) });
  join(["pump", "outlet"], ["pipe-hot", "a"]);
  join(["pipe-hot", "b"], ["vessel", "coolant-in"]);
  join(["vessel", "coolant-out"], ["blanket", "coolant-in"]);
  join(["blanket", "coolant-out"], ["steam-gen", "primary-in"]);
  join(["steam-gen", "primary-out"], ["pipe-cold", "a"]);
  join(["pipe-cold", "b"], ["pump", "inlet"]);
  join(["steam-gen", "steam"], ["turbine", "steam"]);
  join(["turbine", "shaft"], ["generator", "shaft"]);

  // Electrical: grid and generator feed the bus that feeds every load, magnets included.
  put("grid-connection", "grid", "Grid Connection", { position: vec3(30, 1.2, 14) });
  put("bus-bar", "bus", "Main Bus", { position: vec3(24, 0.05, 14) });
  join(["grid", "power"], ["bus", "b"]);
  join(["generator", "power"], ["bus", "b"]);
  for (const id of [
    "nbi",
    "injector",
    "cryopump",
    "pump",
    "tf-coils",
    "cs",
    ...PF_LAYOUT.map((p) => p[0]),
  ])
    join([id, "power"], ["bus", "a"]);

  // Protection: shut the plasma down if the vessel wall passes 900 K.
  put("sensor", "wall-sensor", "Wall Temperature Sensor", { position: vec3(18, 0.15, -12) });
  put("interlock", "interlock", "Wall Interlock", {
    position: vec3(18, 0.9, -15),
    parameters: { setpoint: 900, comparison: "above", action: "shutdown-plasma" },
  });
  join(["wall-sensor", "signal"], ["vessel", "sensor"]);
  join(["interlock", "signal"], ["wall-sensor", "signal"]);
  join(["interlock", "signal"], ["nbi", "control"]);
  join(["interlock", "signal"], ["injector", "control"]);

  // A maintenance platform by the neutral-beam line, reached by a stair tower.
  const deckTop = 8;
  put("structural-platform", "platform", "Maintenance Platform", {
    position: vec3(12, deckTop - 0.1, 20),
  });
  for (const [socket, dx, dz] of PLATFORM_CORNERS) {
    const leg = `platform-${socket}`;
    put("structural-beam", leg, "Platform Column", {
      transform: transform(vec3(12 + dx, (deckTop - 0.2) / 2, 20 + dz), UPRIGHT),
      dimensions: { lengthM: deckTop - 0.2, sectionM: 0.3, wallM: 0.012 },
    });
    join(["platform", socket], [leg, "end-b"]);
  }
  put("stair-tower", "stairs", "Stair Tower", {
    position: vec3(16.5, (deckTop - 0.2) / 2, 20),
    dimensions: { heightM: deckTop - 0.2, widthM: 3, runM: 6 },
  });
  pipeSleepers(world, ["pipe-hot", "pipe-cold"], (id) => world.getComponent(id) !== undefined);

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

/* ------------------------------------------------------------------------------------ *
 * The tokamak building: concrete wings of rooms and storeys beside the machine
 * ------------------------------------------------------------------------------------ */

export interface TokamakBuildingOptions {
  /** Centre of each wing's footprint, x (m). Default: one wing either side of the machine. */
  readonly wingCentresX?: readonly number[];
  /** Bays per side of a wing (each bay is one slab). */
  readonly bays?: number;
  readonly storeys?: number;
  /** Slab span (square), depth and clear storey height, m. */
  readonly spanM?: number;
  readonly slabDepthM?: number;
  readonly storeyHeightM?: number;
  readonly columnSectionM?: number;
}

/**
 * Concrete wings beside the machine, like the galleries of ITER's tokamak building: each
 * storey is a grid of Floor Slabs on concrete columns, each bay divided into two rooms by
 * a Concrete Wall, and the side facing the camera left open (a cutaway). Every piece is a
 * catalogue part joined by real connections, so the structure stands or cracks by its own
 * physics, and its walls and slabs block heat and fire between rooms and levels.
 *
 * The defaults (8 m bays, 0.8 m plain-concrete slabs, 1.4 m columns, 6 m storeys) are a
 * design choice: the solver bends each slab as a beam between its outermost bearings and
 * holds plain concrete to its tensile strength, so 12 m bays of 0.6 m slabs crack and
 * 0.7 m columns buckle under three storeys. That is the physics, not a tuning.
 */
export function buildTokamakBuilding(
  world: SimulationWorld,
  options: TokamakBuildingOptions = {},
): void {
  const wings = options.wingCentresX ?? [-46, 46];
  const bays = options.bays ?? 2;
  const storeys = options.storeys ?? 3;
  const span = options.spanM ?? 8;
  const depth = options.slabDepthM ?? 0.8;
  const height = options.storeyHeightM ?? 6;
  const section = options.columnSectionM ?? 1.4;
  const inset = Math.min(0.3, span / 10);
  const corner = span / 2 - inset;
  const corners = [
    ["nx-nz", -corner, -corner],
    ["nx-pz", -corner, corner],
    ["px-nz", corner, -corner],
    ["px-pz", corner, corner],
  ] as const;

  wings.forEach((wx, w) => {
    for (let i = 0; i < bays; i += 1)
      for (let j = 0; j < bays; j += 1) {
        const x = wx + (i - (bays - 1) / 2) * span;
        const z = (j - (bays - 1) / 2) * span;
        let below: string | null = null;
        let floorM = 0;
        for (let s = 0; s < storeys; s += 1) {
          const tag = `w${w}-b${i}${j}-s${s}`;
          const slab = `slab-${tag}`;
          const slabCentreY = floorM + height + depth / 2;
          placePart(world, "concrete-slab", {
            id: slab,
            label: `Floor Slab L${s + 1}`,
            position: vec3(x, slabCentreY, z),
            dimensions: { spanXM: span, spanZM: span, depthM: depth },
          });
          for (const [suffix, dx, dz] of corners) {
            const column = `column-${tag}-${suffix}`;
            placePart(world, "structural-beam", {
              id: column,
              label: `Column L${s + 1}`,
              materialId: MaterialIds.Concrete,
              transform: transform(vec3(x + dx, floorM + height / 2, z + dz), UPRIGHT),
              dimensions: { lengthM: height, sectionM: section, wallM: section / 2.5 },
            });
            link(world, [slab, `bottom-${suffix}`], [column, "end-b"]);
            if (below !== null) link(world, [column, "end-a"], [below, `top-${suffix}`]);
          }
          // A wall across the bay, standing on this storey's floor (the ground, or the slab
          // below), makes two rooms on this level.
          const wall = `wall-${tag}`;
          const wallHeight = height - 0.05;
          placePart(world, "concrete-wall", {
            id: wall,
            label: `Room Wall L${s + 1}`,
            transform: transform(
              vec3(x, floorM + wallHeight / 2, z),
              QuaternionMath.fromAxisAngle(vec3(0, 1, 0), (i + j) % 2 === 0 ? 0 : Math.PI / 2),
            ),
            dimensions: {
              lengthM: span - 2 * inset - section,
              heightM: wallHeight,
              thicknessM: 0.3,
            },
          });
          if (below !== null) link(world, [wall, "base"], [below, "top"]);
          below = slab;
          floorM = slabCentreY + depth / 2;
        }
      }
  });
}
