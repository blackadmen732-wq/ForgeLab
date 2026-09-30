import type { FailureEvent } from "@forgelab/sim-core";
import type { EditorStore } from "../builder/store/editor.js";
import { ActivationTracker, currentStage, type StageProgress } from "./activation.js";
import { destructionEvent, type DestructionEvent } from "./destruction.js";
import {
  alarmTier,
  facilityState,
  warnings,
  type AlarmTier,
  type FacilityState,
  type RaisedFailure,
  type WarningReason,
} from "./facility.js";
import { readingFromFrame, type PlantReading } from "./reading.js";
import { RunRecorder } from "./replay.js";
import {
  createVisualTracker,
  resetVisualTracker,
  visualFor,
  type ComponentVisual,
} from "./visualState.js";

/**
 * The presentation director: the only bridge between simulation output and everything
 * the player sees and hears besides the engineering panels.
 *
 * It observes the editor store (which owns the simulation worker), derives facility
 * state, activation stages and destruction events, and publishes them to lighting, audio,
 * effects and camera. It has no way to write to the simulation — the store's command
 * methods are never called from here.
 */
export interface PresentationState {
  readonly mode: "build" | "simulate";
  readonly facility: FacilityState;
  readonly alarm: AlarmTier;
  readonly stages: readonly StageProgress[];
  readonly stage: StageProgress | null;
  readonly reading: PlantReading | null;
  readonly destructions: readonly DestructionEvent[];
  readonly warnings: readonly WarningReason[];
  /** What each machine appears to be doing (rotors, lamps, sound). */
  readonly visuals: ReadonlyMap<string, ComponentVisual>;
  /** True while failure cinema is showing recorded frames instead of the live run. */
  readonly replaying: boolean;
  /** Increments on every reset or new run; effects clear their state when it changes. */
  readonly runEpoch: number;
}

export type PresentationEvent =
  | { readonly type: "facility"; readonly state: FacilityState; readonly previous: FacilityState }
  | { readonly type: "stage"; readonly stage: StageProgress }
  | { readonly type: "destruction"; readonly event: DestructionEvent }
  | { readonly type: "reading"; readonly reading: PlantReading }
  | { readonly type: "reset"; readonly epoch: number }
  /** Clear transient effects (smoke, debris, cracks) without ending the run: replay seeks. */
  | { readonly type: "clear-effects" };

/** The part of presentation state recorded with every frame, for replay. */
export type RecordedPresentation = Pick<
  PresentationState,
  "reading" | "stages" | "stage" | "facility" | "alarm" | "visuals" | "warnings"
>;

const INITIAL: PresentationState = Object.freeze({
  mode: "build",
  facility: "BUILD",
  alarm: "NONE",
  stages: [],
  stage: null,
  reading: null,
  destructions: [],
  warnings: [],
  visuals: new Map(),
  replaying: false,
  runEpoch: 0,
});

export class PresentationDirector {
  readonly store: EditorStore;
  readonly recorder = new RunRecorder();
  #state: PresentationState = INITIAL;
  #listeners = new Set<() => void>();
  #eventListeners = new Set<(event: PresentationEvent) => void>();
  #tracker = new ActivationTracker();
  #visualTracker = createVisualTracker();
  #failures: RaisedFailure[] = [];
  #lastFrame: unknown = null;
  #lastTick = -1;
  #previous: PlantReading | null = null;
  #unsubscribe: Array<() => void> = [];

  constructor(store: EditorStore) {
    this.store = store;
  }

