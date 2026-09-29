import {
  type Meters,
  type MetersPerSecondSquared,
  type Ratio,
  type Seconds,
  STANDARD_GRAVITY_MPS2,
} from "@forgelab/shared";

/**
 * What happens to the rest of the assembly once a member has yielded.
 *
 * `report-only` — the failure is recorded and reported, but the yielded member keeps
 *   carrying load. Results stay comparable tick to tick, which is what tests want.
 * `detach` — a yielded member stops supporting anything on the next tick, so whatever it
 *   was holding becomes unsupported and falls. This is a deliberately crude stand-in for
 *   real collapse dynamics: there is no fracture model, no energy release and no debris.
 */
export type FailurePropagationMode = "report-only" | "detach";

/**
 * Everything that defines the physical setup of a run.
 *
 * Settings are part of the save file. Two runs with the same settings and the same
 * components produce identical results, so anything that can change a physical outcome
 * belongs here rather than in a module-level constant.
 */
export interface SimulationSettings {
  /** Magnitude of gravitational acceleration. Set to 0 to disable gravity entirely. */
  readonly gravityMps2: MetersPerSecondSquared;
  /** The one and only integration step. Never varies at runtime. */
  readonly fixedTimestepSec: Seconds;
  /** World Y of the ground plane. Components resting on it are supported by it. */
  readonly groundLevelM: Meters;
  /**
   * Allowable stress is the material yield strength divided by this factor.
   * 1.0 means "compare directly against yield", which is what Phase 0 does by default:
   * a design margin is an engineering policy, not a law of physics, so it is opt-in.
   */
  readonly designSafetyFactor: Ratio;
  readonly failurePropagation: FailurePropagationMode;
  /**
   * Effective length factor K for column buckling, P_cr = π²EI/(KL)².
   * 1.0 is the pinned–pinned idealisation. ForgeLab joints carry no rotational stiffness
   * information yet, so K is a global engineering assumption rather than per joint.
   * Typical textbook values: 0.5 fixed–fixed, 0.7 fixed–pinned, 2.0 fixed–free.
   */
  readonly bucklingEffectiveLengthFactor: Ratio;
  /** Oldest failures are dropped past this count so a long run cannot grow without bound. */
  readonly maxFailureLogEntries: number;
}

export const DEFAULT_FIXED_TIMESTEP_SEC: Seconds = 1 / 60;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = Object.freeze({
  gravityMps2: STANDARD_GRAVITY_MPS2,
  fixedTimestepSec: DEFAULT_FIXED_TIMESTEP_SEC,
  groundLevelM: 0,
  designSafetyFactor: 1,
  failurePropagation: "report-only",
  bucklingEffectiveLengthFactor: 1,
  maxFailureLogEntries: 500,
});

export function makeSettings(overrides: Partial<SimulationSettings> = {}): SimulationSettings {
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<SimulationSettings>;
  const merged: SimulationSettings = { ...DEFAULT_SIMULATION_SETTINGS, ...defined };
  if (!(merged.fixedTimestepSec > 0)) {
    throw new RangeError(
      `fixedTimestepSec must be greater than zero, received ${String(merged.fixedTimestepSec)}`,
    );
  }
  if (!(merged.designSafetyFactor > 0)) {
    throw new RangeError(
      `designSafetyFactor must be greater than zero, received ${String(merged.designSafetyFactor)}`,
    );
  }
  if (!(merged.bucklingEffectiveLengthFactor > 0)) {
    throw new RangeError(
      `bucklingEffectiveLengthFactor must be greater than zero, received ${String(merged.bucklingEffectiveLengthFactor)}`,
    );
  }
  if (merged.gravityMps2 < 0) {
    throw new RangeError(
      `gravityMps2 must not be negative, received ${String(merged.gravityMps2)}`,
    );
  }
  return Object.freeze(merged);
}

/**
 * Playback speeds the workspace offers.
 *
 * Speed changes how many fixed steps are run per rendered frame. It never changes
 * `fixedTimestepSec`, so the sequence of simulated states is identical at every speed;
 * only how fast you travel along it differs.
 */
export const SIMULATION_SPEEDS: readonly number[] = Object.freeze([0, 1, 2, 5, 10]);
