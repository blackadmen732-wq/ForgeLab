import { getMaterial, getSubstance, type MaterialId } from "@forgelab/materials";
import {
  type Kilograms,
  type Newtons,
  type Pascals,
  QUATERNION_IDENTITY,
  type Quaternion,
  type Ratio,
  type SquareMeters,
  type Transform,
  type Vec3,
  VEC3_ZERO,
  assertNonNegative,
  localPointToWorld,
  transform as makeTransform,
} from "@forgelab/shared";
import {
  type ComponentId,
  type Connection,
  type ConnectionId,
  type ConnectionPoint,
} from "./connections.js";

export type { ComponentId, ConnectionId } from "./connections.js";
import {
  type ComponentGeometry,
  geometryLocalCenterOfMassM,
  geometryVolumeM3,
} from "./geometry.js";
import type { StructuralStatus } from "./failure.js";
import type { MemberRole } from "./systems/members.js";
import { type ComponentParameters, type PlantRole, resolveParameters } from "./plant/roles.js";
import { type ComponentPlantState, ZERO_PLANT_STATE } from "./plant/state.js";

/**
 * One internal region of a finished component: a substance filling a fraction of the
 * component's envelope volume. A superconducting magnet module, for example, is mostly
 * stainless-steel case with NbTi, copper and G-10 inside; the rest is void or coolant.
 */
export interface MaterialRegion {
  readonly id: string;
  readonly name: string;
  readonly substanceId: MaterialId;
  /** Fraction of the envelope volume, 0–1. The fractions of a component sum to ≤ 1. */
  readonly volumeFraction: number;
}

/**
 * The live kinematic state of a component.
 *
 * This is the mutable truth the integrator advances. It starts out equal to the
 * component's authored `transform` and diverges from it the moment the part moves.
 */
export interface PhysicalProperties {
  readonly massKg: Kilograms;
  readonly positionM: Vec3;
  readonly rotation: Quaternion;
  readonly linearVelocityMps: Vec3;
  readonly angularVelocityRadPerSec: Vec3;
}

/** How a component is held up, and how much it is holding up. */
export type SupportMode =
  /** Pinned in place by the builder. Absorbs unlimited load; nothing above it falls. */
  | "anchored"
  /** Resting on the ground plane. */
  | "grounded"
  /** Held by at least one load-bearing connection that traces back to ground or an anchor. */
  | "supported"
  /** Nothing holds it. It falls. */
  | "free";

/** Load transferred across one connection, in newtons, always non-negative. */
export interface ConnectionLoad {
  readonly connectionId: ConnectionId;
  readonly otherComponentId: ComponentId;
  readonly loadN: Newtons;
  /** Capacity of the link, or `undefined` when neither socket states one. */
  readonly capacityN?: Newtons;
}

export interface SupportState {
  readonly mode: SupportMode;
  /** Components directly beneath this one that carry part of its load. */
  readonly supportedByComponentIds: readonly ComponentId[];
  /** Components resting on this one. */
  readonly supportingComponentIds: readonly ComponentId[];
  /** m * g for this component alone. */
  readonly ownWeightN: Newtons;
  /** Everything above it, summed. */
  readonly carriedLoadN: Newtons;
  /** ownWeightN + carriedLoadN: what passes through this component's section. */
  readonly totalLoadN: Newtons;
  /** Reaction delivered into each of its supports. Sorted by connection id. */
  readonly reactions: readonly ConnectionLoad[];
}

export interface StructuralState {
  readonly loadBearingAreaM2: SquareMeters;
  /** Axial (direct compressive) stress through the load-bearing section. */
  readonly appliedStressPa: Pascals;
  readonly allowableStressPa: Pascals;
  /**
   * Governing utilization: the largest of the axial, bending and buckling utilizations.
   * Each mode is also reported separately below so a player can see which one governs.
   */
  readonly utilization: Ratio;
  readonly status: StructuralStatus;
  readonly failed: boolean;

