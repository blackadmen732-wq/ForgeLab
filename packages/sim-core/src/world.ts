import type { MaterialId } from "@forgelab/materials";
import { type Seconds, type Transform, Vec3Math, localPointToWorld } from "@forgelab/shared";
import {
  type ComponentSpec,
  type PhysicalProperties,
  type SimulationComponent,
  createComponent,
  currentTransform,
  withComponent,
  withPhysical,
  withPlantState,
  withSolverState,
} from "./component.js";
import type { ComponentParameters } from "./plant/roles.js";
import { PlantSolver } from "./plant/solver.js";
import { EMPTY_PLANT_METRICS, type PlantSummary } from "./plant/state.js";
import {
  CONNECTION_SNAP_TOLERANCE_M,
  type ComponentId,
  type Connection,
  type ConnectionId,
  type ConnectionType,
  type ConnectionPoint,
} from "./connections.js";
import { type BuiltInDynamicsBackend } from "./dynamics/builtin-backend.js";
import { BuiltInDynamicsBackend as DefaultBackend } from "./dynamics/builtin-backend.js";
import type { DynamicsBackend } from "./dynamics/backend.js";
import { type FailureEvent, failureKey } from "./failure.js";
import type { ComponentGeometry } from "./geometry.js";
import { DEFAULT_SIMULATION_SETTINGS, type SimulationSettings, makeSettings } from "./settings.js";
import { gravityAccelerationVector } from "./systems/gravity.js";
import {
  type AssemblyMassProperties,
  computeAssemblyMassProperties,
} from "./systems/center-of-mass.js";
import { solveStructure } from "./systems/structural.js";

export type { BuiltInDynamicsBackend };

/**
 * The immutable view of the simulation that rendering and UI read.
 *
 * Nothing outside `SimulationWorld` ever mutates simulation state. A renderer takes a
 * snapshot, draws it, and throws it away; the next snapshot is a fresh object graph.
 * Components are always ordered by id so that two snapshots of equal state compare equal.
 */
export interface SimulationSnapshot {
  readonly tick: number;
  readonly simulatedTimeSec: Seconds;
  readonly settings: SimulationSettings;
  readonly components: readonly SimulationComponent[];
  readonly connections: readonly Connection[];
  readonly assembly: AssemblyMassProperties;
  /** Failures raised so far this run, oldest first. */
  readonly failures: readonly FailureEvent[];
  /** Problems with the model rather than with the structure. */
  readonly diagnostics: readonly string[];
  /** Plant-wide results: power balance, networks, loops and model confidence. */
  readonly plant: PlantSummary;
}

const EMPTY_PLANT_SUMMARY: PlantSummary = Object.freeze({
  metrics: EMPTY_PLANT_METRICS,
  islands: Object.freeze([]),
  loops: Object.freeze([]),
  confidence: Object.freeze({ level: "supported", subsystems: Object.freeze([]) }),
});

export interface WorldOptions {
  readonly name?: string;
  readonly settings?: Partial<SimulationSettings>;
  readonly dynamics?: DynamicsBackend;
}

/**
 * The authoritative simulation.
 *
 * Everything physical lives here. There is exactly one way to advance time — `step()`,
 * one fixed timestep — and exactly one way to observe state — `getSnapshot()`. There is
 * no React in this file, no Three.js, and no DOM; the class runs unchanged in Node, in a
 * worker, or on a server.
 */
export class SimulationWorld {
  #name: string;
  #settings: SimulationSettings;
  #components = new Map<ComponentId, SimulationComponent>();
  #connections = new Map<ConnectionId, Connection>();
  #failures: FailureEvent[] = [];
  #raisedFailureKeys = new Set<string>();
  #failedComponentIds = new Set<ComponentId>();
  #diagnostics: readonly string[] = [];
  #dynamics: DynamicsBackend;
  #tick = 0;
  #simulatedTimeSec: Seconds = 0;
  #idCounter = 0;
  #dirty = true;
  #plant = new PlantSolver();
  /**
   * Bumped on every change that can alter a solver's inputs: design edits, settings, and
   * bodies moving. Solvers whose inputs have not changed are not re-run; their previous
   * result is exactly what they would compute again.
   */
  #revision = 0;
  #structureSolvedAtRevision = -1;
  #plantSummary: PlantSummary = EMPTY_PLANT_SUMMARY;
  #plantDiagnostics: readonly string[] = [];

