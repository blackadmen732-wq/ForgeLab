import { Color, Plane, Vector3 } from "three";
import type { SimulationComponent, VesselState } from "@forgelab/sim-core";
import { frameScalar, type SessionFrame } from "@forgelab/sim-runner";
import type { Overlay } from "../store/editor.js";

/**
 * How each part is coloured. Chrome stays neutral; colour means physical state, and each
 * overlay maps one engine-computed quantity to one hue family. Nothing here computes
 * physics — every input is a value the engine published.
 */
export interface Readout {
  readonly utilization: number;
  readonly status: 0 | 1 | 2;
  readonly temperatureK: number;
  readonly limitTemperatureK: number;
  readonly supplyFraction: number;
  readonly powerW: number;
  readonly massFlowKgS: number;
  readonly fieldT: number;
  readonly role: string;
  /** Fusion-neutron energy deposited in the part, W. */
  readonly neutronHeatingW: number;
  readonly disabled: boolean;
  readonly free: boolean;
  readonly isLoad: boolean;
  readonly vessel: VesselState | null;
}

export function readoutFromComponent(component: SimulationComponent): Readout {
  const s = component.state.structural;
  const p = component.state.plant;
  return {
    utilization: s.utilization,
    status: s.status === "failed" ? 2 : s.status === "stressed" ? 1 : 0,
    temperatureK: p.thermal.temperatureK,
    limitTemperatureK: Number.isFinite(p.thermal.limitTemperatureK)
      ? p.thermal.limitTemperatureK
      : 0,
    supplyFraction: p.electrical?.supplyFraction ?? 1,
    powerW: p.electrical === null ? 0 : Math.max(p.electrical.deliveredW, p.electrical.suppliedW),
    massFlowKgS: p.coolant?.massFlowKgS ?? 0,
    fieldT: p.magnet?.fieldAtPlasmaT ?? p.vessel?.plasma.fieldT ?? 0,
    role: component.role,
    neutronHeatingW: p.outputs["neutronHeatingW"] ?? 0,
    disabled: p.disabled,
    free: component.state.support.mode === "free",
    isLoad: (p.electrical?.demandW ?? 0) > 0,
    vessel: p.vessel,
  };
}

export function readoutFromFrame(
  frame: SessionFrame,
  index: number,
  component: SimulationComponent,
): Readout {
  const status = frameScalar(frame, index, "status");
  const powerW = frameScalar(frame, index, "electricalPowerW");
  const supply = frameScalar(frame, index, "supplyFraction");
  return {
    utilization: frameScalar(frame, index, "utilization"),
    status: status >= 2 ? 2 : status >= 1 ? 1 : 0,
    temperatureK: frameScalar(frame, index, "temperatureK"),
    limitTemperatureK: frameScalar(frame, index, "limitTemperatureK"),
    supplyFraction: supply,
    powerW,
    massFlowKgS: frameScalar(frame, index, "massFlowKgS"),
    fieldT: frameScalar(frame, index, "fieldT"),
    role: component.role,
    neutronHeatingW: frameScalar(frame, index, "neutronHeatingW"),
    disabled: frameScalar(frame, index, "disabled") > 0,
    free: frameScalar(frame, index, "free") > 0,
    // Whether a part is a load is a property of its role, not of this tick.
    isLoad: (component.state.plant.electrical?.demandW ?? 0) > 0 || supply < 1,
    vessel: frame.vessels[component.id] ?? null,
  };
}

/* ------------------------------------------------------------------------------------ *
 * Palette (mirrors styles/tokens.css)
 * ------------------------------------------------------------------------------------ */

export const PALETTE = {
  dim: new Color("#3a424c"),
  neutral: new Color("#8a939e"),
  ok: new Color("#7fbf8f"),
  stress: new Color("#e2a53d"),
  fail: new Color("#e5534b"),
  cold: new Color("#3e7cc9"),
  warm: new Color("#e8e2d4"),
  hot: new Color("#f08a3c"),
  power: new Color("#f1d06b"),
  coolant: new Color("#4aa3e8"),
  field: new Color("#a78bfa"),
  plasma: new Color("#f472b6"),
  select: new Color("#6fd3d1"),
} as const;

