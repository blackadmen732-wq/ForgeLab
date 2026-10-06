import { MaterialIds, type MaterialId } from "@forgelab/materials";
import {
  DEFAULT_SNAP_SIZE_M,
  QuaternionMath,
  type Quaternion,
  STANDARD_GRAVITY_MPS2,
  type Transform,
  type Vec3,
  snapVec3,
  transform as makeTransform,
  vec3,
} from "@forgelab/shared";
import {
  BuiltInDynamicsBackend,
  CONNECTION_SNAP_TOLERANCE_M,
  type AssemblyMassProperties,
  type CascadeSnapshot,
  type Connection,
  type DynamicsBackend,
  type FailureEvent,
  type FailurePropagationMode,
  SimulationLoop,
  SimulationWorld,
  type SimulationComponent,
  toJson,
  worldFromJson,
} from "@forgelab/sim-core";
import {
  COMPONENT_DEFINITIONS,
  PROTECTED_DESIGN,
  UNPROTECTED_DESIGN,
  buildReferenceCascade,
  getComponentDefinition,
  type CascadeDesign,
} from "@forgelab/reactor-components";
import { buildStarterAssembly, buildOverloadDemo } from "./scenes.js";

export type GizmoMode = "translate" | "rotate";

/** Engineering overlay channels. Presentation only: the solver never reads this. */
export type HazardChannel =
  "off" | "radiant" | "hot-gas" | "fire" | "gas-cloud" | "pressure" | "debris" | "electrical";

export type BottomTab = "failures" | "cascade";

export type CascadeDemo = "unprotected" | "protected" | "breaker-only";

const CASCADE_DEMOS: Record<CascadeDemo, { design: CascadeDesign; title: string }> = {
  unprotected: { design: UNPROTECTED_DESIGN, title: "Cascade — unprotected plant" },
  protected: { design: PROTECTED_DESIGN, title: "Cascade — protected plant" },
  "breaker-only": {
    design: { ...UNPROTECTED_DESIGN, fastArcProtection: true },
    title: "Cascade — fast breaker only",
  },
};

/** Real-time budget per frame for re-simulating to a replay target. */
const REPLAY_BUDGET_MS = 25;

/**
 * Everything the interface needs to draw itself, derived from a simulation snapshot.
 *
 * This object is the entire contract between the engine and React. It is read-only, it
 * is rebuilt rather than mutated, and it contains no physics — only what the solver has
 * already decided.
 */
export interface UiState {
  readonly version: number;
  readonly assemblyName: string;
  readonly tick: number;
  readonly simulatedTimeSec: number;
  readonly speed: number;
  readonly gravityMps2: number;
  readonly failurePropagation: FailurePropagationMode;
  readonly dynamicsBackendId: string;
  readonly snapEnabled: boolean;
  readonly snapSizeM: number;
  readonly showCenterOfMass: boolean;
  readonly gizmoMode: GizmoMode;
  readonly selectedId: string | null;
  readonly components: readonly SimulationComponent[];
  readonly connections: readonly Connection[];
  readonly assembly: AssemblyMassProperties;
  readonly failures: readonly FailureEvent[];
  readonly diagnostics: readonly string[];
  readonly maxUtilization: number;
  readonly status: string;
  readonly cascade: CascadeSnapshot | undefined;
  readonly hazardView: HazardChannel;
  readonly bottomTab: BottomTab;
  readonly selectedEventId: string | null;
  /** Progress of a jump to an earlier or later instant, re-simulated deterministically. */
  readonly replay: { readonly targetTick: number; readonly progress: number } | null;
}

type Listener = () => void;

const STORAGE_KEY = "forgelab.assembly.v1";

/**
 * The bridge between the simulation and the interface.
 *
 * It is a plain TypeScript object with no React in it. React subscribes to it through
 * `useSyncExternalStore`; the 3D scene reads the live world directly each frame. Commands
 * flow one way — the interface asks the world to change, the world decides what is true,
 * and the interface redraws what came back. No UI state is ever consulted by physics.
 */
export class ForgeLabStore {
  #world: SimulationWorld;
  #loop: SimulationLoop;
  #listeners = new Set<Listener>();
  #version = 0;
  #cachedUi: UiState | undefined;