  constructor(options: WorldOptions = {}) {
    this.#name = options.name ?? "Untitled Assembly";
    this.#settings = makeSettings(options.settings ?? {});
    this.#dynamics = options.dynamics ?? new DefaultBackend();
  }

  get name(): string {
    return this.#name;
  }

  set name(value: string) {
    this.#name = value;
  }

  get settings(): SimulationSettings {
    return this.#settings;
  }

  get tick(): number {
    return this.#tick;
  }

  get simulatedTimeSec(): Seconds {
    return this.#simulatedTimeSec;
  }

  /** Increments whenever anything that feeds the solvers changes. */
  get revision(): number {
    return this.#revision;
  }

  #markDirty(): void {
    this.#dirty = true;
    this.#revision += 1;
  }

  get dynamicsBackendId(): string {
    return this.#dynamics.id;
  }

  /**
   * Replaces simulation settings. Any change invalidates the solved state, so the next
   * snapshot re-solves rather than reporting loads computed under the old settings.
   */
  updateSettings(changes: Partial<SimulationSettings>): SimulationSettings {
    this.#settings = makeSettings({ ...this.#settings, ...changes });
    this.#markDirty();
    return this.#settings;
  }

  /** Swaps the rigid-body integrator. Structural analysis is unaffected either way. */
  setDynamicsBackend(backend: DynamicsBackend): void {
    this.#dynamics.dispose?.();
    this.#dynamics = backend;
  }

  /* ---------------------------------------------------------------------------------- *
   * Components
   * ---------------------------------------------------------------------------------- */

  /** Deterministic id generator: no randomness anywhere in the engine. */
  nextId(prefix: string): string {
    this.#idCounter += 1;
    return `${prefix}-${this.#idCounter}`;
  }

  addComponent(spec: ComponentSpec): SimulationComponent {
    if (this.#components.has(spec.id)) {
      throw new Error(`A component with id "${spec.id}" already exists in this world.`);
    }
    const component = createComponent(spec);
    this.#components.set(component.id, component);
    this.#markDirty();
    return component;
  }

  getComponent(id: ComponentId): SimulationComponent | undefined {
    return this.#components.get(id);
  }

  requireComponent(id: ComponentId): SimulationComponent {
    const component = this.#components.get(id);
    if (component === undefined) throw new Error(`No component with id "${id}".`);
    return component;
  }

  listComponents(): readonly SimulationComponent[] {
    return [...this.#components.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  removeComponent(id: ComponentId): void {
    if (!this.#components.delete(id)) return;
    for (const [connectionId, connection] of [...this.#connections]) {
      if (connection.from.componentId === id || connection.to.componentId === id) {
        this.#connections.delete(connectionId);
      }
    }
    this.#failedComponentIds.delete(id);
    this.#markDirty();
    this.#refreshComponentConnections();
  }

  /** Moves/rotates a component. This edits the design, so it also resets its live state. */
  setTransform(id: ComponentId, transform: Transform): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { transform });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  setMaterial(id: ComponentId, materialId: MaterialId): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { materialId });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  setGeometry(id: ComponentId, geometry: ComponentGeometry): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { geometry });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  /**
   * Replaces a component's geometry and sockets together (a resize). Connections whose
   * socket no longer exists are removed; mass and socket ratings follow the new geometry.
   */
  reshapeComponent(
    id: ComponentId,
    geometry: ComponentGeometry,
    connectionPoints: readonly ConnectionPoint[],
  ): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), {
      geometry,
      connectionPoints: Object.freeze([...connectionPoints]),
    });
    this.#components.set(id, updated);
    const socketIds = new Set(connectionPoints.map((point) => point.id));
    for (const [connectionId, connection] of [...this.#connections]) {
      const end =
        connection.from.componentId === id
          ? connection.from
          : connection.to.componentId === id
            ? connection.to
            : undefined;
      if (end !== undefined && !socketIds.has(end.connectionPointId)) {
        this.#connections.delete(connectionId);
      }
    }
    this.#refreshComponentConnections();
    this.#markDirty();
    return this.#components.get(id)!;
  }

  setAdditionalMass(id: ComponentId, additionalMassKg: number): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { additionalMassKg });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  setAnchored(id: ComponentId, anchored: boolean): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { anchored });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  /** Replaces operating parameters (merged over the current ones, then validated). */
  setParameters(
    id: ComponentId,
    parameters: Readonly<Record<string, unknown>>,
  ): SimulationComponent {
    const current = this.requireComponent(id);
    const updated = withComponent(current, {
      parameters: { ...current.parameters, ...parameters } as ComponentParameters,
    });
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  setLabel(id: ComponentId, label: string): SimulationComponent {
    const updated = withComponent(this.requireComponent(id), { label });
    this.#components.set(id, updated);
    return updated;
  }

  /**
   * Copies a component, including its material, geometry and extra mass, but none of its
   * connections: a duplicate is an unattached part until the builder attaches it.
   */
  duplicateComponent(id: ComponentId, transform?: Transform): SimulationComponent {
    const source = this.requireComponent(id);
    return this.addComponent({
      id: this.nextId(source.type),
      type: source.type,
      geometry: source.geometry,
      materialId: source.materialId,
      transform: transform ?? source.transform,
      connectionPoints: source.connectionPoints,
      additionalMassKg: source.additionalMassKg,
      anchored: source.anchored,
      label: source.label,
      role: source.role,
      parameters: source.parameters,
    });
  }

  /* ---------------------------------------------------------------------------------- *
   * Connections
   * ---------------------------------------------------------------------------------- */

  connect(
    from: { componentId: ComponentId; connectionPointId: string },
    to: { componentId: ComponentId; connectionPointId: string },
    options: { id?: ConnectionId; type?: ConnectionType; maxLoadN?: number } = {},
  ): Connection {
    if (from.componentId === to.componentId) {
      throw new Error("A component cannot be connected to itself.");
    }
    const a = this.requireComponent(from.componentId);
    const b = this.requireComponent(to.componentId);
    const socketA = requireSocket(a, from.connectionPointId);
    const socketB = requireSocket(b, to.connectionPointId);

    const id = options.id ?? this.nextId("conn");
    if (this.#connections.has(id)) {
      throw new Error(`A connection with id "${id}" already exists in this world.`);
    }

    const type = options.type ?? socketA.connectionType;
    const connection: Connection = Object.freeze({
      id,
      type,
      from: Object.freeze({ componentId: a.id, connectionPointId: socketA.id }),
      to: Object.freeze({ componentId: b.id, connectionPointId: socketB.id }),
      ...(options.maxLoadN === undefined ? {} : { maxLoadN: options.maxLoadN }),
    });

    this.#connections.set(id, connection);
    this.#markDirty();
    this.#refreshComponentConnections();
    return connection;
  }

  disconnect(connectionId: ConnectionId): void {
    if (!this.#connections.delete(connectionId)) return;
    this.#markDirty();
    this.#refreshComponentConnections();
  }

  listConnections(): readonly Connection[] {
    return [...this.#connections.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Finds compatible socket pairs that are within `toleranceM` of each other.
   *
   * This is an authoring aid for the workspace's snap-to-connect behaviour. It reads
   * geometry and returns candidates; it never creates a connection by itself.
   */
  findConnectionCandidates(
    componentId: ComponentId,
    toleranceM: number = CONNECTION_SNAP_TOLERANCE_M,
  ): readonly {
    from: { componentId: ComponentId; connectionPointId: string };
    to: { componentId: ComponentId; connectionPointId: string };
    distanceM: number;
  }[] {
    const subject = this.requireComponent(componentId);
    const results: {
      from: { componentId: ComponentId; connectionPointId: string };
      to: { componentId: ComponentId; connectionPointId: string };
      distanceM: number;
    }[] = [];

    for (const socket of subject.connectionPoints) {
      const worldPoint = localPointToWorld(currentTransform(subject), socket.localPosition);
      for (const other of this.listComponents()) {
        if (other.id === subject.id) continue;
        for (const otherSocket of other.connectionPoints) {
          if (otherSocket.connectionType !== socket.connectionType) continue;
          const otherPoint = localPointToWorld(currentTransform(other), otherSocket.localPosition);
          const distanceM = Vec3Math.distance(worldPoint, otherPoint);
          if (distanceM > toleranceM) continue;
          if (this.#hasConnectionBetween(subject.id, socket.id, other.id, otherSocket.id)) continue;
          results.push({
            from: { componentId: subject.id, connectionPointId: socket.id },
            to: { componentId: other.id, connectionPointId: otherSocket.id },
            distanceM,
          });
        }
      }
    }

    return results.sort((x, y) => x.distanceM - y.distanceM);
  }

  /* ---------------------------------------------------------------------------------- *
   * Simulation
   * ---------------------------------------------------------------------------------- */

  /**
   * Re-runs structural analysis without advancing time.
   *
   * The workspace calls this while paused so that loads, stresses and the centre of mass
   * are correct the instant a part is placed, before anybody presses play.
   */
  solve(): void {
    this.#solveStructure();
    // Nothing has happened yet at tick 0, so the plant starts from fresh initial conditions
    // that reflect the current design (loop temperatures, vessel pressures...).
    if (this.#tick === 0) this.#plant.reset();
    this.#runPlant(0);
    this.#dirty = false;
  }

  #solveStructure(): void {
    const failuresBefore = this.#failures.length;
    this.#structureSolvedAtRevision = this.#revision;
    const result = solveStructure({
      components: this.listComponents(),
      connections: this.listConnections(),
      settings: this.#settings,
      simulatedTimeSec: this.#simulatedTimeSec,
      tick: this.#tick,
      previouslyFailedComponentIds: this.#failedComponentIds,
    });

    for (const [id, state] of result.states) {
      const component = this.#components.get(id);
      if (component === undefined) continue;
      this.#components.set(id, withSolverState(component, state.support, state.structural));
      if (state.structural.failed) this.#failedComponentIds.add(id);
    }

    this.#recordFailures(result.failures);
    // In `detach` mode a newly failed member changes what the next solve sees.
    if (
      this.#settings.failurePropagation === "detach" &&
      this.#failures.length !== failuresBefore
    ) {
      this.#revision += 1;
    }

    this.#diagnostics = Object.freeze([...result.diagnostics]);
  }

  #runPlant(dtSec: number): void {
    const result = this.#plant.step({
      components: this.listComponents(),
      connections: this.listConnections(),
      settings: this.#settings,
      dtSec,
      tick: this.#tick,
      timeSec: this.#simulatedTimeSec,
      topologyRevision: this.#revision,
    });
    for (const [id, plant] of result.states) {
      const component = this.#components.get(id);
      if (component !== undefined) this.#components.set(id, withPlantState(component, plant));
    }
    this.#recordFailures(result.events);
    this.#plantSummary = result.summary;
    this.#plantDiagnostics = Object.freeze([...result.diagnostics]);
  }

  #recordFailures(events: readonly FailureEvent[]): void {
    for (const failure of events) {
      const key = failureKey(failure);
      if (this.#raisedFailureKeys.has(key)) continue;
      this.#raisedFailureKeys.add(key);
      this.#failures.push(failure);
    }
    if (this.#failures.length > this.#settings.maxFailureLogEntries) {
      this.#failures = this.#failures.slice(-this.#settings.maxFailureLogEntries);
    }
  }

  /**
   * Advances the simulation by exactly one fixed timestep.
   *
   * Order matters: structure is solved first so the integrator knows what is held up,
   * then the integrator moves whatever is not. Both run on the same instant of simulated
   * time, and time only advances once both are done.
   */
  step(): void {
    if (this.#structureSolvedAtRevision !== this.#revision) this.#solveStructure();

    const updates = this.#dynamics.step({
      components: this.listComponents(),
      settings: this.#settings,
      fixedTimestepSec: this.#settings.fixedTimestepSec,
      gravityAccelerationMps2: gravityAccelerationVector(this.#settings.gravityMps2),
    });

    for (const [id, physical] of updates) {
      const component = this.#components.get(id);
      if (component === undefined) continue;
      this.#components.set(id, withPhysical(component, physical));
    }

    // Plant physics integrates over the step that is now ending, then time advances.
    this.#runPlant(this.#settings.fixedTimestepSec);

    this.#tick += 1;
    this.#simulatedTimeSec = this.#tick * this.#settings.fixedTimestepSec;
    this.#dirty = false;
    if (updates.size > 0) this.#markDirty();
  }

  /** Runs `count` fixed steps. Equivalent to calling `step()` that many times. */
  stepMany(count: number): void {
    for (let i = 0; i < count; i += 1) this.step();
  }

  /**
   * Returns every component to its authored transform and clears the run.
   *
   * Exact, not approximate: the authored transform was never overwritten, so a reset
   * followed by the same number of steps reproduces the run bit for bit.
   */
  reset(): void {
    for (const [id, component] of [...this.#components]) {
      this.#components.set(id, withComponent(component, { transform: component.transform }));
    }
    this.#tick = 0;
    this.#simulatedTimeSec = 0;
    this.#failures = [];
    this.#raisedFailureKeys.clear();
    this.#failedComponentIds.clear();
    this.#diagnostics = Object.freeze([]);
    this.#plant.reset();
    this.#markDirty();
    this.solve();
  }

  /** Plant-wide results of the latest solve, without building a full snapshot. */
  get plantSummary(): PlantSummary {
    if (this.#dirty) this.solve();
    return this.#plantSummary;
  }

  /** Number of failures raised so far this run (cheaper than a snapshot). */
  get failureCount(): number {
    return this.#failures.length;
  }

  getSnapshot(): SimulationSnapshot {
    if (this.#dirty) this.solve();
    const components = this.listComponents();
    return Object.freeze({
      tick: this.#tick,
      simulatedTimeSec: this.#simulatedTimeSec,
      settings: this.#settings,
      components,
      connections: this.listConnections(),
      assembly: computeAssemblyMassProperties(components),
      failures: Object.freeze([...this.#failures]),
      diagnostics: Object.freeze([...this.#diagnostics, ...this.#plantDiagnostics]),
      plant: this.#plantSummary,
    });
  }

  /**
   * Restores a component's live kinematic state without touching its authored transform.
   *
   * Used when loading a save file that captured a run in progress. Ordinary editing goes
   * through `setTransform`, which resets the live state on purpose.
   */
  restorePhysical(id: ComponentId, physical: PhysicalProperties): SimulationComponent {
    const updated = withPhysical(this.requireComponent(id), physical);
    this.#components.set(id, updated);
    this.#markDirty();
    return updated;
  }

  /** Restores counters and clock when loading a save file. Not for general use. */
  restoreRuntime(state: { tick: number; simulatedTimeSec: Seconds; idCounter: number }): void {
    this.#tick = state.tick;
    this.#simulatedTimeSec = state.simulatedTimeSec;
    this.#idCounter = Math.max(this.#idCounter, state.idCounter);
    this.#markDirty();
  }

  get idCounter(): number {
    return this.#idCounter;
  }

  #hasConnectionBetween(
    aId: ComponentId,
    aSocket: string,
    bId: ComponentId,
    bSocket: string,
  ): boolean {
    for (const connection of this.#connections.values()) {
      const matchesForward =
        connection.from.componentId === aId &&
        connection.from.connectionPointId === aSocket &&
        connection.to.componentId === bId &&
        connection.to.connectionPointId === bSocket;
      const matchesReverse =
        connection.from.componentId === bId &&
        connection.from.connectionPointId === bSocket &&
        connection.to.componentId === aId &&
        connection.to.connectionPointId === aSocket;
      if (matchesForward || matchesReverse) return true;
    }
    return false;
  }

  /**
   * Rebuilds each component's `connections` array from the world's link table.
   *
   * The arrays hold references to the same frozen `Connection` objects the world owns, so
   * a link is stored once and the two ends of it cannot disagree.
   */
  #refreshComponentConnections(): void {
    const byComponent = new Map<ComponentId, Connection[]>();
    for (const connection of this.listConnections()) {
      for (const componentId of [connection.from.componentId, connection.to.componentId]) {
        const bucket = byComponent.get(componentId);
        if (bucket === undefined) byComponent.set(componentId, [connection]);
        else bucket.push(connection);
      }
    }

    for (const [id, component] of [...this.#components]) {
      const connections = Object.freeze(byComponent.get(id) ?? []);
      if (component.connections.length === 0 && connections.length === 0) continue;
      this.#components.set(id, withComponent(component, { connections }));
    }
  }
}

function requireSocket(component: SimulationComponent, connectionPointId: string): ConnectionPoint {
  const socket = component.connectionPoints.find((point) => point.id === connectionPointId);
  if (socket === undefined) {
    const available = component.connectionPoints.map((p) => p.id).join(", ") || "none";
    throw new Error(
      `Component "${component.id}" has no connection point "${connectionPointId}". Available: ${available}.`,
    );
  }
  return socket;
}

export { DEFAULT_SIMULATION_SETTINGS };
