import {
  type AssemblyFileV2,
  type FailureEvent,
  type PlantSummary,
  type SimulationComponent,
  type VesselState,
  SimulationLoop,
  type SimulationWorld,
  deserializeWorld,
} from "@forgelab/sim-core";

/**
 * The simulation session that runs inside a Web Worker.
 *
 * It owns a `SimulationWorld`, paces it at the chosen speed and publishes compact frames
 * for the renderer. It is plain TypeScript with no worker API in it — the worker file in
 * the web app only forwards messages — so it is tested in Node like the rest of the
 * engine. Pacing uses an injected clock; the physics never sees it, so a run's states
 * are identical whatever the speed or the frame rate.
 */
export type SessionSpeed = 0 | 1 | 2 | 5 | 10 | "max";
export const SESSION_SPEEDS: readonly SessionSpeed[] = Object.freeze([0, 1, 2, 5, 10, "max"]);

export type SessionCommand =
  | { readonly type: "load"; readonly runId: number; readonly file: AssemblyFileV2 }
  | { readonly type: "speed"; readonly speed: SessionSpeed }
  | { readonly type: "step"; readonly count: number }
  | { readonly type: "reset" }
  | { readonly type: "inspect"; readonly componentId: string | null };

/** Per-component scalars packed into one Float64Array, `FRAME_FIELDS.length` per component. */
export const FRAME_FIELDS = Object.freeze([
  "utilization",
  "status", // 0 normal, 1 stressed, 2 failed
  "temperatureK",
  "limitTemperatureK",
  "heatGeneratedW",
  "supplyFraction",
  "massFlowKgS",
  "free", // 1 when unsupported and falling
  "disabled",
  "electricalPowerW", // delivered to a load, or supplied by a source
  "fieldT",
  "neutronHeatingW", // fusion-neutron energy deposited in the part
] as const);
export type FrameField = (typeof FRAME_FIELDS)[number];
const FIELD_COUNT = FRAME_FIELDS.length;

export interface HistoryPoint {
  readonly timeSec: number;
  readonly netElectricW: number;
  readonly grossElectricW: number;
  readonly houseLoadW: number;
  readonly fusionPowerW: number;
  readonly peakTemperatureK: number;
  readonly plasmaTemperatureKeV: number;
}

export interface SessionFrame {
  readonly type: "frame";
  readonly runId: number;
  readonly tick: number;
  readonly timeSec: number;
  readonly speed: SessionSpeed;
  readonly droppedTimeSec: number;
  /** Component ids, in the order `transforms` and `scalars` use. */
  readonly ids: readonly string[];
  /** Position (x, y, z) and rotation (x, y, z, w) per component. */
  readonly transforms: Float64Array;
  readonly scalars: Float64Array;
  readonly plant: PlantSummary;
  readonly vessels: Readonly<Record<string, VesselState>>;
  /** Failures raised since the previous frame. */
  readonly newFailures: readonly FailureEvent[];
  readonly failureCount: number;
  /** History points recorded since the previous frame. */
  readonly history: readonly HistoryPoint[];
  /** Full state of the component the interface is inspecting, if any. */
  readonly detail: SimulationComponent | null;
}

export type SessionEvent =
  | { readonly type: "loaded"; readonly runId: number; readonly componentCount: number }
  | { readonly type: "error"; readonly runId: number; readonly message: string }
  | SessionFrame;

/** Simulated seconds between history samples. */
export const HISTORY_INTERVAL_SEC = 0.25;
/** Frames are published at most this often (real time). */
const FRAME_INTERVAL_MS = 50;
/** Real-time budget per `tick` at "max" speed. */
const MAX_SPEED_BUDGET_MS = 12;

export class SimulationSession {
  #clock: () => number;
  #world: SimulationWorld | undefined;
  #loop: SimulationLoop | undefined;
  #runId = 0;
  #speed: SessionSpeed = 0;
  #inspect: string | null = null;
  #lastFrameAt = -Infinity;
  #failuresSent = 0;
  #pendingHistory: HistoryPoint[] = [];
  #nextHistoryTimeSec = 0;
  #forceFrame = false;

  constructor(clock: () => number) {
    this.#clock = clock;
  }

  get world(): SimulationWorld | undefined {
    return this.#world;
  }