const MATERIAL_COLORS: Record<string, string> = {
  "structural-steel": "#7b8590",
  "stainless-steel": "#a1a9b2",
  tungsten: "#565b62",
  copper: "#a87458",
  aluminum: "#bcc2c9",
  nbti: "#7b7fa6",
  "g10-cr": "#b9a35e",
};

/** Removes the half-space z > 0 in cutaway mode. */
export const CUT_PLANE = new Plane(new Vector3(0, 0, -1), 0);

export function materialColor(materialId: string): Color {
  return new Color(MATERIAL_COLORS[materialId] ?? "#8a939e");
}

const scratch = new Color();

function ramp(stops: readonly Color[], t: number, out: Color): Color {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return out.copy(stops[i]!).lerp(stops[i + 1]!, x - i);
}

const VACUUM_STOPS = [
  PALETTE.fail,
  PALETTE.stress,
  new Color("#56c2d6"),
  new Color("#4f8ff7"),
  new Color("#8fb8ff"),
];
const NEUTRON_STOPS = [
  new Color("#2a1840"),
  new Color("#7c3aed"),
  new Color("#e879f9"),
  new Color("#fdf4ff"),
];
const STRESS_STOPS = [PALETTE.neutral, PALETTE.ok, PALETTE.stress, PALETTE.fail];
const HEAT_STOPS = [PALETTE.neutral, PALETTE.warm, PALETTE.hot, PALETTE.fail];

/**
 * Hot metal glows. Above the Draper point (~798 K) a surface visibly emits: dull red,
 * then orange, then yellow-white. Colour from an approximate blackbody ramp; brightness
 * grows steeply with temperature. Drawn only from the temperature the engine published.
 */
const GLOW_STOPS = [
  new Color("#4a0800"),
  new Color("#b3240a"),
  new Color("#ff6a1a"),
  new Color("#ffb45c"),
  new Color("#fff0d8"),
];

export function incandescence(temperatureK: number, out: Color): number {
  if (!(temperatureK > 798)) return 0;
  const t = Math.min(1, (temperatureK - 798) / 1700);
  ramp(GLOW_STOPS, t, out);
  return 0.25 + 1.6 * t * t;
}

export interface Appearance {
  readonly color: Color;
  readonly emissive: Color;
  readonly emissiveIntensity: number;
}

/**
 * Colour for one part under an overlay. `base` is its material colour.
 * Failed parts are always flagged red, whatever the overlay.
 */
