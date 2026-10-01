import { type MaterialId, getMaterial } from "@forgelab/materials";
import { type Newtons, type Transform, type Vec3 } from "@forgelab/shared";
import {
  type ComponentGeometry,
  type ComponentSpec,
  type ConnectionPoint,
  type ConnectionType,
  type MaterialRegion,
  type PlantRole,
  type PortSpec,
  type SimulationSystemName,
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

/* ------------------------------------------------------------------------------------ *
 * Finished-product data
 * ------------------------------------------------------------------------------------ */

/** Physics a product takes part in. Informational: the solvers read roles and ports. */
export type PhysicsDomain =
  | "structural"
  | "electrical"
  | "thermal"
  | "fluid"
  | "cryogenic"
  | "magnetic"
  | "vacuum"
  | "plasma"
  | "nuclear"
  | "control"
  | "mechanical";

/** Which sound family a product uses. The audio layer maps these to synthesised voices. */
export type AudioProfileId =
  | "none"
  | "structure"
  | "pump"
  | "cryoplant"
  | "power-electronics"
  | "switchgear"
  | "magnet"
  | "vacuum-pump"
  | "turbine"
  | "generator"
  | "beam-heater"
  | "injector"
  | "controller"
  | "vessel"
  | "pipe"
  | "heat-exchanger"
  | "grid";

/** Which presentation model the renderer draws for a product. */
export type VisualProfileId =
  | "beam"
  | "platform"
  | "block"
  | "linear-chamber"
  | "tokamak-vessel"
  | "tf-coils"
  | "loop-coil"
  | "solenoid"
  | "fuel-injector"
  | "neutral-beam"
  | "cryopump"
  | "grid-connection"
  | "bus-bar"
  | "breaker"
  | "blanket"
  | "pipe"
  | "pump"
  | "steam-generator"
  | "turbine"
  | "generator"
  | "sensor"
  | "controller"
  | "cryoplant"
  | "cryo-line"
  | "magnet-supply"
  | "valve";

/** A part of the product the player can see in cutaway but never builds. */
/**
 * What an internal region is for. The Internal Systems view colours regions by kind, and
 * physics overlays light the regions a quantity physically lives in (current in
 * conductors, flow in coolant, neutron heating in plasma-facing and breeder regions).
 */
export const REGION_KINDS = [
  "structure",
  "conductor",
  "superconductor",
  "insulation",
  "magnetic-core",
  "coolant",
  "cryogen",
  "vacuum",
  "moving",
  "fuel",
  "plasma-facing",
  "breeder",
  "sensor",
  "electronics",
] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

export interface ProductInternal {
  readonly id: string;
  readonly name: string;
  readonly kind: RegionKind;
  /**
   * The library material or fluid it is made of, or null when that material is not
   * catalogued yet (then `materialNote` names it) or the region is empty (vacuum).
   */
  readonly substanceId: string | null;
  /** The real material when it is not in the library, e.g. "Alloy 690 (not catalogued)". */
  readonly materialNote?: string;
  /** Share of the envelope. Present when the internals define the product's mass. */
  readonly volumeFraction?: number;
  /** What it does in the machine. */
  readonly purpose: string;
}

export interface ProductRating {
  readonly label: string;
  /** Already formatted with its unit. */
  readonly value: string;
}

export interface ProductFailureMode {
  readonly id: string;
  readonly name: string;
  readonly system: SimulationSystemName;
  readonly description: string;
}

/** A visual or audio parameter driven by simulation state (never the other way round). */
export interface AnimationHook {
  readonly id: "rotor" | "impeller" | "fan" | "glow" | "indicator" | "valve-stem" | "frost";
  /** The plant state it follows: an `outputs` key or a well-known state path. */
  readonly source: string;
}

/**
 * What makes a catalogue entry a finished product: what is inside it, what it is rated
 * for, how it fails, and how it should look and sound. None of this is read by physics —
 * the role, parameters, ports and (when `internalsSetMass`) the composition are.
 */
export interface ProductInfo {
  readonly summary: string;
  readonly internals: readonly ProductInternal[];
  /** When true the internals' volume fractions set the product's mass. */
  readonly internalsSetMass: boolean;
  readonly capabilities: readonly PhysicsDomain[];
  readonly ratings: (
    parameters: Readonly<Record<string, number | boolean | string>>,
  ) => readonly ProductRating[];
  readonly failureModes: readonly ProductFailureMode[];
  readonly audio: AudioProfileId;
  readonly visual: VisualProfileId;
  readonly animations: readonly AnimationHook[];
}

/** The composition a product's internals imply, when they define its mass. */
export function productComposition(product: ProductInfo): readonly MaterialRegion[] | undefined {
  if (!product.internalsSetMass) return undefined;
  return product.internals.flatMap((i) =>
    i.volumeFraction === undefined || i.substanceId === null
      ? []
      : [{ id: i.id, name: i.name, substanceId: i.substanceId, volumeFraction: i.volumeFraction }],
  );
}

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
  /** The finished-product sheet: internals, ratings, failure modes, profiles. */
  readonly product: ProductInfo;
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
  /** Typed interface. Structural and mount sockets get a plain structural port. */
  readonly port?: PortSpec;
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
        ...(template.port !== undefined
          ? { port: template.port }
          : template.connectionType === "structural" || template.connectionType === "mount"
            ? {
                port: { domain: "structural" as const, label: "MOUNT", direction: "both" as const },
              }
            : {}),
        ...(template.derivedCapacity
          ? {
              maxLoadN: structuralSocketCapacityN(geometry, template.localDirection, materialId),
            }
          : {}),
      }),
    ),
  );
}
