import type { PlasmaPhase, PlasmaState, VesselState } from "@forgelab/sim-core";
import type { PlasmaStyle } from "../../presentation/settings.js";
import { plasmaUnrest } from "./appearance.js";

/**
 * From published plasma state to what is drawn. Pure: the same state gives the same look,
 * and nothing here is ever read back by the simulation.
 *
 * This is a VISUALISATION of the 0-D plasma state, not a prediction of optical emission.
 * The mappings are physically motivated and deliberately simple; each one is documented
 * where it is defined and listed in docs/audit-2026-11-11/PLASMA-VFX-AUDIO.md:
 *
 *   density            → brightness of the edge light          (`edgeEmission`)
 *   temperature        → how hollow the plasma is              (`coreGlow`, `shellWidth`)
 *   power across edge  → brightness of the lower-edge region   (`edgePowerGlow`)
 *   density limit, T   → pink ↔ violet balance of the edge     (`edgeViolet`)
 *   safety factor q95  → pitch of the field-aligned filaments  (`filamentModes`)
 *   distance to limits → unrest of the filaments               (`plasmaUnrest`)
 *
 * What a real tokamak camera sees supports the shape of these mappings, not their
 * numbers: the fully ionised core emits only weak visible continuum, while neutral fuel
 * and impurities at the cooler edge and in the divertor emit strong lines (Balmer-α at
 * 656 nm dominates hydrogen isotopes, hence pink).
 */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Density at which the edge light is faint and at which it is full, m⁻³ (log between). */
export const EDGE_DENSITY_RANGE_M3 = [1e18, 1e20] as const;

/**
 * Edge light 0..1 from density: linear up to 10¹⁸ m⁻³ (0.3 there), then logarithmic to 1
 * at 10²⁰ m⁻³, the range of real devices. No positive finite density means no light.
 */
export function edgeEmission(densityM3: number): number {
  if (!Number.isFinite(densityM3) || densityM3 <= 0) return 0;
  const [lo, hi] = EDGE_DENSITY_RANGE_M3;
  if (densityM3 < lo) return 0.3 * (densityM3 / lo);
  return 0.3 + 0.7 * clamp01(Math.log10(densityM3 / lo) / Math.log10(hi / lo));
}

/**
 * Burn-through window, keV. Around 10 eV the breakdown gas is partly ionised and radiates
 * in lines through its whole volume; by about 1 keV the interior is fully ionised.
 */
export const BURN_THROUGH_KEV = [0.01, 1] as const;
/** Interior light left once the core has burnt through: weak continuum only. */
export const CORE_CONTINUUM = 0.03;

function burnThrough(temperatureKeV: number): number {
  if (!Number.isFinite(temperatureKeV) || temperatureKeV <= BURN_THROUGH_KEV[0]) return 0;
  const [lo, hi] = BURN_THROUGH_KEV;
  return smooth(clamp01(Math.log10(temperatureKeV / lo) / Math.log10(hi / lo)));
}

/**
 * Interior glow 0..1 from temperature: 1 while the plasma is cold enough to radiate
 * throughout (breakdown, the last moments of a shutdown), falling on a log scale to
 * `CORE_CONTINUUM` once the core has burnt through. This is why a hot plasma looks hollow.
 */
export function coreGlow(temperatureKeV: number): number {
  return 1 + (CORE_CONTINUUM - 1) * burnThrough(temperatureKeV);
}

/** Emitting-shell width ÷ minor radius: broad while cold, a thin edge layer when hot. */
export function shellWidth(temperatureKeV: number): number {
  return 0.3 + (0.09 - 0.3) * burnThrough(temperatureKeV);
}

/** Outer surface of the plasma, m²: a circular torus, or the side of a linear column. */
export function plasmaSurfaceM2(
  p: Pick<PlasmaState, "majorRadiusM" | "minorRadiusM" | "volumeM3">,
): number {
  if (!(p.minorRadiusM > 0)) return 0;
  if (p.majorRadiusM > 0) return 4 * Math.PI ** 2 * p.majorRadiusM * p.minorRadiusM;
  const lengthM = p.volumeM3 / (Math.PI * p.minorRadiusM ** 2);
  return lengthM > 0 ? 2 * Math.PI * p.minorRadiusM * lengthM : 0;
}

/** Power per unit plasma surface at which the lower-edge glow starts and saturates, W/m². */
export const EDGE_POWER_RANGE_W_M2 = [1e3, 1e6] as const;

