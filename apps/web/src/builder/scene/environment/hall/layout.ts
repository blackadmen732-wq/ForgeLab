import { useSyncExternalStore } from "react";
import { safeStorage } from "../../../../lib/storage.js";

/**
 * Hall sizes. Presentation only, like the environment preset and the camera: the building
 * a plant stands in is a per-viewer preference that never reaches sim-core, a save file
 * or a shared project. The same design simulates identically in every hall.
 *
 * Dimensions are metres. x runs along the hall (west −, east +), z across it (north −,
 * south +), y up from the floor at 0, the ground plane the structural solver uses.
 */
export type HallId = "standard" | "assembly-bay";

export interface HallLayout {
  readonly id: HallId;
  readonly name: string;
  readonly description: string;
  readonly halfX: number;
  readonly halfZ: number;
  /** Underside of the roof trusses. */
  readonly eaveM: number;
  /** Roof deck. */
  readonly roofM: number;
  /** Column spacing. */
  readonly bayM: number;
  /** Crane runway rail height. */
  readonly craneRailM: number;
  /** The clear central build zone: nothing of the building stands inside it. */
  readonly buildHalfX: number;
  readonly buildHalfZ: number;
  /** Top of the concrete lower wall. */
  readonly plinthM: number;
  /** Equipment door (west wall): clear width and height. */
  readonly doorM: readonly [number, number];
  /**
   * Service galleries along both long walls: deck heights, bottom to top. Empty for a
   * hall with single catwalks instead.
   */
  readonly galleryLevelsM: readonly number[];
  /** Depth of those galleries from the wall. */
  readonly galleryDepthM: number;
  /** Linear fog: where it starts and where it is complete (haze shortens both). */
  readonly fog: { readonly near: number; readonly far: number };
}

export const HALL_LAYOUTS: Readonly<Record<HallId, HallLayout>> = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    name: "Reactor hall · 140 × 90 m",
    description:
      "The original assembly hall: 140 × 90 m floor, 50 m to the trusses, a maintenance gantry, two service catwalks and a bridge crane.",
    halfX: 70,
    halfZ: 45,
    eaveM: 50,
    roofM: 56,
    bayM: 10,
    craneRailM: 42,
    buildHalfX: 40,
    buildHalfZ: 30,
    plinthM: 7,
    doorM: [14, 16] as const,
    galleryLevelsM: [],
    galleryDepthM: 0,
    fog: { near: 110, far: 460 },
  }),
  "assembly-bay": Object.freeze({
    id: "assembly-bay",
    name: "Tokamak assembly bay · 220 × 130 m",
    description:
      "A larger bay in the manner of a tokamak building: 220 × 130 m floor, 66 m to the trusses, four levels of service galleries along both long walls, reached by stairs.",
    halfX: 110,
    halfZ: 65,
    eaveM: 66,
    roofM: 72,
    bayM: 10,
    craneRailM: 56,
    buildHalfX: 60,
    buildHalfZ: 40,
    plinthM: 7,
    doorM: [20, 24] as const,
    galleryLevelsM: [7, 14, 21, 28],
    galleryDepthM: 11,
    fog: { near: 150, far: 640 },
  }),
});

export const HALL_ORDER: readonly HallId[] = ["assembly-bay", "standard"];
/** Mark asked for a larger hall to move about in: new viewers start in the big bay. */
export const DEFAULT_HALL: HallId = "assembly-bay";

const KEY = "forgelab.hall.v1";
let current: HallId | null = null;
const listeners = new Set<() => void>();

const isHallId = (id: unknown): id is HallId =>
  typeof id === "string" && Object.prototype.hasOwnProperty.call(HALL_LAYOUTS, id);

export function getHallId(): HallId {
  if (current === null) {
    const stored = safeStorage.get(KEY);
    current = isHallId(stored) ? stored : DEFAULT_HALL;
  }
  return current;
}

export function getHallLayout(): HallLayout {
  return HALL_LAYOUTS[getHallId()];
}

export function setHallId(id: HallId): void {
  if (!isHallId(id) || id === getHallId()) return;
  current = id;
  safeStorage.set(KEY, id);
  for (const listener of listeners) listener();
}

export function subscribeHall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHallLayout(): HallLayout {
  const id = useSyncExternalStore(subscribeHall, getHallId, () => DEFAULT_HALL);
  return HALL_LAYOUTS[id];
}
