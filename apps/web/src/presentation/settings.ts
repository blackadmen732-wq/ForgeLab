import { useSyncExternalStore } from "react";
import { safeStorage } from "../lib/storage.js";

/**
 * Local presentation options. They belong to this viewer on this device: they are never
 * saved with a project, never sent to collaborators, and never reach the simulation. A
 * quality tier changes how much is drawn, not what is computed.
 */
export type QualityTier = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

export const QUALITY_TIERS: readonly QualityTier[] = ["LOW", "MEDIUM", "HIGH", "ULTRA"];

/**
 * How the plasma is drawn. Both styles show the same published plasma state and neither
 * changes a simulated number: SCIENTIFIC is restrained (pure emission, a nearly dark core,
 * a legend of the mappings), CINEMATIC has more contrast and glow.
 */
export type PlasmaStyle = "scientific" | "cinematic";

export const PLASMA_STYLES: readonly PlasmaStyle[] = ["scientific", "cinematic"];

export interface PresentationSettings {
  readonly quality: QualityTier;
  /** Disables camera shake, kick and flinch (also forced by the OS setting). */
  readonly reduceMotion: boolean;
  /** 0..1 scale for camera shake, kick and flinch. */
  readonly cameraEffectsIntensity: number;
  /**
   * Calmer effects altogether: everything `reducedFlashing` removes, and also half the
   * particles, no heat shimmer, no shock ring and no camera exposure lift.
   */
  readonly reducedEffects: boolean;
  /**
   * No flashes or strobing: arcs hold instead of flickering, the breakdown and disruption
   * flashes are left out, lamps and beacons stop blinking. Sequences still play.
   */
  readonly reducedFlashing: boolean;
  readonly plasmaStyle: PlasmaStyle;
  /** Draws schematic field lines over the plasma (labelled; pitch from the published q95). */
  readonly plasmaFieldLines: boolean;
  readonly bloom: boolean;
  readonly screenCrack: boolean;
  readonly haze: boolean;
  /**
   * On a failure, select the root-cause part and open the cutaway on it. Never moves the
   * camera: the cut faces wherever the player is looking from.
   */
  readonly autoCutaway: boolean;
  readonly masterVolume: number;
  readonly alarmVolume: number;
  readonly ambientVolume: number;
  /** Machines and failure sounds. */
  readonly effectsVolume: number;
  /** Buttons and building sounds (placing, mating, connecting parts). */
  readonly interfaceVolume: number;
  readonly muted: boolean;
  /**
   * Diagnostic sonification of the plasma (a tone following its published current and
   * density). Off by default: a plasma in vacuum makes no sound, so this is a labelled
   * instrument, never an effect.
   */
  readonly plasmaSonification: boolean;
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
  /** Damage marks (scorch, soot, frost, cracks, tears) kept on surfaces for the run. */
  readonly marks: number;
  /** Resolution of the hall floor's live mirror reflection; 0 = reflections from the environment map only. */
  readonly floorReflections: number;
  /** Screen-space ambient occlusion (contact shadows where surfaces meet). */
  readonly ambientOcclusion: boolean;
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
    marks: 12,
    floorReflections: 0,
    ambientOcclusion: false,
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
    marks: 24,
    floorReflections: 0,
    ambientOcclusion: false,
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
    marks: 40,
    floorReflections: 512,
    ambientOcclusion: true,
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
    marks: 64,
    floorReflections: 1024,
    ambientOcclusion: true,
  },
});

export const DEFAULT_SETTINGS: PresentationSettings = Object.freeze({
  quality: "HIGH",
  reduceMotion: false,
  cameraEffectsIntensity: 0.7,
  reducedEffects: false,
  reducedFlashing: false,
  plasmaStyle: "cinematic",
  plasmaFieldLines: false,
  bloom: true,
  screenCrack: true,
  haze: true,
  autoCutaway: false,
  masterVolume: 0.8,
  alarmVolume: 0.7,
  ambientVolume: 0.6,
  effectsVolume: 0.9,
  interfaceVolume: 0.6,
  muted: false,
  plasmaSonification: false,
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
    reducedFlashing: bool(r["reducedFlashing"], d.reducedFlashing),
    plasmaStyle: PLASMA_STYLES.includes(r["plasmaStyle"] as PlasmaStyle)
      ? (r["plasmaStyle"] as PlasmaStyle)
      : d.plasmaStyle,
    plasmaFieldLines: bool(r["plasmaFieldLines"], d.plasmaFieldLines),
    bloom: bool(r["bloom"], d.bloom),
    screenCrack: bool(r["screenCrack"], d.screenCrack),
    haze: bool(r["haze"], d.haze),
    autoCutaway: bool(r["autoCutaway"], d.autoCutaway),
    masterVolume: clamp01(r["masterVolume"], d.masterVolume),
    alarmVolume: clamp01(r["alarmVolume"], d.alarmVolume),
    ambientVolume: clamp01(r["ambientVolume"], d.ambientVolume),
    effectsVolume: clamp01(r["effectsVolume"], d.effectsVolume),
    interfaceVolume: clamp01(r["interfaceVolume"], d.interfaceVolume),
    muted: bool(r["muted"], d.muted),
    plasmaSonification: bool(r["plasmaSonification"], d.plasmaSonification),
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

/**
 * Whether flashes and strobing are left out: the viewer asked for it directly, or asked for
 * reduced effects (which include it).
 */
export function flashingReduced(settings: PresentationSettings = getSettings()): boolean {
  return settings.reducedFlashing || settings.reducedEffects;
}

/**
 * Share of a tier's particle budget in use: reduced effects draw half. Drawing only; the
 * events, their timing and the simulation are the same.
 */
export function effectScale(settings: PresentationSettings = getSettings()): number {
  return settings.reducedEffects ? 0.5 : 1;
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
