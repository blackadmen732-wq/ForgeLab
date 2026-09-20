import { MaterialIds } from "@forgelab/materials";
import { type Vec3, vec3 } from "@forgelab/shared";
import { boxGeometry, cylinderGeometry, type ComponentSpec } from "@forgelab/sim-core";
import {
  buildConnectionPoints,
  type ComponentDefinition,
  type PlacementOptions,
  type SocketTemplate,
} from "./definition.js";

/**
 * The four components Milestone 0 ships.
 *
 * Every dimension below is a plain engineering choice stated in metres, not a tuned game
 * number: a 4 m beam with a 200 mm square section, a 6 m platform deck 200 mm thick, a
 * 3 m tall vessel with a 50 mm wall. Mass, capacity and stress all follow from these and
 * from the material, so changing a dimension changes the physics consistently.
 */

const BEAM_LENGTH_M = 4;
const BEAM_SECTION_M = 0.15;
const BEAM_WALL_M = 0.008;
const PLATFORM_SPAN_M = 6;
const PLATFORM_THICKNESS_M = 0.2;
const PLATFORM_PLATE_M = 0.012;
const PLATFORM_CORNER_INSET_M = 0.3;
const CHAMBER_RADIUS_M = 1.5;
const CHAMBER_HEIGHT_M = 3;
const CHAMBER_WALL_M = 0.05;
const EQUIPMENT_SIZE_M = 1;

/**
 * Structural Beam — a 150 x 150 x 8 mm square hollow section, 4 m long, lying along its
 * local X axis. That is a standard stocked profile, and a hollow section rather than a
 * solid bar because nobody builds frames out of 150 mm solid steel: the solid version
 * would weigh six times as much and every load below it would be wrong to match.
 *
 * Sockets sit on both ends and on the mid-span top and bottom faces, so the same part
 * works as a horizontal spanning beam or, rotated upright, as a column.
 */
export const STRUCTURAL_BEAM: ComponentDefinition = {
  type: "structural-beam",
  name: "Structural Beam",
  description:
    "150 x 150 x 8 mm square hollow section, 4 m long. Spans horizontally or stands as a column when rotated.",
  defaultMaterialId: MaterialIds.StructuralSteel,
  nominalSizeM: vec3(BEAM_LENGTH_M, BEAM_SECTION_M, BEAM_SECTION_M),
  createSpec(options: PlacementOptions): ComponentSpec {
    const geometry = boxGeometry(vec3(BEAM_LENGTH_M, BEAM_SECTION_M, BEAM_SECTION_M), BEAM_WALL_M);
    const materialId = options.materialId ?? MaterialIds.StructuralSteel;
    const half = BEAM_LENGTH_M / 2;
    const halfSection = BEAM_SECTION_M / 2;

    const sockets: SocketTemplate[] = [
      structural("end-a", vec3(-half, 0, 0), vec3(-1, 0, 0)),
      structural("end-b", vec3(half, 0, 0), vec3(1, 0, 0)),
      structural("top", vec3(0, halfSection, 0), vec3(0, 1, 0)),
      structural("bottom", vec3(0, -halfSection, 0), vec3(0, -1, 0)),
    ];

    return spec(options, "structural-beam", geometry, materialId, sockets);
  },
};

/**
 * Structural Platform — a 6 m square deck, 200 mm deep, built as a 12 mm plate box rather
 * than a solid slab. At 200 kg/m2 that is a plausible heavy industrial deck; a solid
 * 200 mm steel slab of the same footprint would be 56 tonnes and would dominate every
 * load case it appeared in.
 *
 * One socket on the top face to receive equipment, and four inset corner sockets
 * underneath so it can rest on legs. The corner spacing is what gives the load-splitting
 * lever arms something real to work with.
 */
export const STRUCTURAL_PLATFORM: ComponentDefinition = {
  type: "structural-platform",
  name: "Structural Platform",
  description:
    "6 m square deck, 200 mm deep in 12 mm plate, with four inset corner mounts underneath and a central mount on top.",
  defaultMaterialId: MaterialIds.StructuralSteel,
  nominalSizeM: vec3(PLATFORM_SPAN_M, PLATFORM_THICKNESS_M, PLATFORM_SPAN_M),
  createSpec(options: PlacementOptions): ComponentSpec {
    const geometry = boxGeometry(
      vec3(PLATFORM_SPAN_M, PLATFORM_THICKNESS_M, PLATFORM_SPAN_M),
      PLATFORM_PLATE_M,
    );
    const materialId = options.materialId ?? MaterialIds.StructuralSteel;
    const halfThickness = PLATFORM_THICKNESS_M / 2;
    const corner = PLATFORM_SPAN_M / 2 - PLATFORM_CORNER_INSET_M;

    const sockets: SocketTemplate[] = [
      structural("top", vec3(0, halfThickness, 0), vec3(0, 1, 0)),
      structural("bottom-nx-nz", vec3(-corner, -halfThickness, -corner), vec3(0, -1, 0)),
      structural("bottom-nx-pz", vec3(-corner, -halfThickness, corner), vec3(0, -1, 0)),
      structural("bottom-px-nz", vec3(corner, -halfThickness, -corner), vec3(0, -1, 0)),
      structural("bottom-px-pz", vec3(corner, -halfThickness, corner), vec3(0, -1, 0)),
    ];

    return spec(options, "structural-platform", geometry, materialId, sockets);
  },
};

