import type { PlantRole } from "@forgelab/sim-core";
import type { ComponentReading, PlantReading } from "./reading.js";

/**
 * What each machine looks like it is doing, read from published state. Drives rotor
 * speed, status lamps and (later) per-machine sound. Never feeds back.
 */
export type VisualState =
  "OFF" | "STARTING" | "RUNNING" | "HIGH_LOAD" | "WARNING" | "FAILING" | "FAILED" | "SHUTTING_DOWN";

/** Roles whose machines have something that turns or runs. */
export const ACTIVE_ROLES: ReadonlySet<PlantRole> = new Set([
  "coolant-pump",
  "vacuum-pump",
  "turbine",
  "generator",
  "magnet-coil",
  "fuel-injector",
  "plasma-heater",
  "power-supply",
  "heat-exchanger",
  "controller",
  "sensor",
  "switch",
]);

/**
 * The raw activity measure for a part, in its own units: flow for pumps, field for coils,
 * delivered or supplied power for the rest. Normalised later against the largest value
 * seen this run, so no nominal ratings are invented here.
 */
export function rawActivity(c: ComponentReading, r: PlantReading): number {
  if (c.disabled) return 0;
  switch (c.role) {
    case "coolant-pump":
      return c.massFlowKgS;
    case "magnet-coil":
      return Math.abs(c.fieldT);
    case "turbine":
    case "generator":
      return r.metrics.grossElectricW;
    case "heat-exchanger":
      return c.massFlowKgS;
    case "vacuum-pump":
    case "fuel-injector":
    case "plasma-heater":
    case "controller":
    case "sensor":
      return c.powerW > 0 ? c.supplyFraction : 0;
    case "power-supply":
    case "switch":
      return c.powerW;
    default:
      return 0;
  }
}

export interface VisualTracker {
  /** Largest raw activity seen per component this run. */
  readonly peak: Map<string, number>;
  /** Previous normalised activity per component. */
  readonly last: Map<string, number>;
}

export function createVisualTracker(): VisualTracker {
  return { peak: new Map(), last: new Map() };
}

export interface ComponentVisual {
  readonly state: VisualState;
  /** 0..1 — how hard the machine is running relative to its best this run. */
  readonly activity: number;
}

/**
 * @param failing ids with a failure raised in the last few simulated seconds
 */
export function visualFor(
  c: ComponentReading,
  r: PlantReading,
  tracker: VisualTracker,
  failing: ReadonlySet<string>,
): ComponentVisual {
  const raw = rawActivity(c, r);
  const peak = Math.max(tracker.peak.get(c.id) ?? 0, raw);
  tracker.peak.set(c.id, peak);
  const activity = peak > 0 ? Math.min(1, raw / peak) : 0;
  const previous = tracker.last.get(c.id) ?? 0;
  tracker.last.set(c.id, activity);
  const heat = c.limitTemperatureK > 0 ? c.temperatureK / c.limitTemperatureK : 0;

  let state: VisualState;
  if (c.disabled || c.utilization >= 1 || c.free) state = "FAILED";
  else if (failing.has(c.id) || (heat >= 1 && !c.superconducting)) state = "FAILING";
  else if (
    (!c.superconducting && heat > 0.85) ||
    c.utilization > 0.85 ||
    (c.isLoad && c.supplyFraction < 0.95 && r.timeSec > 0)
  )
    state = "WARNING";
  else if (activity < 0.02) state = "OFF";
  else if (activity < previous - 0.01) state = "SHUTTING_DOWN";
  else if (activity < 0.9 && activity > previous + 0.005) state = "STARTING";
  else if (!c.superconducting && heat > 0.7) state = "HIGH_LOAD";
  else state = "RUNNING";
  return { state, activity };
}

export function resetVisualTracker(tracker: VisualTracker): void {
  tracker.peak.clear();
  tracker.last.clear();
}
