import { findMaterialRecord } from "@forgelab/materials";

/** Presentation only: bare conductors reflect as metal; paint and insulators do not.
 * The shared wear map averages ~0.94, so compensate without flattening rough finishes.
 * No thermal, electrical or strength property is changed here.
 */
export function surfaceFinish(materialId: string | null): { metalness: number; roughness: number } {
  const record = materialId === null ? undefined : findMaterialRecord(materialId);
  const p = record?.presentation;
  const bareMetal =
    p !== undefined &&
    ["steel", "copper", "light-alloy", "refractory", "superconductor"].includes(p.thermalResponse);
  return {
    metalness: bareMetal ? 0.95 : 0,
    roughness: Math.min(1, (p?.roughness ?? 0.65) / 0.94),
  };
}

/** Optical cues for schematic internal volumes, not a fluid solver or a fill-level model.
 * The coloured Engineering/Internals overlays are applied separately by paintRegion.
 */
export function fluidFinish(substanceId: string | null): {
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
} {
  if (substanceId === "lithium-lead")
    return { color: "#9da4aa", metalness: 0.95, roughness: 0.24, opacity: 1 };
  if (substanceId === "mineral-oil")
    return { color: "#c6a765", metalness: 0, roughness: 0.16, opacity: 0.3 };
  if (["helium", "deuterium", "tritium", "dt-fuel"].includes(substanceId ?? ""))
    return { color: "#e3e9ed", metalness: 0, roughness: 0.18, opacity: 0 };
  return { color: "#d3e2e7", metalness: 0, roughness: 0.18, opacity: 0.18 };
}