  /** How the solver idealised this member (Structural 0.1). */
  readonly memberRole: MemberRole;
  /** Which mode produced `utilization`. */
  readonly governingMode: StructuralMode;
  /** appliedStressPa / allowableStressPa. */
  readonly axialUtilization: Ratio;
  /** Peak bending moment for a beam, N·m. 0 for columns and blocks. */
  readonly bendingMomentNm: number;
  /** Peak bending stress M / S at the extreme fibre, Pa. */
  readonly bendingStressPa: Pascals;
  readonly bendingUtilization: Ratio;
  /** Critical buckling load for a column (Euler or Johnson), N. 0 when not a column. */
  readonly criticalBucklingLoadN: Newtons;
  /** Effective slenderness K·L/r of a column. 0 when not a column. */
  readonly slendernessRatio: number;
  /** Axial load / critical buckling load. */
  readonly bucklingUtilization: Ratio;
}

/** The structural failure modes Structural 0.1 checks. */
export type StructuralMode = "axial" | "bending" | "buckling";

/**
 * Everything a solver has determined about a component this tick.
 *
 * Later phases add sibling fields here (`thermal`, `electrical`, `fluid`, ...), each
 * written by exactly one registered `SimulationSystem`. Nothing outside a system's own
 * solver writes its slice, which is what keeps the subsystems independently testable.
 */
export interface ComponentState {
  readonly physical: PhysicalProperties;
  readonly support: SupportState;
  readonly structural: StructuralState;
  /** Written only by the plant solver (electrical, thermal, coolant, magnetics, plasma...). */
  readonly plant: ComponentPlantState;
}

/**
 * A component in the simulation.
 *
 * `transform` is where the builder placed the part; `state.physical` is where it actually
 * is right now. Keeping the two apart is what makes `reset()` exact rather than
 * approximate, and it means a save file records both the design and the run.
 *
 * `connections` holds references to the same frozen `Connection` objects the world owns,
 * so the two ends of a link can never drift apart.
 */
export interface SimulationComponent {
  readonly id: ComponentId;
  readonly type: string;
  readonly transform: Transform;
  readonly geometry: ComponentGeometry;
  readonly materialId: MaterialId;
  readonly massKg: Kilograms;
  readonly connections: readonly Connection[];
  readonly state: ComponentState;

  /** Sockets this component offers. */
  readonly connectionPoints: readonly ConnectionPoint[];
  /**
   * Mass present in the component that its geometry does not describe: vessel internals,
   * coolant inventory, ballast. Stored separately from the geometry-derived mass so that
   * changing material still changes mass in the way the player expects.
   */
  readonly additionalMassKg: Kilograms;
  /** Pinned in place by the builder; never falls and never reports as unsupported. */
  readonly anchored: boolean;
  /** Free-text label shown in the workspace. Never read by physics. */
  readonly label: string;
  /** Which plant physics applies to this component. `structure` means none. */
  readonly role: PlantRole;
  /** Operating parameters for the role, in SI, validated and complete. */
  readonly parameters: ComponentParameters;
  /**
   * Internal material regions. Empty for a solid part made of `materialId`. When present,
   * mass comes from the regions; `materialId` stays the load-bearing (casing) material.
   */
  readonly composition: readonly MaterialRegion[];
}

/**
 * Mass from geometry and material, plus any declared additional mass.
 *
 * This is the only place mass is produced. Holding material as an id and resolving
 * density here is what makes "swap the material, the mass changes" true by construction.
 */
export function resolveMassKg(
  geometry: ComponentGeometry,
  materialId: MaterialId,
  additionalMassKg: Kilograms = 0,
  composition: readonly MaterialRegion[] = [],
): Kilograms {
  const volumeM3 = geometryVolumeM3(geometry);
  const extra = assertNonNegative(additionalMassKg, "additionalMassKg");
  if (composition.length === 0) return volumeM3 * getMaterial(materialId).densityKgM3 + extra;
  let mass = 0;
  for (const region of composition)
    mass += region.volumeFraction * volumeM3 * getSubstance(region.substanceId).densityKgM3;
  return mass + extra;
}

