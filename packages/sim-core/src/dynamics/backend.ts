import type { Seconds, Vec3 } from "@forgelab/shared";
import type { ComponentId, PhysicalProperties, SimulationComponent } from "../component.js";
import type { SimulationSettings } from "../settings.js";

export interface DynamicsStepContext {
  /** Every component, already carrying this tick's solved support state. */
  readonly components: readonly SimulationComponent[];
  readonly settings: SimulationSettings;
  readonly fixedTimestepSec: Seconds;
  readonly gravityAccelerationMps2: Vec3;
}

/** Kinematic state the backend produced, for the components it actually moved. */
export type DynamicsStepResult = ReadonlyMap<ComponentId, PhysicalProperties>;

/**
 * Pluggable rigid-body integrator.
 *
 * ForgeLab's structural analysis is never delegated: the solver in `systems/structural.ts`
 * decides what is supported, what load flows where, and what has failed. A dynamics
 * backend only answers the narrower question of where the *unsupported* bodies end up
 * after one fixed step.
 *
 * The built-in backend is the one covered by the determinism tests and the one the engine
 * uses by default. `@forgelab/sim-core/rapier` swaps in Rapier for richer rigid-body
 * collision in the browser; it is optional, it is never authoritative, and no result the
 * simulation reports as physics depends on it.
 */
export interface DynamicsBackend {
  readonly id: string;
  /** Called once per fixed timestep. Must be pure with respect to its inputs. */
  step(context: DynamicsStepContext): DynamicsStepResult;
  /** Discards any resources the backend holds (WASM worlds, buffers). */
  dispose?(): void;
}
