import { useSyncExternalStore } from "react";
import type { EditorStore } from "../builder/store/editor.js";
import type { DestructionEvent } from "./destruction.js";
import type { PresentationDirector } from "./director.js";

/**
 * Failure cinema: watch the recorded run again, slowly.
 *
 * Opening it pauses the live simulation and shows recorded frames through the viewport;
 * failures are re-issued as the playhead passes them, so their effects play again at the
 * chosen speed (effects run on presentation time, which this scales). Nothing is
 * re-simulated and the design is untouched: closing returns to the paused live run,
 * RETURN TO BUILD restores the design as it was before activation.
 */
export type CinemaCamera = "free" | "follow" | "root";

export const CINEMA_RATES = [0.25, 0.5, 1, 2] as const;
export type CinemaRate = (typeof CINEMA_RATES)[number];

export interface CinemaState {
  readonly active: boolean;
  readonly playing: boolean;
  readonly rate: CinemaRate;
  readonly timeSec: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly camera: CinemaCamera;
  /** Where the camera follows: the root failure's part unless a chain step was picked. */
  readonly focusId: string | null;
  readonly rootId: string | null;
  readonly markers: ReadonlyArray<{
    readonly timeSec: number;
    readonly summary: string;
    readonly family: string;
  }>;
}

const CLOSED: CinemaState = Object.freeze({
  active: false,
  playing: false,
  rate: 0.5,
  timeSec: 0,
  startSec: 0,
  endSec: 0,
  camera: "follow",
  focusId: null,
  rootId: null,
  markers: [],
});

/** Seconds of lead-in before the root failure when the cinema opens. */
export const LEAD_IN_SEC = 5;

export class FailureCinema {
  #director: PresentationDirector;
  #store: EditorStore;
  #state: CinemaState = CLOSED;
  #listeners = new Set<() => void>();
  #emittedUpTo = 0;
  #events: DestructionEvent[] = [];

  constructor(director: PresentationDirector, store: EditorStore) {
    this.#director = director;
    this.#store = store;
    director.on((event) => {
      if (event.type === "reset" && this.#state.active) this.close();
    });
  }

  getState = (): CinemaState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(next: Partial<CinemaState>): void {
    this.#state = { ...this.#state, ...next };
    for (const l of this.#listeners) l();
  }

  /** Scale for presentation time: effects freeze when paused and slow down in slow motion. */
  timeScale(): number {
    const s = this.#state;
    return s.active ? (s.playing ? s.rate : 0) : 1;
  }

  get canOpen(): boolean {
    return (
      this.#director.recorder.frames.length > 1 && this.#director.recorder.destructions().length > 0
    );
  }

  open(): void {
    const recorder = this.#director.recorder;
    if (!this.canOpen) return;
    this.#store.setSpeed(0);
    this.#events = recorder.destructions();
    const root = recorder.rootDestruction();
    const startSec = recorder.startSec;
    const endSec = recorder.endSec;
    const t = Math.max(
      startSec,
      Math.min(endSec, (root?.simulationTime ?? startSec) - LEAD_IN_SEC),
    );
    this.#director.beginReplay();
    this.#set({
      active: true,
      playing: true,
      rate: 0.5,
      startSec,
      endSec,
      timeSec: t,
      camera: "follow",
      rootId: root?.componentId ?? null,
      focusId: root?.componentId ?? null,
      markers: this.#events.map((d) => ({
        timeSec: d.simulationTime,
        summary: d.summary,
        family: d.family,
      })),
    });
    this.#emittedUpTo = t;
    this.#show();
  }

  close(): void {
    if (!this.#state.active) return;
    this.#store.setReplayFrame(null);
    this.#director.endReplay();
    this.#set(CLOSED);
  }

  togglePlay(): void {
    const s = this.#state;
    if (!s.active) return;
    if (!s.playing && s.timeSec >= s.endSec) this.seek(s.startSec);
    this.#set({ playing: !this.#state.playing });
  }

  setRate(rate: CinemaRate): void {
    this.#set({ rate });
  }

  setCamera(camera: CinemaCamera): void {
    this.#set({ camera, ...(camera === "root" ? { focusId: this.#state.rootId } : {}) });
  }

  /** Jump the playhead. Effects in flight are cleared; later failures replay as passed. */
  seek(timeSec: number): void {
    const s = this.#state;
    if (!s.active) return;
    const t = Math.max(s.startSec, Math.min(s.endSec, timeSec));
    this.#director.clearEffects();
    this.#emittedUpTo = t;
    this.#set({ timeSec: t });
    this.#show();
  }

  /** Follow a part (a step of the causal chain) and jump to just before its failure. */
  focus(componentId: string, failureTimeSec?: number): void {
    this.#set({ focusId: componentId, camera: "follow" });
    if (failureTimeSec !== undefined) this.seek(failureTimeSec - 1.5);
  }

  /** Called every animation frame with real elapsed seconds. */
  advance(realDt: number): void {
    const s = this.#state;
    if (!s.active || !s.playing) return;
    const next = Math.min(s.endSec, s.timeSec + realDt * s.rate);
    for (const d of this.#events)
      if (d.simulationTime > this.#emittedUpTo && d.simulationTime <= next)
        this.#director.replayDestruction(d);
    this.#emittedUpTo = next;
    this.#set({ timeSec: next, ...(next >= s.endSec ? { playing: false } : {}) });
    this.#show();
  }

  #show(): void {
    const recorded = this.#director.recorder.frameAt(this.#state.timeSec);
    if (recorded === null) return;
    this.#store.setReplayFrame(recorded.frame);
    if (recorded.presentation !== null) this.#director.showReplay(recorded.presentation);
  }
}

export function useCinema<T>(cinema: FailureCinema, selector: (s: CinemaState) => T): T {
  return useSyncExternalStore(cinema.subscribe, () => selector(cinema.getState()));
}
