import { getMaterial, type MaterialId } from "@forgelab/materials";
import {
  COMPONENT_DEFINITIONS,
  findComponentDefinition,
  getComponentDefinition,
} from "@forgelab/reactor-components";
import {
  QuaternionMath,
  type Quaternion,
  type Vec3,
  Vec3Math,
  localPointToWorld,
  snapScalar,
  transform as makeTransform,
  vec3,
} from "@forgelab/shared";
import {
  CONNECTION_SNAP_TOLERANCE_M,
  type AssemblyFileV2,
  type Connection,
  type ConnectionEndpoint,
  type FailureEvent,
  type PlantSummary,
  SIMULATION_ENGINE_VERSION,
  type SimulationComponent,
  type SimulationSettings,
  type SimulationSnapshot,
  SimulationWorld,
  checkPortCompatibility,
  currentTransform,
  deserializeWorld,
  isLoadBearing,
  parseAssemblyFile,
  serializeWorld,
  worldAabb,
} from "@forgelab/sim-core";
import {
  type HistoryPoint,
  type SessionEvent,
  type SessionFrame,
  type SessionSpeed,
  designHash,
} from "@forgelab/sim-runner";
import { toast } from "../../lib/toast.js";
import { SimulationClient } from "../sim/client.js";
import { SocketIndex } from "./socketIndex.js";
import { CloudSync, type CloudBinding, type SaveState, writeLocalDraft } from "./persistence.js";

/* ------------------------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------------------------ */

export type Mode = "build" | "simulate";
export type Tool = "select" | "move" | "rotate" | "connect" | "box";
export type Overlay =
  "none" | "stress" | "temperature" | "power" | "coolant" | "magnetic" | "plasma" | "failures";
export type Projection = "perspective" | "orthographic";
export type ViewName = "front" | "right" | "top" | "iso";

export const OVERLAYS: readonly { id: Overlay; label: string; hint: string }[] = [
  { id: "none", label: "Normal", hint: "Machines as they look, in their material colours." },
  {
    id: "stress",
    label: "Stress",
    hint: "Governing structural utilization: grey → amber → red at yield or buckling.",
  },
  {
    id: "temperature",
    label: "Temperature",
    hint: "Temperature relative to each part's limit: blue cold → white → orange at the limit.",
  },
  {
    id: "power",
    label: "Power",
    hint: "Electrical supply: bright where a load gets its full demand, red where it is starved.",
  },
  { id: "coolant", label: "Coolant", hint: "Coolant mass flow through loop components." },
  { id: "magnetic", label: "Magnetic", hint: "Magnetic field at the plasma from each coil." },
  {
    id: "plasma",
    label: "Plasma",
    hint: "Vessels coloured by plasma state; everything else dimmed.",
  },
  {
    id: "failures",
    label: "Failures",
    hint: "Failed and disabled parts in red; everything else dimmed.",
  },
];

export type CameraRequest =
  | { readonly kind: "frame"; readonly ids: readonly string[] | null; readonly nonce: number }
  | { readonly kind: "view"; readonly view: ViewName; readonly nonce: number }
  | {
      readonly kind: "pose";
      readonly position: readonly [number, number, number];
      readonly target: readonly [number, number, number];
      readonly nonce: number;
    };

/** The live scene exposes these so the store can place parts and take thumbnails. */
export interface ViewportApi {
  groundPointAt(clientX: number, clientY: number): Vec3 | null;
  focusPoint(): Vec3;
  /** Screen-space (client px) positions for the given world points. */
  project(points: readonly Vec3[]): ({ x: number; y: number } | null)[];
  capture(): Promise<Blob | null>;
}

export interface EditorView {
  readonly revision: number;
  readonly designRevision: number;
  readonly name: string;
  readonly mode: Mode;
  readonly tool: Tool;
  readonly overlay: Overlay;
  readonly cutaway: boolean;
  readonly xray: boolean;
  readonly projection: Projection;
  readonly selection: readonly string[];
  readonly hidden: ReadonlySet<string>;
  readonly snapEnabled: boolean;
  readonly gridM: number;
  readonly angleSnapDeg: number;
  readonly socketSnap: boolean;
  readonly snapshot: SimulationSnapshot;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly connectFrom: ConnectionEndpoint | null;
  readonly drawerOpen: boolean;
  readonly timelineOpen: boolean;
  readonly advanced: boolean;
  readonly cloud: CloudBinding | null;
  readonly save: SaveState;
  readonly showHelp: boolean;
  readonly showPalette: boolean;
  readonly dialog: EditorDialog | null;
  readonly blueprintId: string | null;
}

export type EditorDialog = "start" | "publish" | "versions" | "submit" | "version-name";

export type SimStatus = "idle" | "loading" | "ready" | "error";

export interface SimView {
  readonly status: SimStatus;
  readonly error: string | null;
  readonly speed: SessionSpeed;
  readonly timeSec: number;
  readonly tick: number;
  readonly plant: PlantSummary | null;
  readonly failures: readonly FailureEvent[];
  readonly history: readonly HistoryPoint[];
  readonly detail: SimulationComponent | null;
  readonly droppedTimeSec: number;
  /** Increments with every frame. */
  readonly frameNumber: number;
}

interface HistoryEntry {
  readonly file: AssemblyFileV2;
  readonly selection: readonly string[];
  readonly label: string;
}

export interface TransformUpdate {
  readonly id: string;
  readonly position: Vec3;
  readonly rotation: Quaternion;
}

/** Radius within which a dragged part's socket jumps onto a compatible socket. */
export const SOCKET_SNAP_RADIUS_M = 0.6;
const MAX_UNDO = 100;
const MAX_HISTORY_POINTS = 20_000;
const GENERATOR = "forgelab-web";