export function appearanceFor(
  overlay: Overlay,
  r: Readout,
  base: Color,
  out: { color: Color; emissive: Color },
): number {
  const failed = r.status === 2 || r.disabled;
  out.emissive.setRGB(0, 0, 0);
  let emissive = 0;
  switch (overlay) {
    case "none":
      out.color.copy(base);
      emissive = incandescence(r.temperatureK, out.emissive);
      break;
    case "stress":
      // 0 → neutral, 0.5 → green, 0.8 → amber, ≥1 → red.
      ramp(
        STRESS_STOPS,
        r.utilization <= 0.5
          ? r.utilization / 1.5
          : 1 / 3 + ((r.utilization - 0.5) / 0.5) * (2 / 3),
        out.color,
      );
      break;
    case "temperature": {
      // Ambient is neutral; warmer parts run white → orange → red as they approach their
      // own limit; parts colder than ambient (cryogenic coils) shade toward blue.
      const ambient = 293.15;
      if (r.temperatureK < ambient - 5) {
        const cold = Math.min(1, (ambient - r.temperatureK) / (ambient - 20));
        out.color.copy(PALETTE.neutral).lerp(PALETTE.cold, 0.35 + 0.65 * cold);
        break;
      }
      const limit = r.limitTemperatureK > ambient ? r.limitTemperatureK : 1500;
      const t = Math.max(0, (r.temperatureK - ambient) / (limit - ambient));
      ramp(HEAT_STOPS, t, out.color);
      if (t > 0.6) {
        out.emissive.copy(t >= 1 ? PALETTE.fail : PALETTE.hot);
        emissive = Math.min(0.8, (t - 0.6) * 1.5);
      }
      break;
    }
    case "power":
      if (r.powerW > 0) {
        out.color.copy(PALETTE.power);
        if (r.isLoad && r.supplyFraction < 0.999)
          ramp([PALETTE.fail, PALETTE.power], r.supplyFraction, out.color);
        out.emissive.copy(out.color);
        emissive = 0.25;
      } else if (r.isLoad) {
        out.color.copy(PALETTE.fail).multiplyScalar(0.7);
      } else out.color.copy(PALETTE.dim);
      break;
    case "coolant":
      if (r.massFlowKgS > 1e-6) {
        scratch.copy(PALETTE.dim);
        out.color
          .copy(scratch)
          .lerp(PALETTE.coolant, Math.min(1, 0.35 + Math.log10(1 + r.massFlowKgS) / 4));
      } else out.color.copy(PALETTE.dim);
      break;
    case "magnetic":
      if (r.fieldT > 1e-4) {
        out.color.copy(PALETTE.dim).lerp(PALETTE.field, Math.min(1, 0.3 + r.fieldT / 8));
        out.emissive.copy(PALETTE.field);
        emissive = Math.min(0.5, r.fieldT / 12);
      } else out.color.copy(PALETTE.dim);
      break;
    case "plasma":
      if (r.vessel !== null) {
        const phase = r.vessel.plasma.phase;
        out.color.copy(
          phase === "flat-top" || phase === "ramp-up"
            ? PALETTE.plasma
            : phase === "disrupted"
              ? PALETTE.fail
              : PALETTE.neutral,
        );
      } else out.color.copy(PALETTE.dim);
      break;
    case "vacuum":
      if (r.vessel !== null) {
        // log10(p): 5 at atmosphere, −2 at the breakdown limit, −5 and below deep vacuum.
        const lp = Math.log10(Math.max(1e-9, r.vessel.pressurePa));
        ramp(VACUUM_STOPS, (5 - lp) / 10, out.color);
        out.emissive.copy(out.color);
        emissive = 0.55;
      } else if (r.role === "vacuum-pump") {
        out.color.copy(r.disabled || r.supplyFraction < 0.95 ? PALETTE.stress : PALETTE.coolant);
      } else out.color.copy(PALETTE.dim);
      break;
    case "neutron":
      if (r.neutronHeatingW > 0) {
        // log10(W): 3 (1 kW) → 9 (1 GW).
        ramp(NEUTRON_STOPS, (Math.log10(r.neutronHeatingW) - 3) / 6, out.color);
        out.emissive.copy(out.color);
        emissive = 0.3 + 0.5 * Math.min(1, Math.max(0, (Math.log10(r.neutronHeatingW) - 3) / 6));
      } else out.color.copy(PALETTE.dim);
      break;
    case "failures":
      out.color.copy(failed ? PALETTE.fail : r.status === 1 ? PALETTE.stress : PALETTE.dim);
      break;
  }
  if (failed && overlay !== "failures") {
    out.color.lerp(PALETTE.fail, 0.6);
    out.emissive.copy(PALETTE.fail);
    emissive = Math.max(emissive, 0.35);
  }
  return emissive;
}

/**
 * Views that look *through* the rest of the plant: in the Vacuum view everything that is
 * not part of the vacuum system (vessels, vacuum pumps) is drawn as a ghost, so a vessel
 * wrapped in coils and blanket can still be read.
 */
export function ghostedIn(overlay: Overlay, r: Readout): boolean {
  return overlay === "vacuum" && r.vessel === null && r.role !== "vacuum-pump";
}

/** Plasma glow strength 0..1 from the vessel state (drawn inside the vessel). */
export function plasmaGlow(vessel: VesselState | null): number {
  if (vessel === null) return 0;
  const p = vessel.plasma;
  if (p.phase !== "ramp-up" && p.phase !== "flat-top" && p.phase !== "shutdown") return 0;
  return Math.min(1, 0.25 + p.temperatureKeV / 20);
}

export const CONNECTION_COLORS: Record<string, string> = {
  structural: "#6b7580",
  mount: "#6b7580",
  electrical: "#f1d06b",
  coolant: "#4aa3e8",
  steam: "#cfd6de",
  shaft: "#e8edf2",
  vacuum: "#8b96a4",
  fuel: "#7fbf8f",
  port: "#f472b6",
  control: "#6fd3d1",
};

export const CONNECTION_LABELS: Record<string, string> = {
  structural: "Structural",
  mount: "Mount",
  electrical: "Power",
  coolant: "Coolant",
  steam: "Steam",
  shaft: "Shaft",
  vacuum: "Vacuum",
  fuel: "Fuel",
  port: "Heating port",
  control: "Control signal",
};