  start(): void {
    if (this.#unsubscribe.length > 0) return;
    this.#unsubscribe = [this.store.subscribe(this.#sync), this.store.subscribeSim(this.#sync)];
    this.#sync();
  }

  stop(): void {
    for (const u of this.#unsubscribe) u();
    this.#unsubscribe = [];
  }

  getState = (): PresentationState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Discrete presentation events (facility changes, stages, destructions, resets). */
  on = (listener: (event: PresentationEvent) => void): (() => void) => {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  };

  #emit(event: PresentationEvent): void {
    for (const listener of this.#eventListeners) listener(event);
  }

  #set(next: Partial<PresentationState>): void {
    const before = this.#state;
    this.#state = { ...before, ...next };
    if (this.#state.facility !== before.facility)
      this.#emit({ type: "facility", state: this.#state.facility, previous: before.facility });
    for (const listener of this.#listeners) listener();
  }

  #resetRun(): void {
    this.#tracker.reset();
    resetVisualTracker(this.#visualTracker);
    this.#failures = [];
    this.#previous = null;
    this.#lastTick = -1;
    this.recorder.clear();
    const epoch = this.#state.runEpoch + 1;
    this.#set({
      destructions: [],
      stages: [],
      stage: null,
      reading: null,
      warnings: [],
      visuals: new Map(),
      replaying: false,
      runEpoch: epoch,
    });
    this.#replaying = false;
    this.#emit({ type: "reset", epoch });
  }

  /* Failure cinema ------------------------------------------------------------------ */

  #replaying = false;
  #live: RecordedPresentation | null = null;

  /** Stop following the live run; recorded frames are shown through `showReplay`. */
  beginReplay(): void {
    if (this.#replaying) return;
    const s = this.#state;
    this.#live = {
      reading: s.reading,
      stages: s.stages,
      stage: s.stage,
      facility: s.facility,
      alarm: s.alarm,
      visuals: s.visuals,
      warnings: s.warnings,
    };
    this.#replaying = true;
    this.#set({ replaying: true });
    this.clearEffects();
  }

  /** Show the presentation state recorded with a frame. */
  showReplay(recorded: RecordedPresentation): void {
    if (!this.#replaying) return;
    this.#set(recorded);
    if (recorded.reading !== null) this.#emit({ type: "reading", reading: recorded.reading });
  }

  /** Re-issue a recorded destruction so its effects play again at replay speed. */
  replayDestruction(event: DestructionEvent): void {
    if (this.#replaying) this.#emit({ type: "destruction", event });
  }

  clearEffects(): void {
    this.#emit({ type: "clear-effects" });
  }

  /** Back to the live run, exactly as it was left. */
  endReplay(): void {
    if (!this.#replaying) return;
    this.#replaying = false;
    this.clearEffects();
    this.#set({ ...(this.#live ?? {}), replaying: false });
    this.#live = null;
  }

  #sync = (): void => {
    const view = this.store.getView();
    if (this.#replaying) {
      if (view.mode === "build") this.endReplay();
      else return;
    }
    if (view.mode === "build") {
      if (this.#state.mode !== "build") {
        this.#resetRun();
        this.#set({ mode: "build", facility: "BUILD", alarm: "NONE" });
      }
      return;
    }
    if (this.#state.mode !== "simulate") {
      this.#resetRun();
      this.#set({ mode: "simulate", facility: "READY", alarm: "NONE" });
    }
    const frame = this.store.frame;
    if (frame === null || frame === this.#lastFrame) return;
    this.#lastFrame = frame;
    if (frame.tick < this.#lastTick) this.#resetRun();
    this.#lastTick = frame.tick;

    const reading = readingFromFrame(frame, view.snapshot.components);
    const before = this.#state.stages;
    const stages = this.#tracker.update(reading);
    for (const stage of stages) {
      const was = before.find((s) => s.id === stage.id);
      if (was === undefined || was.status !== stage.status) this.#emit({ type: "stage", stage });
    }
    const fresh: DestructionEvent[] = frame.newFailures.map((f: FailureEvent) =>
      destructionEvent(f, reading, this.#previous),
    );
    for (const d of fresh)
      this.#failures.push({ timeSec: d.simulationTime, family: d.family, severity: d.severity });
    const facility = facilityState({
      mode: "simulate",
      reading,
      stages,
      failures: this.#failures,
    });
    const failing = new Set(
      [...this.#state.destructions, ...fresh]
        .filter((d) => reading.timeSec - d.simulationTime < 3)
        .map((d) => d.componentId),
    );
    const visuals = new Map<string, ComponentVisual>();
    for (const c of reading.components)
      visuals.set(c.id, visualFor(c, reading, this.#visualTracker, failing));
    this.#previous = reading;
    const recorded: RecordedPresentation = {
      reading,
      stages,
      stage: currentStage(stages),
      facility,
      alarm: alarmTier(facility),
      warnings: warnings(reading),
      visuals,
    };
    this.recorder.record(frame, fresh, recorded);
    this.#set({
      ...recorded,
      ...(fresh.length > 0 ? { destructions: [...this.#state.destructions, ...fresh] } : {}),
    });
    this.#emit({ type: "reading", reading });
    for (const event of fresh) this.#emit({ type: "destruction", event });
  };
}
