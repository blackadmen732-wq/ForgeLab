import { type MaterialId, getMaterial } from "@forgelab/materials";
import { type Newtons, type Transform, type Vec3 } from "@forgelab/shared";
import {
  type ComponentGeometry,
  type ComponentSpec,
  type ConnectionPoint,
  type ConnectionType,
  type PlantRole,
  dominantLocalAxis,
  sectionAreaPerpendicularToLocalAxis,
} from "@forgelab/sim-core";

/** Options a builder supplies when placing one of the catalogue's components. */
export interface PlacementOptions {
  readonly id: string;
  readonly transform?: Transform;
  readonly materialId?: MaterialId;
  readonly label?: string;
  readonly anchored?: boolean;
  /** Contents the geometry does not model: coolant inventory, internals, ballast. */
  readonly additionalMassKg?: number;
  /** Overrides of the preset operating parameters. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Overrides of the default dimensions (metres), clamped to each dimension's range. */
  readonly dimensions?: Readonly<Record<string, number>>;
}

/** An editable size of a catalogue part, in metres. */
export interface DimensionSpec {
  readonly key: string;
  readonly label: string;
  readonly defaultM: number;
  readonly minM: number;
  readonly maxM: number;
}

/** Palette categories, in the order the component browser shows them. */
export const COMPONENT_CATEGORIES = Object.freeze([
  "Structure",
  "Chambers",
  "Magnets",
  "Fuel",
  "Vacuum",
  "Electrical",
  "Thermal",
  "Fluids",
  "Power conversion",
  "Sensors",
  "Controls",
] as const);

export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

/**
 * A component the player can place.
 *
 * A definition is a recipe, not an instance: it turns placement options into the
 * `ComponentSpec` that `SimulationWorld.addComponent` understands. Geometry and sockets
 * live here; mass, load and stress are all derived by the engine from the material id.
 */
export interface ComponentDefinition {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly defaultMaterialId: MaterialId;
  /** Nominal bounding size, for palette previews and placement offsets. */
  readonly nominalSizeM: Vec3;
  readonly category: ComponentCategory;
  /** The physics role every instance gets. */
  readonly role: PlantRole;
  /** Preset operating parameters (SI). Missing keys take the role defaults in sim-core. */
  readonly presetParameters: Readonly<Record<string, number | boolean | string>>;
  /** One headline figure for the palette card, already formatted. */
  readonly keyProperty: string;
  /** Sizes a builder may change. Sockets move with them. */
  readonly dimensions: readonly DimensionSpec[];
  createSpec(options: PlacementOptions): ComponentSpec;
  /**
   * Geometry and sockets for a set of dimensions (clamped), with socket ratings derived
   * from `materialId`. Used to resize a placed part.
   */
  reshape(
    dimensions: Readonly<Record<string, number>>,
    materialId: MaterialId,
  ): { geometry: ComponentGeometry; connectionPoints: readonly ConnectionPoint[] };
  /** Recovers the dimensions of a placed part from its geometry. */
  dimensionsOf(geometry: ComponentGeometry): Record<string, number>;
}

/**
 * Rated capacity of a structural socket, in newtons.
 *
 * DOCUMENTED ASSUMPTION. ForgeLab has no joint database, so rather than invent a bolt
 * pattern it assumes *the joint is no stronger than the member it sits on*: capacity is
 * the member's own section area perpendicular to the socket normal, times the material's
 * yield strength. That is a real relationship built from real material data, and it is
 * deliberately optimistic about the joint and conservative about nothing else. A specific
 * flange, weld or bolt rating overrides it per connection.
 */
export function structuralSocketCapacityN(
  geometry: ComponentGeometry,
  localDirection: Vec3,
  materialId: MaterialId,
): Newtons {
  const areaM2 = sectionAreaPerpendicularToLocalAxis(geometry, dominantLocalAxis(localDirection));
  return areaM2 * getMaterial(materialId).yieldStrengthPa;
}

export interface SocketTemplate {
  readonly id: string;
  readonly localPosition: Vec3;
  readonly localDirection: Vec3;
  readonly connectionType: ConnectionType;
  /**
   * When true the socket's capacity is derived from the member section (see above).
   * Mount sockets leave it false: ForgeLab has no basis for a bolted-flange rating yet,
   * and an unrated socket imposes no limit rather than a made-up one.
   */
  readonly derivedCapacity: boolean;
}

export function buildConnectionPoints(
  templates: readonly SocketTemplate[],
  geometry: ComponentGeometry,
  materialId: MaterialId,
): readonly ConnectionPoint[] {
  return Object.freeze(
    templates.map((template) =>
      Object.freeze({
        id: template.id,
        localPosition: template.localPosition,
        localDirection: template.localDirection,
        connectionType: template.connectionType,
        ...(template.derivedCapacity
          ? {
              maxLoadN: structuralSocketCapacityN(geometry, template.localDirection, materialId),
            }
          : {}),
      }),
    ),
  );
}