/**
 * Checks a composition: known substances, fractions in [0, 1] summing to at most 1.
 * Returns an error message, or null when valid.
 */
export function compositionError(composition: readonly MaterialRegion[]): string | null {
  let total = 0;
  for (const region of composition) {
    if (!(region.volumeFraction >= 0 && region.volumeFraction <= 1))
      return `Region "${region.id}" has a volume fraction outside 0–1.`;
    try {
      getSubstance(region.substanceId);
    } catch {
      return `Region "${region.id}" uses unknown substance "${region.substanceId}".`;
    }
    total += region.volumeFraction;
  }
  return total > 1 + 1e-9 ? `Regions fill ${(total * 100).toFixed(1)} % of the envelope.` : null;
}

/**
 * Heat capacity m·c of a component, J/K. For a composed component it sums the regions whose
 * specific heat is sourced; regions without one (e.g. NbTi) contribute no heat capacity,
 * which makes the component heat up faster — the conservative direction. Additional mass
 * takes the casing material's specific heat.
 */
export function componentHeatCapacityJK(component: SimulationComponent): number {
  const casing = getMaterial(component.materialId);
  if (component.composition.length === 0) return component.massKg * casing.specificHeatJkgK;
  const volumeM3 = geometryVolumeM3(component.geometry);
  let capacity = component.additionalMassKg * casing.specificHeatJkgK;
  for (const region of component.composition) {
    const substance = getSubstance(region.substanceId);
    if (substance.specificHeatJkgK === undefined) continue;
    capacity +=
      region.volumeFraction * volumeM3 * substance.densityKgM3 * substance.specificHeatJkgK;
  }
  return capacity;
}

export function initialPhysicalProperties(
  massKg: Kilograms,
  transform: Transform,
): PhysicalProperties {
  return Object.freeze({
    massKg,
    positionM: transform.positionM,
    rotation: transform.rotation,
    linearVelocityMps: VEC3_ZERO,
    angularVelocityRadPerSec: VEC3_ZERO,
  });
}

export const ZERO_SUPPORT_STATE: SupportState = Object.freeze({
  mode: "free",
  supportedByComponentIds: Object.freeze([]),
  supportingComponentIds: Object.freeze([]),
  ownWeightN: 0,
  carriedLoadN: 0,
  totalLoadN: 0,
  reactions: Object.freeze([]),
});

export const ZERO_STRUCTURAL_STATE: StructuralState = Object.freeze({
  loadBearingAreaM2: 0,
  appliedStressPa: 0,
  allowableStressPa: 0,
  utilization: 0,
  status: "normal",
  failed: false,
  memberRole: "block",
  governingMode: "axial",
  axialUtilization: 0,
  bendingMomentNm: 0,
  bendingStressPa: 0,
  bendingUtilization: 0,
  criticalBucklingLoadN: 0,
  slendernessRatio: 0,
  bucklingUtilization: 0,
});

/** The live world-space placement of a component (not its authored transform). */
export function currentTransform(component: SimulationComponent): Transform {
  return makeTransform(component.state.physical.positionM, component.state.physical.rotation);
}

/** World-space centre of mass of a single component. */
export function componentCenterOfMassM(component: SimulationComponent): Vec3 {
  return localPointToWorld(
    currentTransform(component),
    geometryLocalCenterOfMassM(component.geometry),
  );
}

export interface ComponentSpec {
  readonly id: ComponentId;
  readonly type: string;
  readonly geometry: ComponentGeometry;
  readonly materialId: MaterialId;
  readonly transform?: Transform;
  readonly connectionPoints?: readonly ConnectionPoint[];
  readonly additionalMassKg?: Kilograms;
  readonly anchored?: boolean;
  readonly label?: string;
  readonly role?: PlantRole;
  /** Partial parameters; missing ones take the role's defaults. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Restores a saved kinematic state instead of starting from the authored transform. */
  readonly physical?: PhysicalProperties;
  /** Internal material regions of a finished component. */
  readonly composition?: readonly MaterialRegion[];
}

