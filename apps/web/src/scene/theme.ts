import type { StructuralStatus } from "@forgelab/sim-core";

/**
 * Presentation only.
 *
 * `sim-core` classifies utilization into `normal` / `stressed` / `failed` and stops
 * there — it has no idea what any of those look like. The mapping from a physical
 * classification to something on screen lives here, in the renderer, and nowhere else.
 */
export const STATUS_COLORS: Record<StructuralStatus, string> = {
  normal: "#7d8b9c",
  stressed: "#d99a2b",
  failed: "#d6453f",
};

export const STATUS_LABELS: Record<StructuralStatus, string> = {
  normal: "Normal",
  stressed: "Stressed",
  failed: "Failed",
};

export const SELECTION_COLOR = "#4fd1c5";
export const FREE_BODY_COLOR = "#9a6bd6";
export const CENTER_OF_MASS_COLOR = "#f2c14e";
export const CONNECTION_COLOR = "#3f4c5c";

/* ------------------------------------------------------------------------------------ *
 * Cascade presentation
 *
 * Every physical phenomenon keeps its own appearance. A frame can show an orange battery
 * fire, dark smoke above it, a blue-white arc nearby, white steam from a ruptured pipe and
 * cold fog along the floor at once — because each colour belongs to a different physical
 * process. They are never merged into one "explosion".
 * ------------------------------------------------------------------------------------ */

export const PHENOMENON_COLORS = {
  flame: "#ff7a1a",
  flameCore: "#ffd27a",
  smoke: "#2a2622",
  arc: "#cfe3ff",
  steam: "#f2f5f8",
  cryoFog: "#bfe6ff",
  plasma: "#e45cff",
  plasmaFlash: "#ffd6ff",
  molten: "#ffb347",
  ventGas: "#c9c38a",
} as const;

/**
 * Incandescent glow of hot metal, approximating how steel looks as it heats (dull red
 * near 800 K, orange near 1100 K, yellow-white beyond 1400 K). Display only; the
 * temperatures themselves come from the cascade solver.
 */
export function incandescentColor(temperatureK: number): { color: string; intensity: number } {
  if (temperatureK < 780) return { color: "#000000", intensity: 0 };
  const stops: [number, [number, number, number]][] = [
    [780, [80, 0, 0]],
    [950, [190, 30, 5]],
    [1100, [255, 90, 15]],
    [1300, [255, 170, 60]],
    [1600, [255, 240, 200]],
  ];
  let rgb = stops[stops.length - 1]![1];
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (temperatureK <= t1) {
      const f = (temperatureK - t0) / (t1 - t0);
      rgb = [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * f)) as [
        number,
        number,
        number,
      ];
      break;
    }
  }
  const intensity = Math.min((temperatureK - 780) / 600, 1) * 1.6;
  return { color: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, intensity };
}

/** Sequential scale for the hazard view, cool to hot. */
export const HAZARD_SCALE = [
  "#1b2a3a",
  "#2f5d73",
  "#3f8f8a",
  "#c9b44a",
  "#e0742b",
  "#e23b2f",
] as const;

export function hazardScaleColor(fraction: number): string {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return HAZARD_SCALE[
    Math.min(Math.floor(clamped * HAZARD_SCALE.length), HAZARD_SCALE.length - 1)
  ]!;
}

const HAZARD_KIND_COLOR_TABLE: Record<string, string> = {
  "radiant-surface": "#e0742b",
  flame: "#ff7a1a",
  "hot-gas": "#c9b44a",
  "electric-arc": "#9cc8ff",
  "fluid-jet": "#e6eef5",
  "pressure-wave": "#ff4d6d",
  smoke: "#55504a",
  "cryogenic-gas": "#8fd3ff",
  "plasma-wall-heat": "#e45cff",
  "radiation-heating": "#7cff9e",
};

/** Depth labels in the catastrophe graph: root, secondary, tertiary... */
export const EVENT_DEPTH_COLORS = ["#ff5b4f", "#f2a23a", "#e3d35a", "#8fc7a0", "#7fb2d9"] as const;

export function hazardKindColor(kind: string): string {
  return HAZARD_KIND_COLOR_TABLE[kind] ?? "#ffffff";
}
