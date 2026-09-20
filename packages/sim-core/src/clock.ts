import type { Seconds } from "@forgelab/shared";
import type { SimulationWorld } from "./world.js";

/**
 * Guard against floating-point shortfall when deciding how many steps are due.
 * One nanosecond of simulated time; far below any step ForgeLab will ever use.
 */
const STEP_EPSILON_SEC: Seconds = 1e-9;

export interface SimulationLoopOptions {
  /**
   * Most fixed steps the loop will run for a single `advance()` call.
   *
   * Without a cap, a browser tab returning from the background would try to catch up
   * hours of simulated time in one frame and lock up. With it, simulated time falls
   * behind real time instead — which is the right trade, because every step is still the
   * same fixed step and the sequence of states is unchanged.
   */
  readonly maxStepsPerFrame?: number;
  /** Initial playback multiplier. 0 is paused. */
  readonly speed?: number;
}

/**
 * Drives a `SimulationWorld` at a fixed timestep, independently of rendering.
 *
 * THE GUARANTEE
 *   The world's state after N steps is a function of N and the initial conditions alone.
 *   Frame rate, frame jitter and playback speed change only how quickly N grows — never
 *   what the state at a given N is. That is what makes "the simulation does not care how
 *   fast you draw" a property of the design rather than a hope.
 *
 * HOW
 *   The loop tracks total *requested* simulated time and derives the target step count
 *   from it (`floor(requested / dt)`), rather than repeatedly subtracting `dt` from an
 *   accumulator. Repeated subtraction accumulates rounding error over a long session and
 *   will eventually drop or duplicate a step; deriving the target from a running total
 *   cannot drift.
 */
export class SimulationLoop {
  readonly #world: SimulationWorld;
  #maxStepsPerFrame: number;
  #speed: number;
  #requestedSimTimeSec: Seconds = 0;
  #stepsExecuted = 0;
  #droppedTimeSec: Seconds = 0;

  constructor(world: SimulationWorld, options: SimulationLoopOptions = {}) {
    this.#world = world;
    this.#maxStepsPerFrame = Math.max(1, Math.floor(options.maxStepsPerFrame ?? 240));
    this.#speed = Math.max(0, options.speed ?? 1);
  }

  get world(): SimulationWorld {
    return this.#world;
  }

  /** Playback multiplier. 0 pauses. Never affects the size of a step. */
  get speed(): number {
    return this.#speed;
  }

  set speed(value: number) {
    if (!(value >= 0) || !Number.isFinite(value)) {
      throw new RangeError(
        `speed must be a finite, non-negative number, received ${String(value)}`,
      );
    }
    this.#speed = value;
  }

  get paused(): boolean {
    return this.#speed === 0;
  }

  get stepsExecuted(): number {
    return this.#stepsExecuted;
  }

  /**
   * Simulated time the loop was asked for but could not deliver because a frame hit
   * `maxStepsPerFrame`. Non-zero here means the machine cannot keep up at this speed.
   */
  get droppedTimeSec(): Seconds {
    return this.#droppedTimeSec;
  }

  /**
   * Feeds one rendered frame's elapsed real time to the simulation and runs whatever
   * whole fixed steps are now due. Returns how many steps ran.
   */
  advance(realDeltaSec: Seconds): number {
    if (!Number.isFinite(realDeltaSec) || realDeltaSec <= 0) return 0;
    if (this.#speed === 0) return 0;

    this.#requestedSimTimeSec += realDeltaSec * this.#speed;

    const dt = this.#world.settings.fixedTimestepSec;
    const targetSteps = Math.floor((this.#requestedSimTimeSec + STEP_EPSILON_SEC) / dt);
    let due = targetSteps - this.#stepsExecuted;
    if (due <= 0) return 0;

    if (due > this.#maxStepsPerFrame) {
      const dropped = due - this.#maxStepsPerFrame;
      this.#droppedTimeSec += dropped * dt;
      this.#requestedSimTimeSec -= dropped * dt;
      due = this.#maxStepsPerFrame;
    }

    this.#world.stepMany(due);
    this.#stepsExecuted += due;
    return due;
  }

  /** Runs exactly `count` steps, bypassing wall-clock pacing. Used by tests and by step-through. */
  stepExact(count: number): void {
    if (count <= 0) return;
    this.#world.stepMany(count);
    this.#stepsExecuted += count;
    this.#requestedSimTimeSec = this.#stepsExecuted * this.#world.settings.fixedTimestepSec;
  }

  /** Resets the world and the loop's pacing state together. */
  reset(): void {
    this.#world.reset();
    this.#requestedSimTimeSec = 0;
    this.#stepsExecuted = 0;
    this.#droppedTimeSec = 0;
  }
}