  #selectedId: string | null = null;
  #snapEnabled = true;
  #snapSizeM = DEFAULT_SNAP_SIZE_M;
  #showCenterOfMass = true;
  #gizmoMode: GizmoMode = "translate";
  #status = "Ready.";
  #lastPublishedTick = -1;
  #lastPublishAtMs = 0;
  #hazardView: HazardChannel = "off";
  #bottomTab: BottomTab = "failures";
  #selectedEventId: string | null = null;
  #replay: { targetTick: number; startTick: number; resumeSpeed: number } | null = null;

  constructor() {
    this.#world = new SimulationWorld({ name: "Starter Assembly" });
    buildStarterAssembly(this.#world);
    this.#loop = new SimulationLoop(this.#world, { speed: 0 });
    this.#world.solve();
  }

  get world(): SimulationWorld {
    return this.#world;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getUiState = (): UiState => {
    if (this.#cachedUi === undefined) this.#cachedUi = this.#buildUiState();
    return this.#cachedUi;
  };

  /* -------------------------------------------------------------------------------- *
   * Simulation clock
   * -------------------------------------------------------------------------------- */

  /**
   * Called once per rendered frame. The frame's elapsed time decides how many fixed
   * steps are due; it never changes the size of a step, so frame rate cannot change
   * what the simulation computes.
   */
  advance(realDeltaSec: number): void {
    if (this.#replay !== null) {
      this.#advanceReplay();
      return;
    }
    const steps = this.#loop.advance(realDeltaSec);
    if (steps === 0) return;
    this.#publishThrottled();
  }

  setSpeed(speed: number): void {
    this.#loop.speed = speed;
    this.#status = speed === 0 ? "Paused." : `Running at ${speed}x.`;
    this.#publish();
  }

  togglePlay(): void {
    this.setSpeed(this.#loop.speed === 0 ? 1 : 0);
  }

  reset(): void {
    this.#loop.reset();
    this.#status = "Reset to the authored placement.";
    this.#publish();
  }

  /* -------------------------------------------------------------------------------- *
   * Cascade: hazard view and replay
   * -------------------------------------------------------------------------------- */

  setHazardView(channel: HazardChannel): void {
    this.#hazardView = channel;
    this.#publish();
  }

  setBottomTab(tab: BottomTab): void {
    this.#bottomTab = tab;
    this.#publish();
  }

  /**
   * Jumps to the instant a cascade event happened.
   *
   * There is no recording to scrub through. The simulation is deterministic, so the
   * world is reset and re-simulated to the event's tick: the replay *is* the simulation,
   * bit for bit. Jumping forward simply runs ahead.
   */
  jumpToEvent(eventId: string): void {
    const event = this.#world.getSnapshot().cascade?.events.find((e) => e.id === eventId);
    if (event === undefined) return;
    this.#selectedEventId = eventId;
    this.#selectedId = event.componentId;
    this.#startReplay(event.tick + 1);
    this.#status = `Replaying to ${event.id} at t = ${event.timeSec.toFixed(1)} s...`;
    this.#publish();
  }

  /** Restarts the run from the authored design and plays the cascade at 10x. */
  watchCascade(): void {
    this.#replay = null;
    this.#loop.reset();
    this.#selectedEventId = null;
    this.#bottomTab = "cascade";
    this.setSpeed(10);
    this.#status = "Watching the cascade unfold from the start at 10x.";
    this.#publish();
  }

  loadCascadeDemo(demo: CascadeDemo): void {
    const { design, title } = CASCADE_DEMOS[demo];
    this.#replaceWorld(new SimulationWorld({ name: title }), (world) => {
      buildReferenceCascade(world, design);
    });
    this.#bottomTab = "cascade";
    this.#selectedEventId = null;
    this.#showCenterOfMass = false;
    this.#status = `${title}: one induced fault, a degraded joint on the switchgear bus. Press Play (30x is useful).`;
    this.#publish();
  }

  #startReplay(targetTick: number): void {
    const resumeSpeed = 0;
    if (targetTick < this.#world.tick) this.#loop.reset();
    this.#loop.speed = 0;
    this.#replay = { targetTick, startTick: this.#world.tick, resumeSpeed };
  }

  #advanceReplay(): void {
    const replay = this.#replay!;
    const started = performance.now();
    while (this.#world.tick < replay.targetTick && performance.now() - started < REPLAY_BUDGET_MS) {
      this.#loop.stepExact(Math.min(60, replay.targetTick - this.#world.tick));
    }
    if (this.#world.tick >= replay.targetTick) {
      this.#replay = null;
      this.#loop.speed = replay.resumeSpeed;
      this.#status = `At t = ${this.#world.simulatedTimeSec.toFixed(1)} s. Paused on the selected event.`;
    }
    this.#publish();
  }