/* ------------------------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------------------------ */

/**
 * The builder's state and every command the interface can issue.
 *
 * The store owns an authoring `SimulationWorld` (sim-core) for Build mode — every edit is
 * applied to it and re-solved, so loads, stresses and the plant's start-up state are the
 * engine's own answers. Simulate mode serialises that world into the worker, which runs the
 * time-stepped simulation; frames come back and are drawn as they are. The store never
 * computes physics itself.
 */
export class EditorStore {
  #world: SimulationWorld;
  #snapshot: SimulationSnapshot;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];

  #mode: Mode = "build";
  #tool: Tool = "select";
  #overlay: Overlay = "none";
  #buildOverlay: Overlay = "none";
  #simOverlay: Overlay = "none";
  #cutaway = false;
  #xray = false;
  #projection: Projection = "perspective";
  #selection: string[] = [];
  #hidden = new Set<string>();
  #snapEnabled = true;
  #gridM = 0.25;
  #angleSnapDeg = 15;
  #socketSnap = true;
  #connectFrom: ConnectionEndpoint | null = null;
  // The 3D world is the product: panels start closed and open when needed.
  #drawerOpen = false;
  #timelineOpen = false;
  #advanced = false;
  #showHelp = false;
  #showPalette = false;
  #dialog: EditorDialog | null = null;
  #blueprintId: string | null = null;

  #revision = 0;
  #designRevision = 0;
  #view: EditorView | undefined;
  #listeners = new Set<() => void>();

  // Simulation
  #client: SimulationClient | undefined;
  #sim: SimView = EMPTY_SIM;
  #simListeners = new Set<() => void>();
  #frame: SessionFrame | null = null;
  #frameIndex = new Map<string, number>();

  // Camera
  #cameraRequest: CameraRequest | null = null;
  #cameraNonce = 0;
  #cameraListeners = new Set<() => void>();
  #viewport: ViewportApi | null = null;