/**
 * Lower-edge glow 0..1 from the power the plasma loses across its edge (published
 * transport loss) per unit of its surface, on a log scale. In a real tokamak that power
 * lands in the divertor, which is the brightest thing an in-vessel camera sees. The model
 * has no divertor geometry: the glow is drawn at the lower edge as a schematic cue.
 */
export function edgePowerGlow(
  p: Pick<PlasmaState, "transportLossW" | "majorRadiusM" | "minorRadiusM" | "volumeM3">,
): number {
  const area = plasmaSurfaceM2(p);
  if (!(area > 0) || !Number.isFinite(p.transportLossW) || p.transportLossW <= 0) return 0;
  const [lo, hi] = EDGE_POWER_RANGE_W_M2;
  return clamp01(Math.log10(p.transportLossW / area / lo) / Math.log10(hi / lo));
}

/**
 * Violet share of the edge colour, 0..1. A hot, thin edge is Balmer-α pink; a dense or
 * cold one (near the density limit, at breakdown, late in a shutdown) recombines and
 * radiates relatively more in the blue Balmer lines.
 */
export function edgeViolet(greenwaldFraction: number, temperatureKeV: number): number {
  const dense = Number.isFinite(greenwaldFraction) ? clamp01((greenwaldFraction - 0.4) / 0.6) : 0;
  return clamp01(0.55 * dense + 0.35 * (1 - burnThrough(temperatureKeV)));
}

/** Poloidal stripe counts tried, nearest the preferred 24 first. */
const POLOIDAL_MODES = [24, 23, 25, 22, 26, 21, 27, 20, 28, 19, 29, 18, 30] as const;

/**
 * Filaments follow the field: a field line turns once poloidally every q95 toroidal
 * turns, so stripes of constant (m·θ − n·φ) with m/n = q95 lie along it. m and n must be
 * whole numbers for the pattern to close around the torus; this picks the pair nearest
 * the published safety factor with m between 18 and 30.
 */
export function filamentModes(q95: number): { readonly m: number; readonly n: number } {
  if (!Number.isFinite(q95) || q95 <= 0) return { m: 24, n: 8 };
  let best = { m: 24, n: Math.max(1, Math.round(24 / q95)) };
  let error = Math.abs(best.m / best.n - q95);
  for (const m of POLOIDAL_MODES) {
    const n = Math.max(1, Math.round(m / q95));
    const e = Math.abs(m / n - q95);
    if (e < error - 1e-9) {
      best = { m, n };
      error = e;
    }
  }
  return best;
}

/** What to draw for a live plasma. All values come from the published state. */
export interface PlasmaLook {
  /** Edge light 0..1 (density). */
  readonly emission: number;
  /** Interior glow 0..1 (temperature). */
  readonly core: number;
  /** Emitting-shell width ÷ minor radius (temperature). */
  readonly shell: number;
  /** Lower-edge glow 0..1 (power across the edge). */
  readonly edgePower: number;
  /** Violet share of the edge colour 0..1. */
  readonly violet: number;
  /** Filament stripes around the poloidal and toroidal directions. */
  readonly m: number;
  readonly n: number;
  /** Precursor unrest 0..1 near a stability limit. */
  readonly unrest: number;
  /** Published plasma size, m (0 when the vessel publishes none). */
  readonly majorRadiusM: number;
  readonly minorRadiusM: number;
}

const LIVE: ReadonlySet<PlasmaPhase> = new Set(["ramp-up", "flat-top", "shutdown"]);

export function isLive(phase: PlasmaPhase | undefined): boolean {
  return phase !== undefined && LIVE.has(phase);
}

/** The look of the published plasma state; null when there is no plasma to draw. */
export function plasmaLook(vessel: VesselState | null): PlasmaLook | null {
  if (vessel === null) return null;
  const p = vessel.plasma;
  if (!isLive(p.phase)) return null;
  const emission = edgeEmission(p.densityM3);
  if (emission === 0) return null;
  const { m, n } = filamentModes(p.safetyFactorQ95);
  return {
    emission,
    core: coreGlow(p.temperatureKeV),
    shell: shellWidth(p.temperatureKeV),
    edgePower: edgePowerGlow(p),
    violet: edgeViolet(p.greenwaldFraction, p.temperatureKeV),
    m,
    n,
    unrest: plasmaUnrest(vessel),
    majorRadiusM: p.majorRadiusM > 0 ? p.majorRadiusM : 0,
    minorRadiusM: p.minorRadiusM > 0 ? p.minorRadiusM : 0,
  };
}