  setGravityEnabled(enabled: boolean): void {
    this.#world.updateSettings({ gravityMps2: enabled ? STANDARD_GRAVITY_MPS2 : 0 });
    this.#status = enabled ? "Gravity on (9.80665 m/s^2)." : "Gravity off (debug).";
    this.#publish();
  }

  setFailurePropagation(mode: FailurePropagationMode): void {
    this.#world.updateSettings({ failurePropagation: mode });
    this.#status =
      mode === "detach"
        ? "Yielded members will release what they are holding."
        : "Failures are reported without collapsing the structure.";
    this.#publish();
  }

  /**
   * Swaps in the optional Rapier rigid-body backend for falling debris.
   * Structural analysis is unaffected either way; see docs/ARCHITECTURE.md.
   */
  async setRapierEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.#world.setDynamicsBackend(new BuiltInDynamicsBackend());
      this.#status = "Using ForgeLab's own integrator.";
      this.#publish();
      return;
    }
    try {
      const { RapierDynamicsBackend } = await import("@forgelab/sim-core/rapier");
      const backend: DynamicsBackend & { init(): Promise<void> } = new RapierDynamicsBackend();
      await backend.init();
      this.#world.setDynamicsBackend(backend);
      this.#status = "Using Rapier for rigid-body collision (non-authoritative).";
    } catch (error) {
      this.#status = `Could not load Rapier: ${messageOf(error)}`;
    }
    this.#publish();
  }

  /* -------------------------------------------------------------------------------- *
   * Authoring
   * -------------------------------------------------------------------------------- */

  select(id: string | null): void {
    this.#selectedId = id;
    this.#publish();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.#gizmoMode = mode;
    this.#publish();
  }

  setSnapEnabled(enabled: boolean): void {
    this.#snapEnabled = enabled;
    this.#status = enabled
      ? `Snapping on: ${this.#snapSizeM} m grid, parts connect within ${CONNECTION_SNAP_TOLERANCE_M} m.`
      : "Snapping off: free placement, no automatic connections.";
    this.#publish();
  }

  setSnapSize(sizeM: number): void {
    this.#snapSizeM = sizeM;
    this.#publish();
  }

  setShowCenterOfMass(show: boolean): void {
    this.#showCenterOfMass = show;
    this.#publish();
  }

  /** Places a catalogue component in front of the camera's focus, clear of the ground. */
  addComponent(type: string): void {
    const definition = getComponentDefinition(type);
    const id = this.#world.nextId(type);
    const spawn = this.#nextSpawnPosition(definition.nominalSizeM);

    this.#world.addComponent(
      definition.createSpec({
        id,
        transform: makeTransform(spawn, QuaternionMath.QUATERNION_IDENTITY),
      }),
    );
    this.#reconcileConnections(id);
    this.#selectedId = id;
    this.#status = `Placed ${definition.name}.`;
    this.#publish();
  }

  deleteSelected(): void {
    const id = this.#selectedId;
    if (id === null) return;
    this.#world.removeComponent(id);
    this.#selectedId = null;
    this.#status = `Deleted ${id}.`;
    this.#publish();
  }

  duplicateSelected(): void {
    const id = this.#selectedId;
    if (id === null) return;
    const source = this.#world.requireComponent(id);
    const offset = vec3(
      source.transform.positionM.x + 2,
      source.transform.positionM.y,
      source.transform.positionM.z,
    );
    const copy = this.#world.duplicateComponent(
      id,
      makeTransform(this.#applySnap(offset), source.transform.rotation),
    );
    this.#reconcileConnections(copy.id);
    this.#selectedId = copy.id;
    this.#status = `Duplicated ${id}.`;
    this.#publish();
  }

  /** Commits a gizmo drag. Snapping is applied here, before the world ever sees it. */
  setTransform(id: string, positionM: Vec3, rotation: Quaternion): void {
    const placement: Transform = makeTransform(this.#applySnap(positionM), rotation);
    this.#world.setTransform(id, placement);
    this.#reconcileConnections(id);
    this.#status = `Moved ${id}.`;
    this.#publish();
  }

  setMaterial(id: string, materialId: MaterialId): void {
    this.#world.setMaterial(id, materialId);
    this.#status = `${id} is now ${materialId}; mass recalculated from density.`;
    this.#publish();
  }

  setAdditionalMass(id: string, additionalMassKg: number): void {
    if (!Number.isFinite(additionalMassKg) || additionalMassKg < 0) return;
    this.#world.setAdditionalMass(id, additionalMassKg);
    this.#publish();
  }

  setAnchored(id: string, anchored: boolean): void {
    this.#world.setAnchored(id, anchored);
    this.#status = anchored ? `${id} pinned in place.` : `${id} released.`;
    this.#publish();
  }

  setAssemblyName(name: string): void {
    this.#world.name = name;
    this.#publish();
  }

  /* -------------------------------------------------------------------------------- *
   * Scenes and files
   * -------------------------------------------------------------------------------- */

  loadStarterAssembly(): void {
    this.#replaceWorld(new SimulationWorld({ name: "Starter Assembly" }), (world) => {
      buildStarterAssembly(world);
    });
    this.#status = "Loaded the starter assembly.";
    this.#publish();
  }

  loadOverloadDemo(): void {
    this.#replaceWorld(new SimulationWorld({ name: "Overload Demo" }), (world) => {
      buildOverloadDemo(world);
    });
    this.#status =
      "Overload demo: copper legs under a filled vessel. Open the failure log for the load chain.";
    this.#publish();
  }

  clear(): void {
    this.#replaceWorld(new SimulationWorld({ name: "Untitled Assembly" }), () => {});
    this.#status = "Cleared the workspace.";
    this.#publish();
  }

  toJson(): string {
    return toJson(this.#world, {
      generator: "forgelab-web",
      savedAtIso: new Date().toISOString(),
    });
  }

  saveLocal(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, this.toJson());
      this.#status = `Saved "${this.#world.name}" to this browser.`;
    } catch (error) {
      this.#status = `Could not save: ${messageOf(error)}`;
    }
    this.#publish();
  }

  loadLocal(): void {
    try {
      const json = window.localStorage.getItem(STORAGE_KEY);
      if (json === null) {
        this.#status = "Nothing saved in this browser yet.";
        this.#publish();
        return;
      }
      this.loadJson(json, "browser storage");
    } catch (error) {
      this.#status = `Could not load: ${messageOf(error)}`;
      this.#publish();
    }
  }

  hasLocalSave(): boolean {
    try {
      return window.localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  loadJson(json: string, source: string): void {
    try {
      const world = worldFromJson(json);
      this.#adoptWorld(world);
      this.#status = `Loaded "${world.name}" from ${source}.`;
    } catch (error) {
      this.#status = `Could not read that file: ${messageOf(error)}`;
    }
    this.#publish();
  }

  /* -------------------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------------------- */

  #replaceWorld(world: SimulationWorld, build: (world: SimulationWorld) => void): void {
    build(world);
    this.#adoptWorld(world);
  }

  #adoptWorld(world: SimulationWorld): void {
    const speed = this.#loop.speed;
    this.#replay = null;
    this.#selectedEventId = null;
    this.#world = world;
    this.#loop = new SimulationLoop(world, { speed });
    this.#selectedId = null;
    this.#lastPublishedTick = -1;
    world.solve();
  }

  #applySnap(positionM: Vec3): Vec3 {
    return this.#snapEnabled ? snapVec3(positionM, this.#snapSizeM) : positionM;
  }

  /**
   * Keeps a component's connections consistent with where it actually is.
   *
   * Sockets that have been pulled apart stop being connected; compatible sockets that
   * have come within tolerance connect. This is authoring behaviour, not physics: the
   * solver is handed the resulting connection list and asked what it means.
   */
  #reconcileConnections(componentId: string): void {
    if (!this.#snapEnabled) return;
    const world = this.#world;
    const component = world.getComponent(componentId);
    if (component === undefined) return;

    for (const connection of component.connections) {
      if (!this.#stillTouching(connection)) world.disconnect(connection.id);
    }
    for (const candidate of world.findConnectionCandidates(componentId)) {
      world.connect(candidate.from, candidate.to);
    }
  }

  #stillTouching(connection: Connection): boolean {
    const world = this.#world;
    const a = world.getComponent(connection.from.componentId);
    const b = world.getComponent(connection.to.componentId);
    if (a === undefined || b === undefined) return false;

    const socketA = a.connectionPoints.find((p) => p.id === connection.from.connectionPointId);
    const socketB = b.connectionPoints.find((p) => p.id === connection.to.connectionPointId);
    if (socketA === undefined || socketB === undefined) return false;

    const pa = worldPoint(a, socketA.localPosition);
    const pb = worldPoint(b, socketB.localPosition);
    return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) <= CONNECTION_SNAP_TOLERANCE_M;
  }

  /** Finds a clear spot on the ground so new parts do not land inside existing ones. */
  #nextSpawnPosition(nominalSizeM: Vec3): Vec3 {
    const restingY = nominalSizeM.y / 2 + this.#world.settings.groundLevelM;
    const occupied = this.#world.listComponents();

    for (let ring = 0; ring < 12; ring += 1) {
      for (let i = 0; i <= ring * 8; i += 1) {
        const angle = (i / Math.max(1, ring * 8)) * Math.PI * 2;
        const radius = ring * 4;
        const candidate = this.#applySnap(
          vec3(Math.cos(angle) * radius, restingY, Math.sin(angle) * radius),
        );
        const clear = occupied.every((component) => {
          const dx = component.state.physical.positionM.x - candidate.x;
          const dz = component.state.physical.positionM.z - candidate.z;
          return Math.hypot(dx, dz) > 3.5;
        });
        if (clear) return candidate;
      }
    }
    return this.#applySnap(vec3(0, restingY, 0));
  }

  /** Publishes at most ~15 times a second: the 3D scene reads live state every frame. */
  #publishThrottled(): void {
    const nowMs = performance.now();
    if (this.#world.tick === this.#lastPublishedTick) return;
    if (nowMs - this.#lastPublishAtMs < 66) return;
    this.#lastPublishAtMs = nowMs;
    this.#publish();
  }

  #publish(): void {
    this.#version += 1;
    this.#lastPublishedTick = this.#world.tick;
    this.#cachedUi = undefined;
    for (const listener of this.#listeners) listener();
  }

  #buildUiState(): UiState {
    const snapshot = this.#world.getSnapshot();
    let maxUtilization = 0;
    for (const component of snapshot.components) {
      maxUtilization = Math.max(maxUtilization, component.state.structural.utilization);
    }

    return {
      version: this.#version,
      assemblyName: this.#world.name,
      tick: snapshot.tick,
      simulatedTimeSec: snapshot.simulatedTimeSec,
      speed: this.#loop.speed,
      gravityMps2: snapshot.settings.gravityMps2,
      failurePropagation: snapshot.settings.failurePropagation,
      dynamicsBackendId: this.#world.dynamicsBackendId,
      snapEnabled: this.#snapEnabled,
      snapSizeM: this.#snapSizeM,
      showCenterOfMass: this.#showCenterOfMass,
      gizmoMode: this.#gizmoMode,
      selectedId: this.#selectedId,
      components: snapshot.components,
      connections: snapshot.connections,
      assembly: snapshot.assembly,
      failures: snapshot.failures,
      diagnostics: snapshot.diagnostics,
      maxUtilization,
      status: this.#status,
      cascade: snapshot.cascade,
      hazardView: this.#hazardView,
      bottomTab: this.#bottomTab,
      selectedEventId: this.#selectedEventId,
      replay:
        this.#replay === null
          ? null
          : {
              targetTick: this.#replay.targetTick,
              progress:
                (this.#world.tick - Math.min(this.#replay.startTick, this.#world.tick)) /
                Math.max(
                  this.#replay.targetTick - Math.min(this.#replay.startTick, this.#world.tick),
                  1,
                ),
            },
    };
  }
}

function worldPoint(component: SimulationComponent, localPosition: Vec3): Vec3 {
  const { positionM, rotation } = component.state.physical;
  const rotated = QuaternionMath.rotateVec3(rotation, localPosition);
  return vec3(positionM.x + rotated.x, positionM.y + rotated.y, positionM.z + rotated.z);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const MATERIAL_OPTIONS = Object.values(MaterialIds);
export const COMPONENT_PALETTE = COMPONENT_DEFINITIONS;
