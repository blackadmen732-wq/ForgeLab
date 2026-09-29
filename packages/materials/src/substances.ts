import type { MaterialDefinition, MaterialId } from "./types.js";
import { MATERIAL_CATALOG } from "./catalog.js";

/**
 * Substances: what the inside of a finished component is made of.
 *
 * Structural materials (catalog.ts) are substances with a complete engineering data set,
 * because the structural solver needs every one of their numbers. The substances below
 * appear only as internal regions of finished components (a magnet's superconductor, its
 * insulation). They carry only the property groups we have sources for; a group that is
 * not listed is unknown, never zero. See docs/material-sources.md.
 */
export interface SuperconductorProperties {
  /** Critical temperature at zero field, Tc0. */
  readonly criticalTemperatureZeroFieldK: number;
  /** Upper critical field at zero temperature, Bc20. */
  readonly upperCriticalFieldZeroTemperatureT: number;
  /** n in Bc2(T) = Bc20 · (1 − (T/Tc0)^n). */
  readonly temperatureExponent: number;
  readonly source: string;
}

export interface SubstanceDefinition {
  readonly id: MaterialId;
  readonly name: string;
  readonly grade: string;
  readonly densityKgM3: number;
  /** Room-temperature specific heat, when known. */
  readonly specificHeatJkgK?: number;
  /** Room-temperature thermal conductivity, when known (through-thickness for laminates). */
  readonly thermalConductivityWmK?: number;
  /** Room-temperature electrical resistivity; `Infinity` for insulators. */
  readonly electricalResistivityOhmM?: number;
  readonly superconductor?: SuperconductorProperties;
  readonly sourceSummary: string;
  readonly notes: readonly string[];
}

const NB_TI: SubstanceDefinition = {
  id: "nbti",
  name: "Niobium–Titanium",
  grade: "Nb-47 wt% Ti superconductor alloy",
  // Ideal-mixture estimate from elemental densities (Nb 8.57, Ti 4.506 g/cm³):
  // 1/ρ = 0.53/8.57 + 0.47/4.506  →  ρ = 6.02 g/cm³.
  densityKgM3: 6020,
  superconductor: {
    criticalTemperatureZeroFieldK: 9.2,
    upperCriticalFieldZeroTemperatureT: 14.5,
    temperatureExponent: 1.7,
    source:
      "L. Bottura, 'A practical fit for the critical surface of NbTi', IEEE Trans. Appl. Supercond. 10 (2000) 1054 (LHC Project Report 358): Bc20 = 14.5 T, Tc0 = 9.2 K; Bc2(T) = Bc20(1 − t^1.7) after Lubell (1983).",
  },
  sourceSummary:
    "Bottura (2000) critical-surface parameters; density derived from elemental densities.",
  notes: [
    "Only the superconducting critical surface and density are catalogued; NbTi is used here as the conductor region of finished magnets, never as a structural member.",
    "The critical temperature falls with field: at 5 T, Tc ≈ 7.2 K; at 9 T, Tc ≈ 5.3 K.",
  ],
};

const G10_CR: SubstanceDefinition = {
  id: "g10-cr",
  name: "G-10CR Fiberglass Epoxy",
  grade: "NEMA G-10CR woven glass / epoxy laminate (cryogenic grade)",
  densityKgM3: 1800,
  specificHeatJkgK: 999,
  thermalConductivityWmK: 0.61,
  electricalResistivityOhmM: Infinity,
  sourceSummary:
    "NIST cryogenic material properties (G-10CR) curve fits at 300 K; density from supplier datasheets.",
  notes: [
    "Specific heat 999 J/(kg·K) and normal-direction conductivity 0.61 W/(m·K) are the NIST G-10CR fits evaluated at 300 K (2 % and 5 % fit error).",
    "Density: specific gravity 1.8 (Atlas Fibre G10 datasheet); other suppliers quote 1.70–1.90.",
    "At 4.5 K the NIST fits give 2.8 J/(kg·K) and 0.08 W/(m·K): insulation is a thermal barrier in a magnet.",
  ],
};

export const SUBSTANCE_CATALOG: readonly SubstanceDefinition[] = Object.freeze([NB_TI, G10_CR]);

const BY_ID: ReadonlyMap<MaterialId, SubstanceDefinition | MaterialDefinition> = new Map<
  MaterialId,
  SubstanceDefinition | MaterialDefinition
>([
  ...MATERIAL_CATALOG.map((m) => [m.id, m] as const),
  ...SUBSTANCE_CATALOG.map((s) => [s.id, s] as const),
]);

/** Any substance: a structural material or an internal-only substance. */
export function findSubstance(id: MaterialId): SubstanceDefinition | undefined {
  return BY_ID.get(id);
}

export function getSubstance(id: MaterialId): SubstanceDefinition {
  const substance = BY_ID.get(id);
  if (substance === undefined) throw new Error(`Unknown substance id "${id}".`);
  return substance;
}

/**
 * Upper critical field at temperature T: Bc2(T) = Bc20 · (1 − (T/Tc0)^n). Zero at and
 * above Tc0.
 */
export function upperCriticalFieldT(sc: SuperconductorProperties, temperatureK: number): number {
  const t = temperatureK / sc.criticalTemperatureZeroFieldK;
  if (t >= 1) return 0;
  return sc.upperCriticalFieldZeroTemperatureT * (1 - Math.max(0, t) ** sc.temperatureExponent);
}

/**
 * Critical temperature in field B — the inverse of the relation above:
 * Tc(B) = Tc0 · (1 − B/Bc20)^(1/n). Zero at and above Bc20.
 */
export function criticalTemperatureK(sc: SuperconductorProperties, fieldT: number): number {
  const b = Math.abs(fieldT) / sc.upperCriticalFieldZeroTemperatureT;
  if (b >= 1) return 0;
  return sc.criticalTemperatureZeroFieldK * (1 - b) ** (1 / sc.temperatureExponent);
}