/* ------------------------------------------------------------------------------------ *
 * Display styles: two ways of showing the same look
 * ------------------------------------------------------------------------------------ */

export interface StyleLook {
  readonly label: string;
  readonly summary: string;
  /** Overall light. */
  readonly gain: number;
  /** Brightest value written: above 1 is left for the bloom pass to spread. */
  readonly headroom: number;
  /** How much the brightest plasma dims what is behind it (0 = pure emission). */
  readonly veil: number;
  readonly saturation: number;
  /** Least interior glow drawn, so the volume keeps some body. */
  readonly coreFloor: number;
  /** Filament contrast. */
  readonly filament: number;
  /** Bloom pass settings while this style is selected. */
  readonly bloomStrength: number;
  readonly bloomThreshold: number;
}

export const STYLE_LOOKS: Readonly<Record<PlasmaStyle, StyleLook>> = Object.freeze({
  scientific: {
    label: "Scientific",
    summary: "Restrained: pure emission, a nearly dark core, the mappings listed.",
    gain: 0.85,
    headroom: 1,
    veil: 0,
    saturation: 0.92,
    coreFloor: 0,
    filament: 0.7,
    bloomStrength: 0.55,
    bloomThreshold: 0.9,
  },
  cinematic: {
    label: "Cinematic",
    summary: "More glow and contrast. Same plasma, same numbers.",
    gain: 1.5,
    headroom: 2.2,
    veil: 0.5,
    saturation: 1.12,
    coreFloor: 0.07,
    filament: 1,
    bloomStrength: 0.8,
    bloomThreshold: 0.82,
  },
});

/* ------------------------------------------------------------------------------------ *
 * Sequences: what happens in presentation time after a published phase change
 * ------------------------------------------------------------------------------------ */

/** The breakdown flash lasts this long, s. */
export const BREAKDOWN_FLASH_S = 2.5;

/**
 * Breakdown flash 0..1, `t` seconds after the published change off → ramp-up: the gas
 * ionises and radiates through the whole vessel before it burns through. Rises in a few
 * hundredths of a second, decays in about half a second.
 */
export function breakdownFlash(t: number): number {
  if (!(t >= 0) || t >= BREAKDOWN_FLASH_S) return 0;
  return (1 - Math.exp(-t / 0.03)) * Math.exp(-t / 0.45);
}

/** A disruption's visible sequence lasts this long, s. */
export const DISRUPTION_SEQUENCE_S = 1.6;

export interface DisruptionStage {
  /** Light at the wall where the thermal energy lands, 0..1 (the thermal quench). */
  readonly wallFlash: number;
  /** Light left in the column, relative to before (the current quench). */
  readonly light: number;
  /** Column radius ÷ its radius before. */
  readonly shrink: number;
  /** How far the column has moved towards the wall, ÷ minor radius. */
  readonly drop: number;
  /** 0..1: the column is cold, so it radiates through its whole volume again. */
  readonly cool: number;
}

/**
 * A disruption, `t` seconds after the published event. The simulation ends the plasma in
 * one step (its thermal and magnetic energy go to the wall "within milliseconds"); this
 * only spreads the picture of that over time: a flash at the wall as the heat lands
 * (thermal quench, shown ~0.2 s), then a cold, shrinking column that drifts into the
 * wall and fades as its current decays (current quench, shown ~1 s — real ones take
 * tens of milliseconds in a large tokamak). The stretch is for the eye, and is stated.
 */
export function disruptionStage(t: number): DisruptionStage {
  if (!(t >= 0) || t >= DISRUPTION_SEQUENCE_S)
    return { wallFlash: 0, light: 0, shrink: 0.5, drop: 0.35, cool: 1 };
  const late = clamp01((t - 1.2) / (DISRUPTION_SEQUENCE_S - 1.2));
  return {
    wallFlash: Math.exp(-t / 0.07),
    light: Math.exp(-t / 0.3) * (1 + 1.4 * Math.exp(-t / 0.05)) * (1 - late),
    shrink: 1 - 0.5 * (1 - Math.exp(-t / 0.25)),
    drop: 0.35 * (1 - Math.exp(-t / 0.3)),
    cool: 1 - Math.exp(-t / 0.12),
  };
}

/** The afterglow of a plasma that ended by a controlled shutdown lasts this long, s. */
export const AFTERGLOW_S = 1.5;