export function createComponent(spec: ComponentSpec): SimulationComponent {
  const transform = spec.transform ?? makeTransform(VEC3_ZERO, QUATERNION_IDENTITY);
  const additionalMassKg = spec.additionalMassKg ?? 0;
  const composition = Object.freeze(
    [...(spec.composition ?? [])].map((r) => Object.freeze({ ...r })),
  );
  const problem = compositionError(composition);
  if (problem !== null) throw new Error(`Component "${spec.id}": ${problem}`);
  const massKg = resolveMassKg(spec.geometry, spec.materialId, additionalMassKg, composition);
  const role = spec.role ?? "structure";

  return Object.freeze({
    id: spec.id,
    type: spec.type,
    transform,
    geometry: spec.geometry,
    materialId: spec.materialId,
    massKg,
    connections: Object.freeze([]) as readonly Connection[],
    connectionPoints: Object.freeze([...(spec.connectionPoints ?? [])]),
    additionalMassKg,
    anchored: spec.anchored ?? false,
    label: spec.label ?? spec.type,
    role,
    parameters: resolveParameters(role, spec.parameters ?? {}),
    composition,
    state: Object.freeze({
      physical: spec.physical ?? initialPhysicalProperties(massKg, transform),
      support: ZERO_SUPPORT_STATE,
      structural: ZERO_STRUCTURAL_STATE,
      plant: ZERO_PLANT_STATE,
    }),
  });
}

/** Returns a copy of `component` with the given fields replaced. Components are immutable. */
export function withComponent(
  component: SimulationComponent,
  changes: Partial<
    Pick<
      SimulationComponent,
      | "transform"
      | "geometry"
      | "materialId"
      | "additionalMassKg"
      | "anchored"
      | "label"
      | "connections"
      | "state"
      | "connectionPoints"
      | "parameters"
    >
  >,
): SimulationComponent {
  const geometry = changes.geometry ?? component.geometry;
  const materialId = changes.materialId ?? component.materialId;
  const additionalMassKg = changes.additionalMassKg ?? component.additionalMassKg;

  const massChanged =
    changes.geometry !== undefined ||
    changes.materialId !== undefined ||
    changes.additionalMassKg !== undefined;
  const massKg = massChanged
    ? resolveMassKg(geometry, materialId, additionalMassKg, component.composition)
    : component.massKg;

  const transform = changes.transform ?? component.transform;
  const state = changes.state ?? component.state;
  const physical =
    changes.state !== undefined
      ? state.physical
      : massChanged || changes.transform !== undefined
        ? initialPhysicalProperties(massKg, transform)
        : state.physical;

  return Object.freeze({
    ...component,
    transform,
    geometry,
    materialId,
    additionalMassKg,
    massKg,
    anchored: changes.anchored ?? component.anchored,
    label: changes.label ?? component.label,
    connections: changes.connections ?? component.connections,
    connectionPoints: changes.connectionPoints ?? component.connectionPoints,
    parameters:
      changes.parameters === undefined
        ? component.parameters
        : resolveParameters(component.role, changes.parameters),
    state: Object.freeze({ ...state, physical }),
  });
}

/** Replaces only the live kinematic state, leaving the authored transform untouched. */
export function withPhysical(
  component: SimulationComponent,
  physical: PhysicalProperties,
): SimulationComponent {
  return Object.freeze({
    ...component,
    state: Object.freeze({ ...component.state, physical }),
  });
}

export function withSolverState(
  component: SimulationComponent,
  support: SupportState,
  structural: StructuralState,
): SimulationComponent {
  return Object.freeze({
    ...component,
    state: Object.freeze({ ...component.state, support, structural }),
  });
}

export function withPlantState(
  component: SimulationComponent,
  plant: ComponentPlantState,
): SimulationComponent {
  return Object.freeze({
    ...component,
    state: Object.freeze({ ...component.state, plant }),
  });
}
