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
  /** Increments on every reset or new run; effects clear their state when it changes. */
  readonly runEpoch: number;
}

export type PresentationEvent =
  | { readonly type: "facility"; readonly state: FacilityState; readonly previous: FacilityState }
  | { readonly type: "stage"; readonly stage: StageProgress }
  | { readonly type: "destruction"; readonly event: DestructionEvent }
  | { readonly type: "reading"; readonly reading: PlantReading }
  | { readonly type: "reset"; readonly epoch: number };

const INITIAL: PresentationState = Object.freeze({
  mode: "build",
  facility: "BUILD",
  alarm: "NONE",
  stages: [],
  stage: null,
  reading: null,
  destructions: [],
  warnings: [],
  runEpoch: 0,
});

export class PresentationDirector {
  readonly store: EditorStore;
  readonly recorder = new RunRecorder();
  #state: PresentationState = INITIAL;
  #listeners = new Set<() => void>();
  #eventListeners = new Set<(event: PresentationEvent) => void>();
  #tracker = new ActivationTracker();
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
      runEpoch: epoch,
    });
    this.#emit({ type: "reset", epoch });
  }

  #sync = (): void => {
    const view = this.store.getView();
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
    this.recorder.record(frame, fresh);
    this.#previous = reading;
    this.#set({
      reading,
      stages,
      stage: currentStage(stages),
      facility,
      alarm: alarmTier(facility),
      warnings: warnings(reading),
      ...(fresh.length > 0 ? { destructions: [...this.#state.destructions, ...fresh] } : {}),
    });
    this.#emit({ type: "reading", reading });
    for (const event of fresh) this.#emit({ type: "destruction", event });
  };
}
