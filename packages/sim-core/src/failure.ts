import type { Newtons, Pascals, Ratio, Seconds } from "@forgelab/shared";
import type { ComponentId, ConnectionId } from "./connections.js";

/** Simulation subsystems that can raise failures. Only `structural` exists in Phase 0. */
export type SimulationSystemName =
  | "structural"
  | "electrical"
  | "thermal"
  | "fluid"
  | "magnetic"
  | "vacuum"
  | "plasma"
  | "neutron"
  | "control";

/** Specific structural failure modes Phase 0 can diagnose. */
export type StructuralFailureType = "yield_exceeded" | "connection_overload";

export type FailureType = StructuralFailureType | (string & {});

/**
 * A structured, explained failure.
 *
 * ForgeLab never reports a bare "FAILED". Every failure carries the measured value, the
 * limit it crossed, and a `cause` sentence that reconstructs the physical chain that got
 * there, so a player can act on it instead of guessing.
 */
export interface FailureEvent {
  readonly timestampSec: Seconds;
  readonly componentId: ComponentId;
  readonly system: SimulationSystemName;
  readonly failureType: FailureType;
  /** Human-readable reconstruction of the physical chain that produced the failure. */
  readonly cause: string;
  /** The quantity that crossed a limit, in SI units for that quantity. */
  readonly measuredValue: number;
  /** The limit it crossed, in the same unit as `measuredValue`. */
  readonly limitValue: number;

  /** Tick index the failure was raised on. */
  readonly tick: number;
  /** SI unit symbol for `measuredValue` and `limitValue`, e.g. "Pa" or "N". */
  readonly unit: string;
  /** measuredValue / limitValue at the moment of failure. */
  readonly utilization: Ratio;
  /** The connection that failed, when the failure is a connection overload. */
  readonly connectionId?: ConnectionId;
  /**
   * Components whose weight reached the failed element, ordered from the failure site
   * upward. This is the load path the player needs to lighten or brace.
   */
  readonly loadPathComponentIds: readonly ComponentId[];
}

/** Utilization bands. Numbers only: sim-core has no idea what colour "stressed" is. */
export const UTILIZATION_STRESSED_THRESHOLD: Ratio = 0.7;
export const UTILIZATION_FAILURE_THRESHOLD: Ratio = 1.0;

export type StructuralStatus = "normal" | "stressed" | "failed";

/**
 * Classifies a utilization ratio.
 *
 * < 0.70          normal
 * 0.70 .. 1.00    stressed
 * > 1.00          failed
 */
export function classifyUtilization(utilization: Ratio): StructuralStatus {
  if (utilization > UTILIZATION_FAILURE_THRESHOLD) return "failed";
  if (utilization >= UTILIZATION_STRESSED_THRESHOLD) return "stressed";
  return "normal";
}

/** Stable identity for a failure, used to raise each distinct failure exactly once. */
export function failureKey(event: {
  componentId: ComponentId;
  failureType: FailureType;
  connectionId?: ConnectionId;
}): string {
  return `${event.componentId}::${event.failureType}::${event.connectionId ?? ""}`;
}

/** Formats a quantity for a `cause` sentence without dragging a locale into sim-core. */
export function formatQuantity(value: number, unit: string): string {
  const magnitude = Math.abs(value);
  const text =
    magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)
      ? value.toExponential(3)
      : value.toFixed(magnitude >= 100 ? 1 : 3);
  return `${text} ${unit}`;
}

export function describeYieldFailure(params: {
  componentId: ComponentId;
  componentType: string;
  materialName: string;
  totalLoadN: Newtons;
  ownWeightN: Newtons;
  carriedLoadN: Newtons;
  areaM2: number;
  appliedStressPa: Pascals;
  allowableStressPa: Pascals;
  yieldStrengthPa: Pascals;
  designSafetyFactor: number;
  supportedComponentIds: readonly ComponentId[];
  /** Present when the member has been heated and its yield strength reduced. */
  hot?: { factor: number; temperatureK: number };
}): string {
  const carriedFrom =
    params.supportedComponentIds.length > 0
      ? ` carried from ${params.supportedComponentIds.join(", ")}`
      : "";
  const safetyNote =
    params.designSafetyFactor === 1
      ? `the ${params.materialName} yield strength of ${formatQuantity(params.yieldStrengthPa, "Pa")}`
      : `the allowable stress of ${formatQuantity(params.allowableStressPa, "Pa")} ` +
        `(${params.materialName} yield ${formatQuantity(params.yieldStrengthPa, "Pa")} ` +
        `divided by a design safety factor of ${params.designSafetyFactor})`;

  const hotNote =
    params.hot === undefined
      ? ""
      : ` Heated to ${params.hot.temperatureK.toFixed(0)} K, the member keeps only ` +
        `${(params.hot.factor * 100).toFixed(0)}% of its room-temperature yield strength.`;
  return (
    `${params.componentType} "${params.componentId}" carries ` +
    `${formatQuantity(params.carriedLoadN, "N")}${carriedFrom} plus its own weight of ` +
    `${formatQuantity(params.ownWeightN, "N")}, giving ${formatQuantity(params.totalLoadN, "N")} ` +
    `through a load-bearing section of ${formatQuantity(params.areaM2, "m^2")}. ` +
    `That is a compressive stress of ${formatQuantity(params.appliedStressPa, "Pa")}, ` +
    `which exceeds ${safetyNote}.${hotNote}`
  );
}

export function describeConnectionOverload(params: {
  connectionId: ConnectionId;
  supportedComponentId: ComponentId;
  supportingComponentId: ComponentId;
  transferredLoadN: Newtons;
  capacityN: Newtons;
  loadPathComponentIds: readonly ComponentId[];
}): string {
  const path =
    params.loadPathComponentIds.length > 1
      ? ` The load path reaching it is ${params.loadPathComponentIds.join(" -> ")}.`
      : "";
  return (
    `Connection "${params.connectionId}" transfers ` +
    `${formatQuantity(params.transferredLoadN, "N")} from "${params.supportedComponentId}" ` +
    `into "${params.supportingComponentId}", exceeding its rated capacity of ` +
    `${formatQuantity(params.capacityN, "N")}.${path}`
  );
}
