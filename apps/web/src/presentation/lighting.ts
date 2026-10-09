import type { FacilityState } from "./facility.js";

/**
 * What the hall's lights should be doing in each facility state. Pure; the scene
 * component eases toward these targets every frame.
 *
 * Real facilities run standby lighting when idle, bring banks up in sequence, sound and
 * light a warning before energising, and fall back to battery emergency lighting when
 * power is lost. That is the vocabulary used here — no colour-changing theatrics.
 */
export type BeaconMode = "off" | "amber" | "red";
export type IndicatorMode = "green" | "amber" | "red";

export interface LightingTargets {
  /** Multiplier for a fixture row (0 = dark, 1 = full). */
  readonly fixtureRow: (row: number) => number;
  /** Multiplier for the key and fill lights (the fixtures' combined throw). */
  readonly key: number;
  /** Multiplier for sky/ambient fill (clerestory daylight is unaffected by power). */
  readonly ambient: number;
  /** Emergency lamps, 0..1. */
  readonly emergency: number;
  readonly beacon: BeaconMode;
  /** Beacon rotations per second (0 = steady, when effects are reduced). */
  readonly beaconSpeed: number;
  readonly indicators: IndicatorMode;
  /** Indicators blink (1 Hz) — never faster, and never with reduced effects. */
  readonly indicatorsBlink: boolean;
  /** Multiplier for the perimeter work lights. */
  readonly work: number;
  /** Relative haze density. */
  readonly haze: number;
}

/** Seconds between fixture rows waking during start-up. */
export const ROW_WAKE_SEC = 0.22;

/**
 * @param state      facility state
 * @param elapsedSec real seconds since the state was entered
 * @param reduced    reduced-effects setting (no flicker, no rotating beacons, no blinking)
 */
export function lightingTargets(
  state: FacilityState,
  elapsedSec: number,
  reduced: boolean,
): LightingTargets {
  const all = (x: number) => () => x;
  const base: LightingTargets = {
    fixtureRow: all(1),
    key: 1,
    ambient: 1,
    emergency: 0,
    beacon: "off",
    beaconSpeed: 0,
    indicators: "green",
    indicatorsBlink: false,
    work: 1,
    haze: 1,
  };
  const spin = (hz: number) => (reduced ? 0 : hz);
  switch (state) {
    case "BUILD":
      return base;
    case "READY":
      return { ...base, fixtureRow: all(0.45), key: 0.55, work: 1, haze: 0.9 };
    case "STARTUP":
      return {
        ...base,
        // Banks come on one row at a time, west to east.
        fixtureRow: (row) => (reduced || elapsedSec >= row * ROW_WAKE_SEC ? 1 : 0.45),
        key: Math.min(1, 0.55 + elapsedSec * 0.15),
        beacon: "amber",
        beaconSpeed: spin(0.5),
        indicators: "amber",
      };
    case "RUNNING":
      return base;
    case "WARNING":
      return { ...base, beacon: "amber", beaconSpeed: spin(0.75), indicators: "amber" };
    case "POWER_LOSS": {
      // A brief flicker as supply collapses, then emergency lighting only.
      const flicker =
        !reduced && elapsedSec < 1.2 ? (Math.sin(elapsedSec * 47) > 0.2 ? 0.6 : 0.1) : 0.06;
      return {
        ...base,
        fixtureRow: all(flicker),
        key: flicker * 0.9 + 0.05,
        ambient: 0.8,
        emergency: 1,
        beacon: "red",
        beaconSpeed: spin(0.5),
        indicators: "red",
        indicatorsBlink: !reduced,
        work: 0.1,
        haze: 1.1,
      };
    }
    case "EMERGENCY":
    case "FAILURE":
      return {
        ...base,
        fixtureRow: all(0.85),
        key: 0.85,
        emergency: 0.7,
        beacon: "red",
        beaconSpeed: spin(1),
        indicators: "red",
        indicatorsBlink: !reduced,
        haze: 1.25,
      };
    case "POST_FAILURE":
      return {
        ...base,
        fixtureRow: all(0.6),
        key: 0.6,
        emergency: 0.8,
        beacon: "red",
        beaconSpeed: spin(0.35),
        indicators: "red",
        work: 0.8,
        haze: 1.35,
      };
  }
}
