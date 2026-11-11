/**
 * Presentation time: what effects, plasma sequences and machine motion animate on.
 *
 * It is the wall clock unless something holds it. Browser tests hold and step it so a
 * sequence (a breakdown flash, a disruption, a blowdown) can be looked at a known moment
 * after the simulation event that started it. Simulation time is separate: the worker
 * keeps its own clock, and nothing here can speed it up, slow it down or read it.
 */
export class PresentationClock {
  readonly #wall: () => number;
  #held: number | null = null;
  #offsetMs = 0;

  constructor(wall: () => number = () => performance.now()) {
    this.#wall = wall;
  }

  /** Milliseconds; monotonic across hold, advance and release. */
  nowMs(): number {
    return this.#held ?? this.#wall() + this.#offsetMs;
  }

  /** True while time only moves through `advance`. */
  get held(): boolean {
    return this.#held !== null;
  }

  hold(): void {
    this.#held ??= this.#wall() + this.#offsetMs;
  }

  /** Moves held time forward; ignored when not held or when `ms` is not a positive number. */
  advance(ms: number): void {
    if (this.#held === null || !(ms > 0) || !Number.isFinite(ms)) return;
    this.#held += ms;
  }

  /** Lets time run again, continuing from where it was held. */
  release(): void {
    if (this.#held === null) return;
    this.#offsetMs = this.#held - this.#wall();
    this.#held = null;
  }
}

/** The clock every presentation system reads. */
export const presentationClock = new PresentationClock();

/** Longest step one rendered frame may take while the clock runs free, s. */
export const MAX_FRAME_STEP_S = 0.05;
/** Longest step a held clock may be advanced by in one go, s (longer steps are split). */
export const MAX_HELD_STEP_S = 30;

/**
 * The time step for a frame: capped while running free (a background tab must not make
 * every effect jump), generous while a test is stepping the clock on purpose.
 */
export function frameStepS(previousMs: number, nowMs: number, held: boolean): number {
  if (!(previousMs > 0)) return 0;
  const raw = Math.max(0, (nowMs - previousMs) / 1000);
  return Math.min(held ? MAX_HELD_STEP_S : MAX_FRAME_STEP_S, raw);
}
