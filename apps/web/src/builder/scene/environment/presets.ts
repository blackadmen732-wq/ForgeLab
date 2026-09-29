import { useSyncExternalStore } from "react";
import { safeStorage } from "../../../lib/storage.js";

/**
 * Environment presets: the space the plant is built in.
 *
 * Presentation only. The environment never reaches sim-core, the save file or a shared
 * project — the same design simulates identically in every preset. It is a per-viewer
 * preference, like the camera.
 */
export type EnvironmentId = "industrial-hall" | "dark-facility" | "clean-lab" | "outdoor" | "grid";

export interface EnvironmentPreset {
  readonly id: EnvironmentId;
  readonly name: string;
  readonly description: string;
  /** Presets listed but not built yet are shown disabled. */
  readonly available: boolean;
  readonly background: string;
  readonly fog: { readonly color: string; readonly near: number; readonly far: number };
  readonly light: {
    readonly sky: string;
    readonly ground: string;
    readonly hemisphere: number;
    readonly key: number;
    readonly keyColor: string;
    readonly fill: number;
    /** Emissive strength of the hall's light fixtures. */
    readonly fixtures: number;
    /** Strength of image-based reflections (scene.environmentIntensity). */
    readonly reflections: number;
  };
  /** Which geometry to draw. */
  readonly scene: "hall" | "grid";
}

export const ENVIRONMENT_PRESETS: readonly EnvironmentPreset[] = Object.freeze([
  {
    id: "industrial-hall",
    name: "Industrial Hall",
    description:
      "A 140 × 90 m reactor assembly hall with crane, service gallery and high-bay lighting.",
    available: true,
    background: "#1b2027",
    fog: { color: "#1b2027", near: 110, far: 460 },
    light: {
      sky: "#e6edf5",
      ground: "#3a3f45",
      hemisphere: 0.32,
      key: 3.2,
      keyColor: "#fff4e3",
      fill: 0.35,
      fixtures: 1.4,
      reflections: 0.16,
    },
    scene: "hall",
  },
  {
    id: "dark-facility",
    name: "Dark Research Facility",
    description: "The same hall after hours: work lights only, so the machine carries the scene.",
    available: true,
    background: "#07090c",
    fog: { color: "#07090c", near: 60, far: 300 },
    light: {
      sky: "#8fa3b8",
      ground: "#101318",
      hemisphere: 0.28,
      key: 0.9,
      keyColor: "#cfe0ff",
      fill: 0.12,
      fixtures: 2.2,
      reflections: 0.1,
    },
    scene: "hall",
  },
  {
    id: "clean-lab",
    name: "Clean Lab",
    description: "Bright, white research lab (planned).",
    available: false,
    background: "#e9edf1",
    fog: { color: "#e9edf1", near: 120, far: 500 },
    light: {
      sky: "#ffffff",
      ground: "#c9ced4",
      hemisphere: 1,
      key: 1.6,
      keyColor: "#ffffff",
      fill: 0.5,
      fixtures: 1,
      reflections: 0.6,
    },
    scene: "hall",
  },
  {
    id: "outdoor",
    name: "Outdoor Test Site",
    description: "Open-air test pad under the sky (planned).",
    available: false,
    background: "#8fb3d6",
    fog: { color: "#a9c3dc", near: 200, far: 1200 },
    light: {
      sky: "#bcd7f2",
      ground: "#5b5446",
      hemisphere: 0.9,
      key: 2.4,
      keyColor: "#fff1d6",
      fill: 0.3,
      fixtures: 0,
      reflections: 0.5,
    },
    scene: "grid",
  },
  {
    id: "grid",
    name: "Empty Engineering Grid",
    description: "No surroundings: an infinite measured grid.",
    available: true,
    background: "#0b0e12",
    fog: { color: "#0b0e12", near: 600, far: 2400 },
    light: {
      sky: "#dfe7ef",
      ground: "#20262d",
      hemisphere: 0.9,
      key: 1.6,
      keyColor: "#ffffff",
      fill: 0.45,
      fixtures: 0,
      reflections: 0.25,
    },
    scene: "grid",
  },
]);

export const DEFAULT_ENVIRONMENT: EnvironmentId = "industrial-hall";
const KEY = "forgelab.environment.v1";

function stored(): EnvironmentId {
  const id = safeStorage.get(KEY);
  const preset = ENVIRONMENT_PRESETS.find((p) => p.id === id && p.available);
  return preset?.id ?? DEFAULT_ENVIRONMENT;
}

let current: EnvironmentId | null = null;
const listeners = new Set<() => void>();

export function getEnvironmentId(): EnvironmentId {
  current ??= stored();
  return current;
}

export function setEnvironmentId(id: EnvironmentId): void {
  const preset = ENVIRONMENT_PRESETS.find((p) => p.id === id);
  if (preset === undefined || !preset.available) return;
  current = id;
  safeStorage.set(KEY, id);
  for (const listener of listeners) listener();
}

export function environmentPreset(id: EnvironmentId): EnvironmentPreset {
  return ENVIRONMENT_PRESETS.find((p) => p.id === id) ?? ENVIRONMENT_PRESETS[0]!;
}

export function useEnvironment(): EnvironmentPreset {
  const id = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getEnvironmentId,
    () => DEFAULT_ENVIRONMENT,
  );
  return environmentPreset(id);
}