  // Persistence
  readonly cloud: CloudSync;
  #draftTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(world?: SimulationWorld) {
    this.#world = world ?? new SimulationWorld({ name: "Untitled Design" });
    this.#world.solve();
    this.#snapshot = this.#world.getSnapshot();
    this.cloud = new CloudSync(
      () => this.exportFile(),
      () => this.projectStats(),
      () => this.#publish(),
    );
  }

  /* ---------------------------------------------------------------------------------- *
   * Subscriptions
   * ---------------------------------------------------------------------------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getView = (): EditorView => {
    this.#view ??= this.#buildView();
    return this.#view;
  };

  subscribeSim = (listener: () => void): (() => void) => {
    this.#simListeners.add(listener);
    return () => this.#simListeners.delete(listener);
  };

  getSim = (): SimView => this.#sim;

  subscribeCamera = (listener: () => void): (() => void) => {
    this.#cameraListeners.add(listener);
    return () => this.#cameraListeners.delete(listener);
  };

  get cameraRequest(): CameraRequest | null {
    return this.#cameraRequest;
  }

  /**
   * The frame the viewport shows: the newest simulation frame, or a recorded one while
   * failure cinema replays the run. Replay never reaches the simulation worker.
   */
  get frame(): SessionFrame | null {
    return this.#replayFrame ?? this.#frame;
  }

  #replayFrame: SessionFrame | null = null;

  /** Show a recorded frame instead of the live one (null returns to live). */
  setReplayFrame = (frame: SessionFrame | null): void => {
    if (frame === this.#replayFrame) return;
    this.#replayFrame = frame;
    if (frame !== null && this.#frameIndex.size !== frame.ids.length) {
      this.#frameIndex.clear();
      frame.ids.forEach((id, i) => this.#frameIndex.set(id, i));
    }
    this.#publishSim({ frameNumber: this.#sim.frameNumber + 1 });
  };

  frameIndexOf(id: string): number | undefined {
    return this.#frameIndex.get(id);
  }

  get world(): SimulationWorld {
    return this.#world;
  }

  /** The live 3D view registers itself here (placement rays, projection, thumbnails). */
  get viewport(): ViewportApi | null {
    return this.#viewport;
  }

  setViewport(api: ViewportApi | null): void {
    this.#viewport = api;
  }

  #publish(): void {
    this.#revision += 1;
    this.#view = undefined;
    for (const listener of this.#listeners) listener();
  }

  #publishSim(next: Partial<SimView>): void {
    this.#sim = { ...this.#sim, ...next };
    for (const listener of this.#simListeners) listener();
  }

  #buildView(): EditorView {
    const undoTop = this.#undo[this.#undo.length - 1];
    const redoTop = this.#redo[this.#redo.length - 1];
    return {
      revision: this.#revision,
      designRevision: this.#designRevision,
      name: this.#world.name,
      mode: this.#mode,
      tool: this.#tool,
      overlay: this.#overlay,
      cutaway: this.#cutaway,
      xray: this.#xray,
      projection: this.#projection,
      selection: this.#selection,
      hidden: this.#hidden,
      snapEnabled: this.#snapEnabled,
      gridM: this.#gridM,
      angleSnapDeg: this.#angleSnapDeg,
      socketSnap: this.#socketSnap,
      snapshot: this.#snapshot,
      canUndo: undoTop !== undefined,
      canRedo: redoTop !== undefined,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
      connectFrom: this.#connectFrom,
      drawerOpen: this.#drawerOpen,
      timelineOpen: this.#timelineOpen,
      advanced: this.#advanced,
      cloud: this.cloud.binding,
      save: this.cloud.state,
      showHelp: this.#showHelp,
      showPalette: this.#showPalette,
      dialog: this.#dialog,
      blueprintId: this.#blueprintId,
    };
  }

  /* ---------------------------------------------------------------------------------- *
   * Editing core
   * ---------------------------------------------------------------------------------- */

  #capture(label: string): HistoryEntry {
    return { file: serializeWorld(this.#world), selection: [...this.#selection], label };
  }

  #restore(entry: HistoryEntry): void {
    const world = deserializeWorld(entry.file);
    this.#world = world;
    this.#selection = entry.selection.filter((id) => world.getComponent(id) !== undefined);
  }

  /**
   * Applies one undoable design change. The world is re-solved afterwards so every
   * reading in the interface is the engine's answer for the new design.
   */
  #edit(label: string, mutate: (world: SimulationWorld) => void): boolean {
    if (this.#mode !== "build") {
      toast("info", "Switch to Build to edit", "The design is locked while the simulation runs.");
      return false;
    }
    const before = this.#capture(label);
    try {
      mutate(this.#world);
    } catch (error) {
      this.#restore(before);
      this.#afterDesignChange(false);
      toast(
        "error",
        `Couldn't ${label.toLowerCase()}`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
    this.#undo.push(before);
    if (this.#undo.length > MAX_UNDO) this.#undo.shift();
    this.#redo = [];
    this.#afterDesignChange(true);
    return true;
  }

  #afterDesignChange(changed: boolean): void {
    this.#world.solve();
    this.#snapshot = this.#world.getSnapshot();
    const ids = new Set(this.#snapshot.components.map((c) => c.id));
    this.#selection = this.#selection.filter((id) => ids.has(id));
    if ([...this.#hidden].some((id) => !ids.has(id)))
      this.#hidden = new Set([...this.#hidden].filter((id) => ids.has(id)));
    if (changed) {
      this.#designRevision += 1;
      this.#scheduleDraft();
      this.cloud.markChanged();
    }
    this.#publish();
  }

  undo = (): void => {
    if (this.#mode !== "build") return;
    const entry = this.#undo.pop();
    if (entry === undefined) return;
    this.#redo.push(this.#capture(entry.label));
    this.#restore(entry);
    this.#afterDesignChange(true);
    toast("info", `Undid: ${entry.label}`, undefined, 1800);
  };

  redo = (): void => {
    if (this.#mode !== "build") return;
    const entry = this.#redo.pop();
    if (entry === undefined) return;
    this.#undo.push(this.#capture(entry.label));
    this.#restore(entry);
    this.#afterDesignChange(true);
    toast("info", `Redid: ${entry.label}`, undefined, 1800);
  };

  /* ---------------------------------------------------------------------------------- *
   * Whole designs
   * ---------------------------------------------------------------------------------- */

  /** Replaces the design. Clears history; the caller decides the cloud binding. */
  replaceWorld(world: SimulationWorld, options: { blueprintId?: string | null } = {}): void {
    if (this.#mode === "simulate") this.stopSimulation();
    this.#world = world;
    this.#undo = [];
    this.#redo = [];
    this.#selection = [];
    this.#hidden = new Set();
    this.#connectFrom = null;
    this.#blueprintId = options.blueprintId ?? null;
    // An empty hall needs machines, so the parts library opens; a loaded design gets the
    // whole view.
    this.#drawerOpen = world.listComponents().length === 0;
    this.#afterDesignChange(true);
    this.requestFrame(null);
  }

  loadFile(file: unknown, options: { name?: string } = {}): void {
    const parsed = parseAssemblyFile(file);
    const world = deserializeWorld(parsed);
    if (options.name !== undefined && options.name.trim() !== "") world.name = options.name;
    this.replaceWorld(world);
  }

  newBlank(name = "Untitled Design"): void {
    this.replaceWorld(new SimulationWorld({ name }));
  }

  /** A click on empty space: drop the selection and put away the parts library. */
  dismissPanels = (): void => {
    const hadConnect = this.#connectFrom !== null;
    this.clearSelection();
    if (!hadConnect && this.#drawerOpen && this.#world.listComponents().length > 0) {
      this.#drawerOpen = false;
      this.#publish();
    }
  };

  exportFile(): AssemblyFileV2 {
    return serializeWorld(this.#world, {
      generator: GENERATOR,
      savedAtIso: new Date().toISOString(),
    });
  }

  exportJson(): string {
    return JSON.stringify(this.exportFile(), null, 2);
  }

  designHash(): string {
    return designHash(serializeWorld(this.#world));
  }

  projectStats(): {
    massKg: number;
    netElectricW?: number;
    fusionPowerW?: number;
    confidence: string;
  } {
    const last = this.#sim.plant;
    return {
      massKg: this.#snapshot.assembly.totalMassKg,
      ...(last === null
        ? {}
        : { netElectricW: last.metrics.netElectricW, fusionPowerW: last.metrics.fusionPowerW }),
      confidence: (last ?? this.#snapshot.plant).confidence.level,
    };
  }

  setName = (name: string): void => {
    const trimmed = name.trim().slice(0, 120);
    if (trimmed === "" || trimmed === this.#world.name) return;
    this.#edit("Rename design", (world) => {
      world.name = trimmed;
    });
  };

  /** Settings are part of the design and saved with it. */
  updateSettings = (changes: Partial<SimulationSettings>): void => {
    this.#edit("Change simulation settings", (world) => {
      world.updateSettings(changes);
    });
  };

  /* ---------------------------------------------------------------------------------- *
   * Selection and visibility (not part of undo history)
   * ---------------------------------------------------------------------------------- */

  select = (ids: readonly string[], mode: "replace" | "toggle" | "add" = "replace"): void => {
    let next: string[];
    if (mode === "replace") next = [...ids];
    else if (mode === "add")
      next = [...this.#selection, ...ids.filter((id) => !this.#selection.includes(id))];
    else {
      next = [...this.#selection];
      for (const id of ids) {
        const at = next.indexOf(id);
        if (at >= 0) next.splice(at, 1);
        else next.push(id);
      }
    }
    this.#selection = next;
    if (this.#mode === "simulate") this.#client?.inspect(next[next.length - 1] ?? null);
    this.#publish();
  };

  selectAll = (): void => {
    this.select(this.#snapshot.components.filter((c) => !this.#hidden.has(c.id)).map((c) => c.id));
  };

  clearSelection = (): void => {
    if (this.#connectFrom !== null) {
      this.#connectFrom = null;
      this.#publish();
      return;
    }
    if (this.#selection.length > 0) this.select([]);
  };

  get primarySelection(): string | null {
    return this.#selection[this.#selection.length - 1] ?? null;
  }

  hideSelected = (): void => {
    if (this.#selection.length === 0) return;
    this.#hidden = new Set([...this.#hidden, ...this.#selection]);
    this.#selection = [];
    this.#publish();
  };

  showAll = (): void => {
    this.#hidden = new Set();
    this.#publish();
  };

  /** Hides everything but the selection; again to undo. */
  toggleIsolate = (): void => {
    if (this.#hidden.size > 0) {
      this.showAll();
      return;
    }
    if (this.#selection.length === 0) return;
    const keep = new Set(this.#selection);
    this.#hidden = new Set(
      this.#snapshot.components.filter((c) => !keep.has(c.id)).map((c) => c.id),
    );
    this.#publish();
    this.requestFrame(this.#selection);
  };

  /* ---------------------------------------------------------------------------------- *
   * UI toggles
   * ---------------------------------------------------------------------------------- */

  setTool = (tool: Tool): void => {
    if (tool !== "select" && tool !== "box" && this.#mode === "simulate") {
      toast("info", "Switch to Build to edit");
      return;
    }
    this.#tool = tool;
    if (tool !== "connect") this.#connectFrom = null;
    this.#publish();
  };

  setOverlay = (overlay: Overlay): void => {
    this.#overlay = overlay;
    if (this.#mode === "simulate") this.#simOverlay = overlay;
    else this.#buildOverlay = overlay;
    this.#publish();
  };

  toggleCutaway = (): void => {
    this.#cutaway = !this.#cutaway;
    this.#publish();
  };

  toggleXray = (): void => {
    this.#xray = !this.#xray;
    this.#publish();
  };

  toggleProjection = (): void => {
    this.#projection = this.#projection === "perspective" ? "orthographic" : "perspective";
    this.#publish();
  };

  setSnapEnabled = (enabled: boolean): void => {
    this.#snapEnabled = enabled;
    this.#publish();
  };

  setGrid = (gridM: number): void => {
    this.#gridM = gridM;
    this.#publish();
  };

  setAngleSnap = (deg: number): void => {
    this.#angleSnapDeg = deg;
    this.#publish();
  };

  setSocketSnap = (enabled: boolean): void => {
    this.#socketSnap = enabled;
    this.#publish();
  };

  toggleDrawer = (open?: boolean): void => {
    this.#drawerOpen = open ?? !this.#drawerOpen;
    this.#publish();
  };

  toggleTimeline = (open?: boolean): void => {
    this.#timelineOpen = open ?? !this.#timelineOpen;
    this.#publish();
  };

  setAdvanced = (advanced: boolean): void => {
    this.#advanced = advanced;
    this.#publish();
  };

  setShowHelp = (show: boolean): void => {
    this.#showHelp = show;
    this.#publish();
  };

  setShowPalette = (show: boolean): void => {
    this.#showPalette = show;
    this.#publish();
  };

  openDialog = (dialog: EditorDialog | null): void => {
    this.#dialog = dialog;
    this.#publish();
  };

  /* ---------------------------------------------------------------------------------- *
   * Camera
   * ---------------------------------------------------------------------------------- */

  requestFrame = (ids: readonly string[] | null): void => {
    this.#cameraNonce += 1;
    this.#cameraRequest = { kind: "frame", ids, nonce: this.#cameraNonce };
    for (const listener of this.#cameraListeners) listener();
  };

  requestView = (view: ViewName): void => {
    this.#cameraNonce += 1;
    this.#cameraRequest = { kind: "view", view, nonce: this.#cameraNonce };
    for (const listener of this.#cameraListeners) listener();
  };

  /** Moves the camera to a fixed position (hall camera presets). */
  requestPose = (
    position: readonly [number, number, number],
    target: readonly [number, number, number],
  ): void => {
    this.#cameraNonce += 1;
    this.#cameraRequest = { kind: "pose", position, target, nonce: this.#cameraNonce };
    for (const listener of this.#cameraListeners) listener();
  };

  frameSelection = (): void => {
    this.requestFrame(this.#selection.length > 0 ? this.#selection : null);
  };

  /** Selects a component and flies the camera to it (failure events, search results). */
  focusComponent = (id: string): void => {
    if (this.#world.getComponent(id) === undefined) return;
    if (this.#hidden.has(id)) this.#hidden = new Set([...this.#hidden].filter((h) => h !== id));
    this.select([id]);
    this.requestFrame([id]);
  };

  /* ---------------------------------------------------------------------------------- *
   * Placing and arranging parts
   * ---------------------------------------------------------------------------------- */

  #snapPosition(position: Vec3, override: boolean): Vec3 {
    if (!this.#snapEnabled || override) return position;
    const g = this.#gridM;
    return vec3(snapScalar(position.x, g), position.y, snapScalar(position.z, g));
  }

  /** Where a new part should go: at `at` if given, else a clear spot near the view centre. */
  #spawnPosition(size: Vec3, at?: Vec3): Vec3 {
    const ground = this.#world.settings.groundLevelM;
    const y = ground + size.y / 2;
    if (at !== undefined) return this.#snapPosition(vec3(at.x, y, at.z), false);
    const focus = this.viewport?.focusPoint() ?? vec3(0, 0, 0);
    const occupied = this.#snapshot.components.map((c) =>
      worldAabb(c.geometry, currentTransform(c)),
    );
    const halfX = size.x / 2 + 0.5;
    const halfZ = size.z / 2 + 0.5;
    const clear = (x: number, z: number) =>
      occupied.every(
        (box) =>
          x + halfX <= box.minM.x ||
          x - halfX >= box.maxM.x ||
          z + halfZ <= box.minM.z ||
          z - halfZ >= box.maxM.z,
      );
    const step = Math.max(2, Math.max(size.x, size.z) + 1);
    for (let ring = 0; ring < 20; ring += 1) {
      const count = Math.max(1, ring * 8);
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * Math.PI * 2;
        const x = focus.x + Math.cos(angle) * ring * step;
        const z = focus.z + Math.sin(angle) * ring * step;
        if (clear(x, z)) return this.#snapPosition(vec3(x, y, z), false);
      }
    }
    return this.#snapPosition(vec3(focus.x, y, focus.z), false);
  }

  addPart = (type: string, at?: Vec3): string | null => {
    const definition = findComponentDefinition(type);
    if (definition === undefined) return null;
    let id = "";
    const ok = this.#edit(`Add ${definition.name}`, (world) => {
      id = uniqueId(world, type);
      const position = this.#spawnPosition(definition.nominalSizeM, at);
      world.addComponent(
        definition.createSpec({ id, transform: makeTransform(position), label: definition.name }),
      );
      this.#snapToSockets(world, [id], false);
      this.#reconcile(world, [id], false);
    });
    if (!ok) return null;
    this.#selection = [id];
    this.#publish();
    return id;
  };

  deleteSelected = (): void => {
    const ids = [...this.#selection];
    if (ids.length === 0) return;
    this.#edit(
      ids.length === 1 ? `Delete ${this.#labelOf(ids[0]!)}` : `Delete ${ids.length} parts`,
      (world) => {
        for (const id of ids) world.removeComponent(id);
      },
    );
  };

  duplicateSelected = (): void => {
    const ids = [...this.#selection];
    if (ids.length === 0) return;
    const created: string[] = [];
    this.#edit(
      ids.length === 1 ? `Duplicate ${this.#labelOf(ids[0]!)}` : `Duplicate ${ids.length} parts`,
      (world) => {
        // Offset the whole group by its width along X so copies sit beside the originals.
        const boxes = ids.map((id) => {
          const c = world.requireComponent(id);
          return worldAabb(c.geometry, c.transform);
        });
        const minX = Math.min(...boxes.map((b) => b.minM.x));
        const maxX = Math.max(...boxes.map((b) => b.maxM.x));
        const dx = snapScalar(maxX - minX + 1, this.#gridM) || 1;
        const map = new Map<string, string>();
        for (const id of ids) {
          const source = world.requireComponent(id);
          const copy = world.duplicateComponent(
            id,
            makeTransform(
              Vec3Math.add(source.transform.positionM, vec3(dx, 0, 0)),
              source.transform.rotation,
            ),
          );
          // Deterministic ids from the world's counter, re-keyed to stay type-prefixed.
          map.set(id, copy.id);
          created.push(copy.id);
        }
        // Copy links that were internal to the selection.
        for (const connection of world.listConnections()) {
          const a = map.get(connection.from.componentId);
          const b = map.get(connection.to.componentId);
          if (a !== undefined && b !== undefined) {
            world.connect(
              { componentId: a, connectionPointId: connection.from.connectionPointId },
              { componentId: b, connectionPointId: connection.to.connectionPointId },
              {
                type: connection.type,
                ...(connection.maxLoadN === undefined ? {} : { maxLoadN: connection.maxLoadN }),
              },
            );
          }
        }
        this.#reconcile(world, created, false);
      },
    );
    if (created.length > 0) {
      this.#selection = created;
      this.#publish();
    }
  };

  /**
   * Commits a gizmo drag or numeric edit. Grid snapping, socket snapping and automatic
   * connection all happen here, before the world ever sees the placement. `override`
   * (Alt held) disables every snap for this move.
   */
  moveComponents = (updates: readonly TransformUpdate[], override = false): void => {
    if (updates.length === 0) return;
    const label =
      updates.length === 1
        ? `Move ${this.#labelOf(updates[0]!.id)}`
        : `Move ${updates.length} parts`;
    this.#edit(label, (world) => {
      // Grid-snap the group by its primary member so relative offsets are preserved.
      const primary = updates[updates.length - 1]!;
      const snapped = this.#snapPosition(primary.position, override);
      const delta = Vec3Math.subtract(snapped, primary.position);
      for (const update of updates) {
        world.setTransform(
          update.id,
          makeTransform(
            Vec3Math.add(update.position, delta),
            QuaternionMath.normalize(update.rotation),
          ),
        );
      }
      const ids = updates.map((u) => u.id);
      this.#snapToSockets(world, ids, override);
      this.#reconcile(world, ids, override);
    });
  };

  setPosition = (id: string, position: Vec3): void => {
    const c = this.#world.getComponent(id);
    if (c === undefined) return;
    this.moveComponents([{ id, position, rotation: c.transform.rotation }], true);
  };

  setRotationEuler = (id: string, degrees: Vec3): void => {
    const c = this.#world.getComponent(id);
    if (c === undefined) return;
    const rad = (d: number) => (d * Math.PI) / 180;
    const q = QuaternionMath.multiply(
      QuaternionMath.multiply(
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), rad(degrees.y)),
        QuaternionMath.fromAxisAngle(vec3(1, 0, 0), rad(degrees.x)),
      ),
      QuaternionMath.fromAxisAngle(vec3(0, 0, 1), rad(degrees.z)),
    );
    this.moveComponents([{ id, position: c.transform.positionM, rotation: q }], true);
  };

  /** Rotates the selection 90° about the vertical axis, around its own centre. */
  rotateSelection90 = (): void => {
    const ids = [...this.#selection];
    if (ids.length === 0) return;
    const comps = ids.map((id) => this.#world.requireComponent(id));
    const centre = Vec3Math.scale(
      comps.reduce((sum, c) => Vec3Math.add(sum, c.transform.positionM), vec3(0, 0, 0)),
      1 / comps.length,
    );
    const turn = QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    this.moveComponents(
      comps.map((c) => ({
        id: c.id,
        position: Vec3Math.add(
          centre,
          QuaternionMath.rotateVec3(turn, Vec3Math.subtract(c.transform.positionM, centre)),
        ),
        rotation: QuaternionMath.multiply(turn, c.transform.rotation),
      })),
    );
  };

  /** Drops the selection so its lowest point rests on the ground. */
  dropToGround = (): void => {
    const ids = [...this.#selection];
    if (ids.length === 0) return;
    const ground = this.#world.settings.groundLevelM;
    this.moveComponents(
      ids.map((id) => {
        const c = this.#world.requireComponent(id);
        const bottom = worldAabb(c.geometry, c.transform).minM.y;
        return {
          id,
          position: Vec3Math.add(c.transform.positionM, vec3(0, ground - bottom, 0)),
          rotation: c.transform.rotation,
        };
      }),
      true,
    );
  };

  /**
   * Moves the dragged group so its closest socket lands exactly on a compatible socket of
   * another part, when one is within SOCKET_SNAP_RADIUS_M. Uses a spatial hash, so the
   * cost is linear in the sockets involved (docs/PERFORMANCE.md).
   */
  #snapToSockets(world: SimulationWorld, ids: readonly string[], override: boolean): void {
    if (override || !this.#socketSnap || !this.#snapEnabled) return;
    const moving = new Set(ids);
    const index = SocketIndex.of(
      world.listComponents().filter((c) => !moving.has(c.id) && !this.#hidden.has(c.id)),
      SOCKET_SNAP_RADIUS_M,
    );
    let best: { distance: number; delta: Vec3 } | null = null;
    for (const id of ids) {
      const m = world.requireComponent(id);
      const mt = currentTransform(m);
      for (const socket of m.connectionPoints) {
        const p = localPointToWorld(mt, socket.localPosition);
        const hit = index.near(p, SOCKET_SNAP_RADIUS_M, socket.connectionType)[0];
        if (hit !== undefined && (best === null || hit.distance < best.distance)) {
          best = { distance: hit.distance, delta: Vec3Math.subtract(hit.socket.position, p) };
        }
      }
    }
    if (best === null || best.distance < 1e-9) return;
    for (const id of ids) {
      const c = world.requireComponent(id);
      world.setTransform(
        id,
        makeTransform(Vec3Math.add(c.transform.positionM, best.delta), c.transform.rotation),
      );
    }
  }

  /**
   * Keeps links consistent with where parts are: load-bearing links whose sockets have
   * been pulled apart are broken; coincident compatible sockets connect (unless snapping
   * is overridden). Service links (power, coolant, steam...) made with the Connect tool
   * run through implicit cables and hoses and are kept at any distance.
   */
  #reconcile(world: SimulationWorld, ids: readonly string[], override: boolean): void {
    for (const id of ids) {
      const component = world.getComponent(id);
      if (component === undefined) continue;
      for (const connection of component.connections) {
        if (isLoadBearing(connection.type) && !socketsTouch(world, connection))
          world.disconnect(connection.id);
      }
    }
    if (override || !this.#snapEnabled) return;
    const tolerance = CONNECTION_SNAP_TOLERANCE_M;
    const index = SocketIndex.of(
      world.listComponents().filter((c) => !this.#hidden.has(c.id)),
      Math.max(tolerance, 0.05),
    );
    const end = (componentId: string, socketId: string) => `${componentId}\u0000${socketId}`;
    const linked = new Set<string>();
    for (const c of world.listConnections()) {
      const a = end(c.from.componentId, c.from.connectionPointId);
      const b = end(c.to.componentId, c.to.connectionPointId);
      linked.add(`${a}|${b}`).add(`${b}|${a}`);
    }
    for (const id of ids) {
      const component = world.getComponent(id);
      if (component === undefined) continue;
      const t = currentTransform(component);
      for (const socket of component.connectionPoints) {
        const p = localPointToWorld(t, socket.localPosition);
        for (const { socket: other } of index.near(p, tolerance, socket.connectionType)) {
          if (other.componentId === id) continue;
          const a = end(id, socket.id);
          const b = end(other.componentId, other.socketId);
          if (linked.has(`${a}|${b}`)) continue;
          try {
            world.connect(
              { componentId: id, connectionPointId: socket.id },
              { componentId: other.componentId, connectionPointId: other.socketId },
            );
            linked.add(`${a}|${b}`).add(`${b}|${a}`);
          } catch {
            // An incompatible pair the engine refuses: skip it.
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Properties
   * ---------------------------------------------------------------------------------- */

  #labelOf(id: string): string {
    return this.#world.getComponent(id)?.label || id;
  }

  setLabel = (id: string, label: string): void => {
    const trimmed = label.trim().slice(0, 80);
    if (this.#world.getComponent(id)?.label === trimmed) return;
    this.#edit("Rename part", (world) => {
      world.setLabel(id, trimmed);
    });
  };

  setMaterial = (ids: readonly string[], materialId: MaterialId): void => {
    const material = getMaterial(materialId);
    this.#edit(`Change material to ${material.name}`, (world) => {
      for (const id of ids) {
        const c = world.requireComponent(id);
        world.setMaterial(id, materialId);
        // Socket ratings are derived from the material: rebuild them.
        const definition = findComponentDefinition(c.type);
        if (definition !== undefined) {
          const { geometry, connectionPoints } = definition.reshape(
            definition.dimensionsOf(c.geometry),
            materialId,
          );
          world.reshapeComponent(id, geometry, connectionPoints);
        }
      }
    });
  };

  setDimension = (id: string, key: string, valueM: number): void => {
    const c = this.#world.getComponent(id);
    const definition = c && findComponentDefinition(c.type);
    if (c === undefined || definition === undefined || !Number.isFinite(valueM)) return;
    const spec = definition.dimensions.find((d) => d.key === key);
    this.#edit(`Resize ${spec?.label.toLowerCase() ?? key}`, (world) => {
      const ground = world.settings.groundLevelM;
      const wasOnGround = Math.abs(worldAabb(c.geometry, c.transform).minM.y - ground) < 1e-3;
      const dims = { ...definition.dimensionsOf(c.geometry), [key]: valueM };
      const { geometry, connectionPoints } = definition.reshape(dims, c.materialId);
      world.reshapeComponent(id, geometry, connectionPoints);
      if (wasOnGround) {
        const after = world.requireComponent(id);
        const bottom = worldAabb(after.geometry, after.transform).minM.y;
        world.setTransform(
          id,
          makeTransform(
            Vec3Math.add(after.transform.positionM, vec3(0, ground - bottom, 0)),
            after.transform.rotation,
          ),
        );
      }
      this.#reconcile(world, [id], false);
    });
  };

  setParameter = (ids: readonly string[], key: string, value: number | boolean | string): void => {
    this.#edit(`Set ${key}`, (world) => {
      for (const id of ids) world.setParameters(id, { [key]: value });
    });
  };

  setAnchored = (ids: readonly string[], anchored: boolean): void => {
    this.#edit(anchored ? "Pin in place" : "Release", (world) => {
      for (const id of ids) world.setAnchored(id, anchored);
    });
  };

  setAdditionalMass = (id: string, kg: number): void => {
    if (!Number.isFinite(kg) || kg < 0) return;
    this.#edit("Set contents mass", (world) => {
      world.setAdditionalMass(id, kg);
    });
  };

  /* ---------------------------------------------------------------------------------- *
   * Connections
   * ---------------------------------------------------------------------------------- */

  /** Connect tool: first click picks a socket, second click links it. */
  pickSocket = (endpoint: ConnectionEndpoint): void => {
    if (this.#mode !== "build") return;
    const from = this.#connectFrom;
    if (from === null || from.componentId === endpoint.componentId) {
      this.#connectFrom = endpoint;
      this.#selection = [endpoint.componentId];
      this.#publish();
      return;
    }
    const a = this.#world
      .requireComponent(from.componentId)
      .connectionPoints.find((p) => p.id === from.connectionPointId);
    const b = this.#world
      .requireComponent(endpoint.componentId)
      .connectionPoints.find((p) => p.id === endpoint.connectionPointId);
    if (a === undefined || b === undefined) return;
    const compatibility = checkPortCompatibility(a, b);
    if (!compatibility.compatible) {
      toast("warning", "Those ports can't be joined", compatibility.reason);
      return;
    }
    const exists = this.#world
      .listConnections()
      .some(
        (c) =>
          (sameEnd(c.from, from) && sameEnd(c.to, endpoint)) ||
          (sameEnd(c.from, endpoint) && sameEnd(c.to, from)),
      );
    if (exists) {
      toast("info", "Already connected");
      this.#connectFrom = null;
      this.#publish();
      return;
    }
    this.#connectFrom = null;
    this.#edit(`Connect ${a.connectionType}`, (world) => {
      world.connect(from, endpoint);
    });
    // Joinable but mismatched ratings: the simulation decides whether the weaker side copes.
    if (compatibility.warnings.length > 0)
      toast("info", "Connected, with a rating mismatch", compatibility.warnings.join(" "));
  };

  disconnect = (connectionId: string): void => {
    this.#edit("Disconnect", (world) => {
      world.disconnect(connectionId);
    });
  };

  /* ---------------------------------------------------------------------------------- *
   * Simulation
   * ---------------------------------------------------------------------------------- */

  startSimulation = (speed: SessionSpeed = 1): void => {
    if (this.#snapshot.components.length === 0) {
      toast("info", "Nothing to simulate yet", "Add parts from the drawer first.");
      return;
    }
    this.#client ??= new SimulationClient(this.#onSimEvent);
    this.#mode = "simulate";
    this.#overlay = this.#simOverlay;
    this.#connectFrom = null;
    if (this.#tool !== "select" && this.#tool !== "box") this.#tool = "select";
    this.#frame = null;
    this.#frameIndex.clear();
    this.#publishSim({ ...EMPTY_SIM, status: "loading", speed });
    this.#client.load(serializeWorld(this.#world));
    this.#client.inspect(this.primarySelection);
    this.#client.speed(speed);
    this.#publish();
  };

  stopSimulation = (): void => {
    if (this.#mode !== "simulate") return;
    this.#replayFrame = null;
    this.#client?.speed(0);
    this.#mode = "build";
    this.#overlay = this.#buildOverlay;
    this.#frame = null;
    this.#frameIndex.clear();
    this.#publishSim({ status: "idle", speed: 0, detail: null });
    this.#publish();
  };

  toggleSimulation = (): void => {
    if (this.#mode === "simulate") this.stopSimulation();
    else this.startSimulation();
  };

  setSpeed = (speed: SessionSpeed): void => {
    if (this.#mode !== "simulate") {
      this.startSimulation(speed);
      return;
    }
    this.#client?.speed(speed);
    this.#publishSim({ speed });
  };

  togglePlay = (): void => {
    if (this.#mode !== "simulate") {
      this.startSimulation();
      return;
    }
    this.setSpeed(this.#sim.speed === 0 ? 1 : 0);
  };

  stepSimulation = (count = 1): void => {
    if (this.#mode !== "simulate") return;
    this.setSpeed(0);
    this.#client?.step(count);
  };

  resetSimulation = (): void => {
    if (this.#mode !== "simulate") return;
    this.#replayFrame = null;
    this.#client?.reset();
    this.#publishSim({ failures: [], history: [], timeSec: 0, tick: 0 });
  };

  #onSimEvent = (event: SessionEvent): void => {
    switch (event.type) {
      case "loaded":
        this.#publishSim({ status: "ready", error: null });
        return;
      case "error":
        this.#publishSim({ status: "error", error: event.message });
        toast("error", "Simulation error", event.message);
        return;
      case "frame": {
        if (this.#mode !== "simulate") return;
        this.#frame = event;
        if (this.#frameIndex.size !== event.ids.length) {
          this.#frameIndex.clear();
          event.ids.forEach((id, i) => this.#frameIndex.set(id, i));
        }
        const reset = event.tick < this.#sim.tick;
        let history = reset ? [] : this.#sim.history;
        if (event.history.length > 0) {
          history = [...history, ...event.history];
          if (history.length > MAX_HISTORY_POINTS)
            history = history.slice(history.length - MAX_HISTORY_POINTS);
        }
        const failures = reset
          ? [...event.newFailures]
          : event.newFailures.length > 0
            ? [...this.#sim.failures, ...event.newFailures]
            : this.#sim.failures;
        if (event.newFailures.length > 0 && !reset) {
          const first = event.newFailures[0]!;
          toast(
            "warning",
            first.summary ?? `${first.failureType.replace(/_/g, " ")}: ${first.componentId}`,
            event.newFailures.length > 1 ? `+${event.newFailures.length - 1} more` : undefined,
            3500,
          );
        }
        this.#publishSim({
          status: "ready",
          speed: event.speed,
          timeSec: event.timeSec,
          tick: event.tick,
          plant: event.plant,
          failures,
          history,
          detail: event.detail,
          droppedTimeSec: event.droppedTimeSec,
          frameNumber: this.#sim.frameNumber + 1,
        });
        return;
      }
    }
  };

  /* ---------------------------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------------------------- */

  #scheduleDraft(): void {
    clearTimeout(this.#draftTimer);
    this.#draftTimer = setTimeout(() => this.flushDraft(), 800);
  }

  flushDraft = (): void => {
    clearTimeout(this.#draftTimer);
    writeLocalDraft(
      serializeWorld(this.#world, { generator: GENERATOR }),
      this.cloud.binding?.projectId ?? null,
    );
  };

  /** Starts background work (autosave connectivity). Paired with `suspend`. */
  activate(): void {
    this.cloud.attach();
  }

  /**
   * Stops background work: saves the draft, pushes pending cloud changes, and ends the
   * simulation worker. The store stays usable; `activate` resumes it.
   */
  suspend(): void {
    this.flushDraft();
    this.cloud.detach();
    if (this.#mode === "simulate") this.stopSimulation();
    this.#client?.dispose();
    this.#client = undefined;
  }
}

/* ------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------ */

const EMPTY_SIM: SimView = Object.freeze({
  status: "idle",
  error: null,
  speed: 0,
  timeSec: 0,
  tick: 0,
  plant: null,
  failures: Object.freeze([]) as readonly FailureEvent[],
  history: Object.freeze([]) as readonly HistoryPoint[],
  detail: null,
  droppedTimeSec: 0,
  frameNumber: 0,
}) as SimView;

function sameEnd(a: ConnectionEndpoint, b: ConnectionEndpoint): boolean {
  return a.componentId === b.componentId && a.connectionPointId === b.connectionPointId;
}

function socketsTouch(world: SimulationWorld, connection: Connection): boolean {
  const a = world.getComponent(connection.from.componentId);
  const b = world.getComponent(connection.to.componentId);
  if (a === undefined || b === undefined) return false;
  const sa = a.connectionPoints.find((p) => p.id === connection.from.connectionPointId);
  const sb = b.connectionPoints.find((p) => p.id === connection.to.connectionPointId);
  if (sa === undefined || sb === undefined) return false;
  const pa = localPointToWorld(a.transform, sa.localPosition);
  const pb = localPointToWorld(b.transform, sb.localPosition);
  return Vec3Math.distance(pa, pb) <= CONNECTION_SNAP_TOLERANCE_M;
}

/** A readable id not yet used in the world: `coolant-pump-3`. */
function uniqueId(world: SimulationWorld, type: string): string {
  for (let n = 1; ; n += 1) {
    const id = `${type}-${n}`;
    if (world.getComponent(id) === undefined) return id;
  }
}

export const ENGINE_VERSION = SIMULATION_ENGINE_VERSION;
export const PART_CATALOGUE = COMPONENT_DEFINITIONS;
export { getComponentDefinition };
