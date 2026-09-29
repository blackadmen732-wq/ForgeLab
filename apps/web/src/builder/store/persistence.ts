import { SIMULATION_ENGINE_VERSION, type AssemblyFileV2 } from "@forgelab/sim-core";
import { designHash } from "@forgelab/sim-runner";
import type { ProjectRole } from "@forgelab/protocol";
import {
  getProject,
  isStaleVersion,
  saveVersion,
  updateProject,
  type ProjectStats,
  type ProjectVersionMeta,
  type Visibility,
} from "../../lib/api.js";
import { safeStorage } from "../../lib/storage.js";

/* ------------------------------------------------------------------------------------ *
 * Local draft: every design is autosaved to this browser, signed in or not.
 * ------------------------------------------------------------------------------------ */

export const LOCAL_DRAFT_KEY = "forgelab.draft.v2";

export interface LocalDraft {
  readonly file: AssemblyFileV2;
  readonly savedAt: string;
  /** The cloud project this draft belongs to, if any. */
  readonly projectId: string | null;
}

export function writeLocalDraft(file: AssemblyFileV2, projectId: string | null): boolean {
  if (file.components.length === 0 && projectId === null) {
    // Don't replace a real draft with an empty workspace.
    const existing = readLocalDraft();
    if (existing !== null && existing.file.components.length > 0) return true;
  }
  return safeStorage.setJson(LOCAL_DRAFT_KEY, {
    file,
    savedAt: new Date().toISOString(),
    projectId,
  } satisfies LocalDraft);
}

export function readLocalDraft(): LocalDraft | null {
  const draft = safeStorage.getJson<LocalDraft | null>(LOCAL_DRAFT_KEY, null);
  if (draft === null || typeof draft !== "object" || draft.file?.components === undefined)
    return null;
  return draft;
}

/* ------------------------------------------------------------------------------------ *
 * Cloud autosave
 * ------------------------------------------------------------------------------------ */

export interface CloudBinding {
  readonly projectId: string;
  readonly ownerId: string;
  readonly ownerUsername: string | null;
  readonly name: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly thumbnailPath: string | null;
  readonly latestVersionId: string | null;
  /** The signed-in user's role in this project; null when they are not a member. */
  readonly role: ProjectRole | null;
  /** Not an editor here: the design can be run and tinkered with, but only a fork saves. */
  readonly readOnly: boolean;
}

export type SaveStatus =
  | "local"
  | "saved"
  | "saving"
  | "unsaved"
  | "offline"
  | "error"
  | "readonly"
  /** Another member saved first; autosave pauses until the user decides. */
  | "conflict";

export interface SaveState {
  readonly status: SaveStatus;
  readonly lastSavedAt: string | null;
  readonly error: string | null;
}

/** Debounce before an autosave: long enough to batch a burst of edits. */
export const AUTOSAVE_DELAY_MS = 2500;
const RETRY_DELAY_MS = 10_000;

/**
 * Autosaves the design to its cloud project as versions. The database numbers versions
 * and trims old autosaves; identical designs (same canonical hash) are not re-uploaded.
 */
export class CloudSync {
  binding: CloudBinding | null = null;
  state: SaveState = { status: "local", lastSavedAt: null, error: null };

  #getFile: () => AssemblyFileV2;
  #getStats: () => ProjectStats;
  #onChange: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> | null = null;
  #dirty = false;
  #lastHash: string | null = null;
  #lastStatsJson = "";
  #onlineListener = () => {
    if (this.#dirty) void this.flush();
  };

  #savedListeners = new Set<(version: ProjectVersionMeta) => void>();

  /** Called after every successful save, so collaborators can be told. */
  onSaved(listener: (version: ProjectVersionMeta) => void): () => void {
    this.#savedListeners.add(listener);
    return () => this.#savedListeners.delete(listener);
  }

  constructor(getFile: () => AssemblyFileV2, getStats: () => ProjectStats, onChange: () => void) {
    this.#getFile = getFile;
    this.#getStats = getStats;
    this.#onChange = onChange;
  }

