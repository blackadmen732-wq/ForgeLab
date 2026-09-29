import type { PortSpec } from "../ports.js";
import type { ConnectionType } from "../connections.js";
import type { PlantRole } from "../plant/roles.js";
import type {
  FailurePropagationMode,
  InitialThermalState,
  InitialVacuumState,
} from "../settings.js";

/**
 * ForgeLab assembly file, schema version 1.
 *
 * This is the durable contract. It is plain JSON with no class instances, no functions
 * and no engine internals, so the same bytes can sit in a browser's local storage today
 * and in a Postgres `jsonb` column later without any translation layer.
 *
 * COMPATIBILITY RULES
 *  - `schemaVersion` is bumped whenever a field changes meaning or is removed.
 *  - New optional fields do not require a bump; readers must tolerate fields they do not
 *    know, and writers must not depend on a reader preserving them.
 *  - Every reader goes through `parseAssemblyFile`, which migrates older versions forward.
 *    Nothing else is allowed to read a raw save file.
 *
 * Only authoritative state is stored. Support modes, loads, stresses and utilizations are
 * all derived, so they are recomputed on load rather than saved — a save file can never
 * disagree with the solver about what the structure is doing.
 *
 * The failure *log* is likewise not stored: it is a record of a run, not of a design.
 * Loading re-solves, so any failure that is still true reappears immediately, stamped at
 * the tick the file was saved on; failures that happened earlier in the original run and
 * have since been resolved do not come back.
 */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/*
 * VERSION HISTORY
 *  1 — Milestone 0: structural components, box/cylinder geometry.
 *  2 — Launch candidate V0.1: every component gains `role` and `parameters` (plant
 *      physics), torus geometry, new connection types (steam, port) and new settings.
 *      Version 1 files migrate by giving every component role "structure" and no
 *      parameters, which preserves their meaning exactly.
 */

export interface SerializedVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SerializedQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface SerializedTransform {
  readonly positionM: SerializedVec3;
  readonly rotation: SerializedQuaternion;
}

export type SerializedGeometry =
  | { readonly kind: "box"; readonly sizeM: SerializedVec3; readonly wallThicknessM?: number }
  | {
      readonly kind: "cylinder";
      readonly radiusM: number;
      readonly heightM: number;
      readonly axis: "x" | "y" | "z";
      readonly wallThicknessM?: number;
    }
  | {
      readonly kind: "torus";
      readonly majorRadiusM: number;
      readonly minorRadiusM: number;
      readonly axis: "x" | "y" | "z";
      readonly wallThicknessM?: number;
    };

export interface SerializedConnectionPoint {
  readonly id: string;
  readonly localPosition: SerializedVec3;
  readonly localDirection: SerializedVec3;
  readonly connectionType: ConnectionType;
  readonly maxLoadN?: number;
  /** Engineering interface of the port (optional; older files have none). */
  readonly port?: PortSpec;
}

/** An internal material region of a finished component. */
export interface SerializedMaterialRegion {
  readonly id: string;
  readonly name: string;
  readonly substanceId: string;
  readonly volumeFraction: number;
}

/** The live kinematic state of a component at the moment of saving. */
export interface SerializedPhysicalState {
  readonly positionM: SerializedVec3;
  readonly rotation: SerializedQuaternion;
  readonly linearVelocityMps: SerializedVec3;
  readonly angularVelocityRadPerSec: SerializedVec3;
}

export interface SerializedComponent {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly materialId: string;
  readonly geometry: SerializedGeometry;
  /** Where the builder placed the part. `reset` returns it here. */
  readonly transform: SerializedTransform;
  readonly connectionPoints: readonly SerializedConnectionPoint[];
  readonly additionalMassKg: number;
  readonly anchored: boolean;
  /** Omitted when the part has not moved from its authored transform. */
  readonly physical?: SerializedPhysicalState;
  /** Plant role (schema 2). */
  readonly role: PlantRole;
  /** Operating parameters in SI (schema 2). */
  readonly parameters: Readonly<Record<string, number | boolean | string>>;
  /** Internal material regions; omitted for solid single-material parts. */
  readonly composition?: readonly SerializedMaterialRegion[];
}

export interface SerializedConnection {
  readonly id: string;
  readonly type: ConnectionType;
  readonly from: { readonly componentId: string; readonly connectionPointId: string };
  readonly to: { readonly componentId: string; readonly connectionPointId: string };
  readonly maxLoadN?: number;
}

export interface SerializedSimulationSettings {
  readonly gravityMps2: number;
  readonly fixedTimestepSec: number;
  readonly groundLevelM: number;
  readonly designSafetyFactor: number;
  readonly failurePropagation: FailurePropagationMode;
  readonly maxFailureLogEntries: number;
  /** Added in Structural 0.1. Files without it load with the default of 1.0. */
  readonly bucklingEffectiveLengthFactor?: number;
  readonly ambientTemperatureK?: number;
  readonly initialThermalState?: InitialThermalState;
  readonly initialVacuumState?: InitialVacuumState;
}

/** Clock state, so that reopening a save resumes the run rather than restarting it. */
export interface SerializedRuntime {
  readonly tick: number;
  readonly simulatedTimeSec: number;
  readonly idCounter: number;
}

export interface AssemblyFileV2 {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly name: string;
  readonly components: readonly SerializedComponent[];
  readonly connections: readonly SerializedConnection[];
  readonly simulationSettings: SerializedSimulationSettings;
  readonly runtime?: SerializedRuntime;
  /** Informational only; never read back by the engine. */
  readonly meta?: {
    readonly generator?: string;
    readonly savedAtIso?: string;
  };
}

/** The current file shape. Kept under its old name for callers written against V1. */
export type AssemblyFileV1 = AssemblyFileV2;
export type AnyAssemblyFile = AssemblyFileV2;
