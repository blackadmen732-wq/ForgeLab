import type { StageProgress } from "./activation.js";
import type { FailureFamily } from "./destruction.js";
import type { PlantReading } from "./reading.js";

/**
 * The hall's operating state. Lighting, alarms and ambient sound follow it. It is read
 * from published state and raised failures only: FAILURE and EMERGENCY are entered because
 * the simulation raised a failure, never because an effect happened.
 */
export type FacilityState =
  | "BUILD"
  | "READY"
  | "STARTUP"
  | "RUNNING"
  | "WARNING"
  | "POWER_LOSS"
  | "EMERGENCY"
  | "FAILURE"
  | "POST_FAILURE";

/** Alarm tiers, lowest to highest. */
export type AlarmTier = "NONE" | "ADVISORY" | "CAUTION" | "WARNING" | "EMERGENCY";

export const ALARM_ORDER: readonly AlarmTier[] = [
  "NONE",
  "ADVISORY",
  "CAUTION",
  "WARNING",
  "EMERGENCY",
];

export interface RaisedFailure {
  readonly timeSec: number;
  readonly family: FailureFamily;
  readonly severity: number;
}

export interface FacilityInputs {
  readonly mode: "build" | "simulate";
  readonly reading: PlantReading | null;
  readonly stages: readonly StageProgress[];
  readonly failures: readonly RaisedFailure[];
}

/** Families that end the run violently enough to call it a FAILURE. */
const SEVERE: ReadonlySet<FailureFamily> = new Set([
  "disruption",
  "quench",
  "structural",
  "electrical",
  "coolant",
]);

export const FAILURE_WINDOW_SEC = 2;
export const EMERGENCY_WINDOW_SEC = 6;

export interface WarningReason {
  readonly componentId: string;
  readonly text: string;
}

/** Parts close to a limit, from published margins. Pure. */
export function warnings(r: PlantReading): WarningReason[] {
  const out: WarningReason[] = [];
  for (const c of r.components) {
    if (c.disabled) continue;
    if (
      c.limitTemperatureK > 0 &&
      c.temperatureK > 0.85 * c.limitTemperatureK &&
      !c.superconducting
    )
      out.push({
        componentId: c.id,
        text: `${c.id} at ${pctOf(c.temperatureK, c.limitTemperatureK)} of its temperature limit`,
      });
    if (c.utilization > 0.85 && c.utilization < 1)
      out.push({
        componentId: c.id,
        text: `${c.id} at ${Math.round(c.utilization * 100)} % of its structural limit`,
      });
  }
  for (const l of r.loops) {
    if (
      l.ratedMassFlowKgS > 0 &&
      l.closed &&
      l.massFlowKgS < 0.5 * l.ratedMassFlowKgS &&
      r.timeSec > 3
    )
      out.push({
        componentId: l.componentIds[0] ?? l.id,
        text: `coolant loop at ${pctOf(l.massFlowKgS, l.ratedMassFlowKgS)} of rated flow`,
      });
  }
  return out;
}

const pctOf = (a: number, b: number) => `${Math.round((100 * a) / b)} %`;

/** Pure: the facility state for the given inputs. */
export function facilityState(input: FacilityInputs): FacilityState {
  if (input.mode === "build") return "BUILD";
  const r = input.reading;
  if (r === null) return "READY";
  const now = r.timeSec;
  const recent = (window: number) =>
    input.failures.filter((f) => f.timeSec <= now && now - f.timeSec <= window);
  if (recent(FAILURE_WINDOW_SEC).some((f) => SEVERE.has(f.family))) return "FAILURE";
  if (recent(EMERGENCY_WINDOW_SEC).length > 0) return "EMERGENCY";
  const electrical = input.stages.find((s) => s.id === "electrical");
  if (electrical?.status === "lost") return "POWER_LOSS";
  if (input.failures.some((f) => f.timeSec <= now)) return "POST_FAILURE";
  if (warnings(r).length > 0) return "WARNING";
  const plasma = Object.values(r.vessels).some(
    (v) => v.plasma.phase === "ramp-up" || v.plasma.phase === "flat-top",
  );
  const applicable = input.stages.filter((s) => s.status !== "skipped");
  const allDone = applicable.length > 0 && applicable.every((s) => s.status === "done");
  if (plasma || allDone) return "RUNNING";
  if (input.stages.some((s) => s.status === "done") || (r.running && now > 0)) return "STARTUP";
  return "READY";
}

export function alarmTier(state: FacilityState): AlarmTier {
  switch (state) {
    case "FAILURE":
    case "EMERGENCY":
      return "EMERGENCY";
    case "POWER_LOSS":
      return "WARNING";
    case "WARNING":
      return "CAUTION";
    case "POST_FAILURE":
      return "ADVISORY";
    default:
      return "NONE";
  }
}