/** Afterglow 0..1, `t` seconds after the published change shutdown → ended. */
export function afterglow(t: number): number {
  if (!(t >= 0) || t >= AFTERGLOW_S) return 0;
  return Math.exp(-t / 0.35) * (1 - clamp01((t - 1.1) / (AFTERGLOW_S - 1.1)));
}

export type PlasmaSequence = "none" | "breakdown" | "disruption" | "afterglow";

/** One frame of plasma drawing: the look plus where its timed sequences are. */
export interface PlasmaFrame {
  readonly visible: boolean;
  /** The live look, or the last live one while a termination sequence plays. */
  readonly look: PlasmaLook | null;
  readonly sequence: PlasmaSequence;
  /** Breakdown flash 0..1. */
  readonly flash: number;
  /** Overall light multiplier (1 while live). */
  readonly light: number;
  readonly wallFlash: number;
  readonly shrink: number;
  readonly drop: number;
  readonly cool: number;
  /** A timed sequence is in progress: keep rendering. */
  readonly animating: boolean;
}

const DARK: PlasmaFrame = Object.freeze({
  visible: false,
  look: null,
  sequence: "none",
  flash: 0,
  light: 0,
  wallFlash: 0,
  shrink: 1,
  drop: 0,
  cool: 0,
  animating: false,
});

/**
 * Follows one vessel's published plasma phase and times the sequences its changes start.
 * Deterministic: the same phases at the same presentation times give the same frames.
 * It never creates a plasma: light exists while the published state is live, and for a
 * bounded moment after the published end.
 */
export class PlasmaSequencer {
  #phase: PlasmaPhase | "none" = "none";
  #last: PlasmaLook | null = null;
  #flashAt = -Infinity;
  #endAt = -Infinity;
  #end: "disruption" | "afterglow" | null = null;

  /** Forget everything: RETURN TO BUILD, a new run, a replay seek. */
  reset(): void {
    this.#phase = "none";
    this.#last = null;
    this.#flashAt = -Infinity;
    this.#endAt = -Infinity;
    this.#end = null;
  }

  /**
   * @param vessel the published vessel state, or null when there is none (Build)
   * @param nowS presentation time, s
   * @param flashes false leaves the flashes out (reduced flashing); the fades still play
   */
  update(vessel: VesselState | null, nowS: number, flashes = true): PlasmaFrame {
    if (vessel === null) {
      this.reset();
      return DARK;
    }
    const phase = vessel.plasma.phase;
    const was = this.#phase;
    if (phase !== was) {
      if (phase === "ramp-up" && was === "off") this.#flashAt = nowS;
      if (phase === "disrupted" && isLive(was as PlasmaPhase)) {
        this.#end = "disruption";
        this.#endAt = nowS;
      } else if (phase === "ended" && isLive(was as PlasmaPhase)) {
        this.#end = "afterglow";
        this.#endAt = nowS;
      } else if (isLive(phase) || phase === "off") {
        this.#end = null;
        this.#endAt = -Infinity;
      }
      if (phase === "off") {
        this.#last = null;
        this.#flashAt = -Infinity;
      }
      this.#phase = phase;
    }
    const look = plasmaLook(vessel);
    if (look !== null) {
      this.#last = look;
      const flash = flashes ? breakdownFlash(nowS - this.#flashAt) : 0;
      return {
        visible: true,
        look,
        sequence: flash > 0 ? "breakdown" : "none",
        flash,
        light: 1,
        wallFlash: 0,
        shrink: 1,
        drop: 0,
        cool: 0,
        animating: nowS - this.#flashAt < BREAKDOWN_FLASH_S,
      };
    }
    const since = nowS - this.#endAt;
    if (this.#end === "disruption" && this.#last !== null && since < DISRUPTION_SEQUENCE_S) {
      const stage = disruptionStage(since);
      return {
        visible: true,
        look: this.#last,
        sequence: "disruption",
        flash: 0,
        light: flashes ? stage.light : Math.min(1, stage.light),
        wallFlash: flashes ? stage.wallFlash : 0,
        shrink: stage.shrink,
        drop: stage.drop,
        cool: stage.cool,
        animating: true,
      };
    }
    if (this.#end === "afterglow" && this.#last !== null && since < AFTERGLOW_S) {
      return {
        visible: true,
        look: this.#last,
        sequence: "afterglow",
        flash: 0,
        light: afterglow(since),
        wallFlash: 0,
        shrink: 1,
        drop: 0,
        cool: 1,
        animating: true,
      };
    }
    return DARK;
  }
}
