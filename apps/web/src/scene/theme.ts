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