  handle(command: SessionCommand): SessionEvent[] {
    switch (command.type) {
      case "load": {
        this.#runId = command.runId;
        try {
          const world = deserializeWorld(command.file);
          world.reset();
          this.#world = world;
          this.#loop = new SimulationLoop(world, { speed: 0, maxStepsPerFrame: 600 });
          this.#failuresSent = 0;
          this.#pendingHistory = [];
          this.#nextHistoryTimeSec = 0;
          this.#recordHistory();
          this.#forceFrame = true;
          return [
            { type: "loaded", runId: this.#runId, componentCount: world.listComponents().length },
            this.#frame(),
          ];
        } catch (error) {
          this.#world = undefined;
          this.#loop = undefined;
          return [{ type: "error", runId: this.#runId, message: messageOf(error) }];
        }
      }
      case "speed":
        this.#speed = command.speed;
        if (this.#loop !== undefined)
          this.#loop.speed = command.speed === "max" ? 0 : command.speed;
        this.#forceFrame = true;
        return this.#world === undefined ? [] : [this.#frame()];
      case "step":
        if (this.#world === undefined || this.#loop === undefined) return [];
        this.#stepExact(Math.max(0, Math.floor(command.count)));
        return [this.#frame()];
      case "reset":
        if (this.#world === undefined || this.#loop === undefined) return [];
        this.#loop.reset();
        this.#failuresSent = 0;
        this.#pendingHistory = [];
        this.#nextHistoryTimeSec = 0;
        this.#recordHistory();
        return [this.#frame()];
      case "inspect":
        this.#inspect = command.componentId;
        return this.#world === undefined ? [] : [this.#frame()];
    }
  }

  /**
   * Called by the worker's timer with the real time since the previous call. Runs whatever
   * steps are due and returns a frame when one should be published.
   */
  tick(realDeltaSec: number): SessionFrame | null {
    const loop = this.#loop;
    if (loop === undefined || this.#world === undefined) return null;
    if (this.#speed === "max") {
      const start = this.#clock();
      while (this.#clock() - start < MAX_SPEED_BUDGET_MS) this.#stepExact(10);
    } else if (this.#speed !== 0) {
      const before = this.#world.tick;
      loop.advance(realDeltaSec);
      if (this.#world.tick !== before) this.#afterSteps();
    }
    const now = this.#clock();
    if (!this.#forceFrame && now - this.#lastFrameAt < FRAME_INTERVAL_MS) return null;
    if (!this.#forceFrame && this.#speed === 0) return null;
    return this.#frame();
  }

  #stepExact(count: number): void {
    const world = this.#world!;
    // Step one at a time so history is sampled on schedule.
    for (let i = 0; i < count; i += 1) {
      this.#loop!.stepExact(1);
      if (world.simulatedTimeSec + 1e-9 >= this.#nextHistoryTimeSec) this.#recordHistory();
    }
  }

  #afterSteps(): void {
    if (this.#world!.simulatedTimeSec + 1e-9 >= this.#nextHistoryTimeSec) this.#recordHistory();
  }

  #recordHistory(): void {
    const world = this.#world!;
    const { metrics } = world.plantSummary;
    let plasmaTemperatureKeV = 0;
    for (const component of world.listComponents()) {
      const vessel = component.state.plant.vessel;
      if (vessel !== null)
        plasmaTemperatureKeV = Math.max(plasmaTemperatureKeV, vessel.plasma.temperatureKeV);
    }
    this.#pendingHistory.push({
      timeSec: world.simulatedTimeSec,
      netElectricW: metrics.netElectricW,
      grossElectricW: metrics.grossElectricW,
      houseLoadW: metrics.houseLoadW,
      fusionPowerW: metrics.fusionPowerW,
      peakTemperatureK: metrics.peakTemperatureK,
      plasmaTemperatureKeV,
    });
    this.#nextHistoryTimeSec =
      (Math.floor(world.simulatedTimeSec / HISTORY_INTERVAL_SEC + 1e-6) + 1) * HISTORY_INTERVAL_SEC;
  }

  #frame(): SessionFrame {
    const world = this.#world!;
    this.#lastFrameAt = this.#clock();
    this.#forceFrame = false;
    const snapshot = world.getSnapshot();
    const components = snapshot.components;
    const transforms = new Float64Array(components.length * 7);
    const scalars = new Float64Array(components.length * FIELD_COUNT);
    const vessels: Record<string, VesselState> = {};
    components.forEach((component, i) => {
      const { positionM: p, rotation: q } = component.state.physical;
      transforms.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
      const plant = component.state.plant;
      const structural = component.state.structural;
      const electrical = plant.electrical;
      const o = i * FIELD_COUNT;
      scalars[o] = structural.utilization;
      scalars[o + 1] =
        structural.status === "failed" ? 2 : structural.status === "stressed" ? 1 : 0;
      scalars[o + 2] = plant.thermal.temperatureK;
      scalars[o + 3] = Number.isFinite(plant.thermal.limitTemperatureK)
        ? plant.thermal.limitTemperatureK
        : 0;
      scalars[o + 4] = plant.thermal.heatGeneratedW;
      scalars[o + 5] = electrical === null ? 1 : electrical.supplyFraction;
      scalars[o + 6] = plant.coolant?.massFlowKgS ?? 0;
      scalars[o + 7] = component.state.support.mode === "free" ? 1 : 0;
      scalars[o + 8] = plant.disabled ? 1 : 0;
      scalars[o + 9] =
        electrical === null ? 0 : Math.max(electrical.deliveredW, electrical.suppliedW);
      scalars[o + 10] = plant.magnet?.fieldAtPlasmaT ?? plant.vessel?.plasma.fieldT ?? 0;
      scalars[o + 11] = plant.outputs["neutronHeatingW"] ?? 0;
      if (plant.vessel !== null) vessels[component.id] = plant.vessel;
    });
    const newFailures = snapshot.failures.slice(this.#failuresSent);
    this.#failuresSent = snapshot.failures.length;
    const history = this.#pendingHistory;
    this.#pendingHistory = [];
    return {
      type: "frame",
      runId: this.#runId,
      tick: snapshot.tick,
      timeSec: snapshot.simulatedTimeSec,
      speed: this.#speed,
      droppedTimeSec: this.#loop?.droppedTimeSec ?? 0,
      ids: components.map((c) => c.id),
      transforms,
      scalars,
      plant: snapshot.plant,
      vessels,
      newFailures,
      failureCount: snapshot.failures.length,
      history,
      detail:
        this.#inspect === null ? null : (components.find((c) => c.id === this.#inspect) ?? null),
    };
  }
}

/** Reads one packed scalar for the component at `index`. */
export function frameScalar(frame: SessionFrame, index: number, field: FrameField): number {
  return frame.scalars[index * FIELD_COUNT + FRAME_FIELDS.indexOf(field)] ?? 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