  /** Starts listening for connectivity; paired with `detach`. */
  attach(): void {
    window.addEventListener("online", this.#onlineListener);
  }

  detach(): void {
    clearTimeout(this.#timer);
    window.removeEventListener("online", this.#onlineListener);
    if (this.#dirty) void this.flush();
  }

  #set(state: Partial<SaveState>): void {
    this.state = { ...this.state, ...state };
    this.#onChange();
  }

  /** `saved` identifies what the cloud already holds, so identical designs aren't re-uploaded. */
  bind(binding: CloudBinding | null, saved: { hash: string; name: string } | null = null): void {
    clearTimeout(this.#timer);
    this.binding = binding;
    this.#dirty = false;
    this.#lastHash = saved === null ? null : `${saved.hash}|${saved.name}`;
    this.#lastStatsJson = "";
    this.state = {
      status: binding === null ? "local" : binding.readOnly ? "readonly" : "saved",
      lastSavedAt: null,
      error: null,
    };
    this.#onChange();
  }

  /** The user's role changed while the project is open (promoted, demoted or removed). */
  setAccess(role: ProjectRole | null, readOnly: boolean): void {
    const binding = this.binding;
    if (binding === null || (binding.role === role && binding.readOnly === readOnly)) return;
    this.binding = { ...binding, role, readOnly };
    if (readOnly) {
      clearTimeout(this.#timer);
      this.#dirty = false;
      this.#set({ status: "readonly", error: null });
    } else if (this.state.status === "readonly") {
      this.#set({ status: "saved", error: null });
    } else {
      this.#onChange();
    }
  }

  updateBinding(changes: Partial<CloudBinding>): void {
    if (this.binding === null) return;
    this.binding = { ...this.binding, ...changes };
    this.#onChange();
  }

  get hasUnsavedChanges(): boolean {
    return this.#dirty || this.state.status === "saving";
  }

  markChanged(): void {
    if (this.binding === null || this.binding.readOnly) return;
    this.#dirty = true;
    if (this.state.status === "conflict") return;
    if (this.state.status !== "saving")
      this.#set({ status: navigator.onLine ? "unsaved" : "offline" });
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
  }

  /** Saves pending changes now. Resolves when the cloud has them (or saving failed). */
  async flush(): Promise<void> {
    clearTimeout(this.#timer);
    if (this.#inFlight !== null) await this.#inFlight;
    if (!this.#dirty || this.binding === null || this.binding.readOnly) return;
    if (this.state.status === "conflict") return;
    if (!navigator.onLine) {
      this.#set({ status: "offline" });
      return;
    }
    this.#inFlight = this.#save({ autosave: true }).then(
      () => undefined,
      () => undefined,
    );
    await this.#inFlight;
    this.#inFlight = null;
  }

  /**
   * The editor now shows `version` (someone else's save, loaded deliberately): it becomes
   * the parent of the next save, and any conflict is over.
   */
  adoptVersion(version: { id: string; design_hash: string }, name: string): void {
    clearTimeout(this.#timer);
    if (this.binding !== null) this.binding = { ...this.binding, latestVersionId: version.id };
    this.#dirty = false;
    this.#lastHash = `${version.design_hash}|${name}`;
    this.#set({ status: "saved", error: null });
  }

  /**
   * Resolves a conflict by saving this design as a new version on top of the other
   * member's. Nothing is lost: their version stays in the history.
   */
  async keepMine(): Promise<void> {
    const binding = this.binding;
    if (binding === null) return;
    const project = await getProject(binding.projectId);
    if (this.binding?.projectId !== binding.projectId) return;
    this.binding = { ...this.binding, latestVersionId: project?.latest_version_id ?? null };
    this.#set({ status: "unsaved", error: null });
    await this.#save({ autosave: false, label: "Kept my changes", force: true }).catch(
      () => undefined,
    );
  }

  /** A named version: kept forever, shown in history and on the public page. */
  async createVersion(label: string): Promise<ProjectVersionMeta | null> {
    clearTimeout(this.#timer);
    if (this.#inFlight !== null) await this.#inFlight;
    return this.#save({ autosave: false, label, force: true });
  }

  async #save(options: {
    autosave: boolean;
    label?: string;
    force?: boolean;
  }): Promise<ProjectVersionMeta | null> {
    const binding = this.binding;
    if (binding === null) return null;
    const file = this.#getFile();
    const hash = designHash(file);
    // The canonical hash covers physics only; a rename is still a change worth saving.
    const saveKey = `${hash}|${file.name}`;
    this.#dirty = false;
    if (!options.force && saveKey === this.#lastHash) {
      this.#set({ status: "saved", error: null });
      await this.#syncProjectRow(file);
      return null;
    }
    this.#set({ status: "saving", error: null });
    try {
      const version = await saveVersion(binding.projectId, {
        parentVersionId: binding.latestVersionId,
        design: file,
        designHash: hash,
        engineVersion: SIMULATION_ENGINE_VERSION,
        autosave: options.autosave,
        ...(options.label === undefined ? {} : { label: options.label }),
      });
      this.#lastHash = saveKey;
      if (this.binding?.projectId === binding.projectId)
        this.binding = { ...this.binding, latestVersionId: version.id };
      await this.#syncProjectRow(file);
      this.#set({
        status: this.#dirty ? "unsaved" : "saved",
        lastSavedAt: version.created_at,
        error: null,
      });
      if (this.#dirty) this.markChanged();
      for (const listener of this.#savedListeners) listener(version);
      return version;
    } catch (error) {
      this.#dirty = true;
      if (isStaleVersion(error)) {
        clearTimeout(this.#timer);
        this.#set({
          status: "conflict",
          error: "Someone else saved a newer version of this project.",
        });
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#set({ status: navigator.onLine ? "error" : "offline", error: message });
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.flush(), RETRY_DELAY_MS);
      throw error;
    }
  }

  /** Keeps the project row's name and display stats in step with the design. */
  async #syncProjectRow(file: AssemblyFileV2): Promise<void> {
    const binding = this.binding;
    // The project row (name, listing stats) belongs to its owner; teammates' saves are
    // versions only.
    if (binding === null || binding.role !== "owner") return;
    const stats = this.#getStats();
    const statsJson = JSON.stringify(stats);
    const name = file.name.trim().slice(0, 120) || "Untitled Design";
    if (statsJson === this.#lastStatsJson && name === binding.name) return;
    try {
      await updateProject(binding.projectId, { stats, name });
      this.#lastStatsJson = statsJson;
      this.binding = { ...binding, name };
    } catch {
      // Display metadata only; the next save retries.
    }
  }
}