/**
 * Generic Reactor Chamber — a stainless vessel, 3 m tall, 1.5 m radius, 50 mm wall.
 *
 * It is a shell, not a billet: a solid cylinder of this size would weigh about 170 t and
 * every structural result downstream would be wrong by roughly an order of magnitude.
 * `additionalMassKg` is where its contents go until ForgeLab models them.
 */
export const REACTOR_CHAMBER: ComponentDefinition = {
  type: "reactor-chamber",
  name: "Generic Reactor Chamber",
  description:
    "Cylindrical pressure vessel shell, 3 m tall and 1.5 m in radius with a 50 mm wall. A generic container; it has no reactor physics yet.",
  defaultMaterialId: MaterialIds.StainlessSteel,
  nominalSizeM: vec3(CHAMBER_RADIUS_M * 2, CHAMBER_HEIGHT_M, CHAMBER_RADIUS_M * 2),
  createSpec(options: PlacementOptions): ComponentSpec {
    const geometry = cylinderGeometry(CHAMBER_RADIUS_M, CHAMBER_HEIGHT_M, "y", CHAMBER_WALL_M);
    const materialId = options.materialId ?? MaterialIds.StainlessSteel;
    const halfHeight = CHAMBER_HEIGHT_M / 2;

    const sockets: SocketTemplate[] = [
      structural("base", vec3(0, -halfHeight, 0), vec3(0, -1, 0)),
      structural("top", vec3(0, halfHeight, 0), vec3(0, 1, 0)),
      mount("port-nx", vec3(-CHAMBER_RADIUS_M, 0, 0), vec3(-1, 0, 0)),
      mount("port-px", vec3(CHAMBER_RADIUS_M, 0, 0), vec3(1, 0, 0)),
      mount("port-nz", vec3(0, 0, -CHAMBER_RADIUS_M), vec3(0, 0, -1)),
      mount("port-pz", vec3(0, 0, CHAMBER_RADIUS_M), vec3(0, 0, 1)),
    ];

    return spec(options, "reactor-chamber", geometry, materialId, sockets);
  },
};

/**
 * Generic Equipment Block — a 1 m aluminium cube standing in for pumps, drives and
 * cabinets until those exist as real components.
 */
export const EQUIPMENT_BLOCK: ComponentDefinition = {
  type: "equipment-block",
  name: "Generic Equipment Block",
  description:
    "1 m cube standing in for an unspecified piece of plant. Has mass and occupies space; nothing else yet.",
  defaultMaterialId: MaterialIds.Aluminum,
  nominalSizeM: vec3(EQUIPMENT_SIZE_M, EQUIPMENT_SIZE_M, EQUIPMENT_SIZE_M),
  createSpec(options: PlacementOptions): ComponentSpec {
    const geometry = boxGeometry(vec3(EQUIPMENT_SIZE_M, EQUIPMENT_SIZE_M, EQUIPMENT_SIZE_M));
    const materialId = options.materialId ?? MaterialIds.Aluminum;
    const half = EQUIPMENT_SIZE_M / 2;

    const sockets: SocketTemplate[] = [
      structural("bottom", vec3(0, -half, 0), vec3(0, -1, 0)),
      structural("top", vec3(0, half, 0), vec3(0, 1, 0)),
      mount("side-nx", vec3(-half, 0, 0), vec3(-1, 0, 0)),
      mount("side-px", vec3(half, 0, 0), vec3(1, 0, 0)),
      mount("side-nz", vec3(0, 0, -half), vec3(0, 0, -1)),
      mount("side-pz", vec3(0, 0, half), vec3(0, 0, 1)),
    ];

    return spec(options, "equipment-block", geometry, materialId, sockets);
  },
};

/** Catalogue in a fixed order. The workspace palette renders it as given. */
export const COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = Object.freeze([
  STRUCTURAL_BEAM,
  STRUCTURAL_PLATFORM,
  REACTOR_CHAMBER,
  EQUIPMENT_BLOCK,
]);

const BY_TYPE = new Map(COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition]));

export function findComponentDefinition(type: string): ComponentDefinition | undefined {
  return BY_TYPE.get(type);
}

export function getComponentDefinition(type: string): ComponentDefinition {
  const definition = BY_TYPE.get(type);
  if (definition === undefined) {
    const known = COMPONENT_DEFINITIONS.map((d) => d.type).join(", ");
    throw new Error(`Unknown component type "${type}". Known types: ${known}.`);
  }
  return definition;
}

function structural(id: string, localPosition: Vec3, localDirection: Vec3): SocketTemplate {
  return { id, localPosition, localDirection, connectionType: "structural", derivedCapacity: true };
}

function mount(id: string, localPosition: Vec3, localDirection: Vec3): SocketTemplate {
  return { id, localPosition, localDirection, connectionType: "mount", derivedCapacity: false };
}

function spec(
  options: PlacementOptions,
  type: string,
  geometry: ReturnType<typeof boxGeometry> | ReturnType<typeof cylinderGeometry>,
  materialId: string,
  sockets: readonly SocketTemplate[],
): ComponentSpec {
  return {
    id: options.id,
    type,
    geometry,
    materialId,
    connectionPoints: buildConnectionPoints(sockets, geometry, materialId),
    ...(options.transform === undefined ? {} : { transform: options.transform }),
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.anchored === undefined ? {} : { anchored: options.anchored }),
    ...(options.additionalMassKg === undefined
      ? {}
      : { additionalMassKg: options.additionalMassKg }),
  };
}
