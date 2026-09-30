import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/storage.js";

/**
 * Local presentation options. They belong to this viewer on this device: they are never
 * saved with a project, never sent to collaborators, and never reach the simulation. A
 * quality tier changes how much is drawn, not what is computed.
 */
export type QualityTier = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

export const QUALITY_TIERS: readonly QualityTier[] = ["LOW", "MEDIUM", "HIGH", "ULTRA"];

export interface PresentationSettings {
  readonly quality: QualityTier;
  /** Disables camera shake, kick and flinch (also forced by the OS setting). */
  readonly reduceMotion: boolean;
  /** 0..1 scale for camera shake, kick and flinch. */
  readonly cameraEffectsIntensity: number;
  /** Removes flashes, strobing alarm beacons and the shock light. */
  readonly reducedEffects: boolean;
  readonly bloom: boolean;
  readonly screenCrack: boolean;
  readonly haze: boolean;
  readonly masterVolume: number;
  readonly alarmVolume: number;
  readonly ambientVolume: number;
  readonly muted: boolean;
  /** Developer-only effects debug panel. */
  readonly debugPanel: boolean;
}

/** What each tier may draw. Simulation fidelity is not in this table on purpose. */
export interface TierBudget {
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  readonly particles: number;
  readonly debrisRigid: number;
  readonly debrisSimple: number;
  readonly bloom: boolean;
  readonly haze: boolean;
  readonly props: boolean;
  /** Additive floor and wall light pools under fixtures. */
  readonly lightPools: boolean;
}

export const TIER_BUDGETS: Readonly<Record<QualityTier, TierBudget>> = Object.freeze({
  LOW: {
    pixelRatio: 1,
    shadowMapSize: 1024,
    particles: 1500,
    debrisRigid: 6,
    debrisSimple: 40,
    bloom: false,
    haze: false,
    props: false,
    lightPools: false,
  },
  MEDIUM: {
    pixelRatio: 1.25,
    shadowMapSize: 2048,
    particles: 4000,
    debrisRigid: 12,
    debrisSimple: 100,
    bloom: true,
    haze: false,
    props: true,
    lightPools: true,
  },
  HIGH: {
    pixelRatio: 1.75,
    shadowMapSize: 2048,
    particles: 8000,
    debrisRigid: 24,
    debrisSimple: 200,
    bloom: true,
    haze: true,
    props: true,
    lightPools: true,
  },
  ULTRA: {
    pixelRatio: 2,
    shadowMapSize: 4096,
    particles: 16000,
    debrisRigid: 40,
    debrisSimple: 400,
    bloom: true,
    haze: true,
    props: true,
    lightPools: true,
  },
});

export const DEFAULT_SETTINGS: PresentationSettings = Object.freeze({
  quality: "HIGH",
  reduceMotion: false,
  cameraEffectsIntensity: 0.7,
  reducedEffects: false,
  bloom: true,
  screenCrack: true,
  haze: true,
  masterVolume: 0.8,
  alarmVolume: 0.7,
  ambientVolume: 0.6,
  muted: false,
  debugPanel: false,
});

const KEY = "forgelab.presentation.v1";
const clamp01 = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Validates a stored value; anything unknown falls back to the default. */
export function parseSettings(raw: unknown): PresentationSettings {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    quality: QUALITY_TIERS.includes(r["quality"] as QualityTier)
      ? (r["quality"] as QualityTier)
      : d.quality,
    reduceMotion: bool(r["reduceMotion"], d.reduceMotion),
    cameraEffectsIntensity: clamp01(r["cameraEffectsIntensity"], d.cameraEffectsIntensity),
    reducedEffects: bool(r["reducedEffects"], d.reducedEffects),
    bloom: bool(r["bloom"], d.bloom),
    screenCrack: bool(r["screenCrack"], d.screenCrack),
    haze: bool(r["haze"], d.haze),
    masterVolume: clamp01(r["masterVolume"], d.masterVolume),
    alarmVolume: clamp01(r["alarmVolume"], d.alarmVolume),
    ambientVolume: clamp01(r["ambientVolume"], d.ambientVolume),
    muted: bool(r["muted"], d.muted),
    debugPanel: bool(r["debugPanel"], d.debugPanel),
  };
}

let current: PresentationSettings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): PresentationSettings {
  current ??= parseSettings(safeStorage.getJson(KEY, {}));
  return current;
}

export function updateSettings(patch: Partial<PresentationSettings>): void {
  current = parseSettings({ ...getSettings(), ...patch });
  safeStorage.setJson(KEY, current);
  for (const listener of listeners) listener();
}

/**
 * Picks a starting tier for this machine when the viewer has never chosen one: software
 * renderers (SwiftShader, llvmpipe) start on LOW. Not persisted — the viewer's own choice
 * always wins, and the simulation is unaffected either way.
 */
export function applyAutomaticQuality(rendererName: string): void {
  const stored = safeStorage.getJson<Record<string, unknown>>(KEY, {});
  if (typeof stored["quality"] === "string") return;
  if (!/swiftshader|llvmpipe|software/i.test(rendererName)) return;
  current = { ...getSettings(), quality: "LOW" };
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): PresentationSettings {
  return useSyncExternalStore(subscribeSettings, getSettings, () => DEFAULT_SETTINGS);
}

export function tierBudget(settings: PresentationSettings = getSettings()): TierBudget {
  return TIER_BUDGETS[settings.quality];
}

/** Motion is off when the viewer asked for it or the operating system does. */
export function motionAllowed(settings: PresentationSettings = getSettings()): boolean {
  if (settings.reduceMotion) return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
