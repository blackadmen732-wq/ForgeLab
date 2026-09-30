import type { SessionFrame } from "@forgelab/sim-runner";
import type { DestructionEvent } from "./destruction.js";
import type { RecordedPresentation } from "./director.js";

/**
 * Records the frames of the current run for failure cinema.
 *
 * Frames are what the worker already published; playback shows them again and never
 * re-runs or alters the simulation. Oldest frames are dropped past the cap (at 20 frames a
 * second the cap holds about five minutes).
 */
export interface RecordedFrame {
  readonly frame: SessionFrame;
  readonly destructions: readonly DestructionEvent[];
  /** What the presentation showed with this frame (facility, stages, machine states). */
  readonly presentation: RecordedPresentation | null;
}

export const MAX_RECORDED_FRAMES = 6000;

export class RunRecorder {
  #frames: RecordedFrame[] = [];
  #revision = 0;

  record(
    frame: SessionFrame,
    destructions: readonly DestructionEvent[],
    presentation: RecordedPresentation | null = null,
  ): void {
    const last = this.#frames[this.#frames.length - 1];
    if (last !== undefined && frame.tick <= last.frame.tick) return;
    this.#frames.push({ frame, destructions, presentation });
    if (this.#frames.length > MAX_RECORDED_FRAMES)
      this.#frames.splice(0, this.#frames.length - MAX_RECORDED_FRAMES);
    this.#revision += 1;
  }

  clear(): void {
    this.#frames = [];
    this.#revision += 1;
  }

  get revision(): number {
    return this.#revision;
  }

  get frames(): readonly RecordedFrame[] {
    return this.#frames;
  }

  get startSec(): number {
    return this.#frames[0]?.frame.timeSec ?? 0;
  }

  get endSec(): number {
    return this.#frames[this.#frames.length - 1]?.frame.timeSec ?? 0;
  }

  /** Index of the last frame at or before `timeSec` (binary search). */
  indexAt(timeSec: number): number {
    const f = this.#frames;
    if (f.length === 0) return -1;
    let lo = 0;
    let hi = f.length - 1;
    if (timeSec <= f[0]!.frame.timeSec) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid]!.frame.timeSec <= timeSec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  frameAt(timeSec: number): RecordedFrame | null {
    const i = this.indexAt(timeSec);
    return i < 0 ? null : this.#frames[i]!;
  }

  /** Every destruction recorded so far, in order. */
  destructions(): DestructionEvent[] {
    return this.#frames.flatMap((r) => r.destructions);
  }

  /** The root failure of the run: the earliest destruction that has no recorded cause. */
  rootDestruction(): DestructionEvent | null {
    const all = this.destructions();
    const ids = new Set(all.map((d) => d.eventId));
    return (
      all.find((d) => d.causalFailureId === undefined || !ids.has(d.causalFailureId)) ??
      all[0] ??
      null
    );
  }
}
