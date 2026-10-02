import { FLUID_LIBRARY } from "./fluids.js";
import { MATERIAL_LIBRARY } from "./library.js";
import type { FluidRecord, MaterialRecord } from "./schema.js";
import type { MaterialId } from "./types.js";

/**
 * Substances: what the inside of a finished component is made of — any library material
 * (structural or not). A compact view of a library record for the solvers; the full
 * record, with every value's source, is `getMaterialRecord`.
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
  /**
   * Only when a field-dependent critical surface is catalogued. Superconductors with only
   * a zero-field Tc (REBCO, MgB₂) have none and cannot set a field-dependent limit.
   */
  readonly superconductor?: SuperconductorProperties;
  /** Ignition temperature in air, when the material burns (sourced in the record). */
  readonly ignitionK?: number;
  /**
   * What burning needs beyond ignition, only when both values are sourced: without them
   * the material is not burned by the model (it is reported, not invented).
   */
  readonly combustion?: Combustion;
  readonly sourceSummary: string;
  readonly notes: readonly string[];
}

export interface Combustion {
  /** Effective heat of combustion, J/kg. */
  readonly heatOfCombustionJPerKg: number;
  /** Free-burning mass loss per unit burning area, kg/(m²·s). */
  readonly burningRateKgM2S: number;
}

function substanceOf(record: MaterialRecord): SubstanceDefinition {
  const sc = record.superconducting;
  const e = record.electrical;
  const fire = record.presentation.combustible;
  return Object.freeze({
    id: record.id,
    name: record.name,
    grade: record.grade,
    densityKgM3: record.density.value,
    ...(record.thermal?.specificHeat !== undefined
      ? { specificHeatJkgK: record.thermal.specificHeat.value }
      : {}),
    ...(record.thermal?.conductivity !== undefined
      ? { thermalConductivityWmK: record.thermal.conductivity.value }
      : {}),
    ...(e?.insulator === true
      ? { electricalResistivityOhmM: Infinity }
      : e?.resistivity !== undefined
        ? { electricalResistivityOhmM: e.resistivity.value }
        : {}),
    ...(sc !== undefined &&
    sc.criticalSurface !== null &&
    sc.upperCriticalFieldZeroTemperature !== undefined &&
    sc.temperatureExponent !== undefined
      ? {
          superconductor: Object.freeze({
            criticalTemperatureZeroFieldK: sc.criticalTemperatureZeroField.value,
            upperCriticalFieldZeroTemperatureT: sc.upperCriticalFieldZeroTemperature.value,
            temperatureExponent: sc.temperatureExponent,
            source: sc.note,
          }),
        }
      : {}),
    ...(fire !== false ? { ignitionK: fire.ignition.value } : {}),
    ...(fire !== false && fire.heatOfCombustion !== undefined && fire.burningRate !== undefined
      ? {
          combustion: Object.freeze({
            heatOfCombustionJPerKg: fire.heatOfCombustion.value,
            burningRateKgM2S: fire.burningRate.value,
          }),
        }
      : {}),
    sourceSummary: record.sourceSummary,
    notes: record.notes,
  });
}

/** Library materials that are not in the structural catalogue (internal-only). */
export const SUBSTANCE_CATALOG: readonly SubstanceDefinition[] = Object.freeze(
  MATERIAL_LIBRARY.filter((r) => r.category === "superconductor" || r.id === "g10-cr").map(
    substanceOf,
  ),
);

const BY_ID: ReadonlyMap<MaterialId, SubstanceDefinition> = new Map(
  MATERIAL_LIBRARY.map((r) => [r.id, substanceOf(r)] as const),
);
const RECORDS: ReadonlyMap<MaterialId, MaterialRecord> = new Map(
  MATERIAL_LIBRARY.map((r) => [r.id, r] as const),
);
const FLUIDS: ReadonlyMap<string, FluidRecord> = new Map(
  FLUID_LIBRARY.map((f) => [f.id, f] as const),
);

/** Any library material, structural or not. */
export function findSubstance(id: MaterialId): SubstanceDefinition | undefined {
  return BY_ID.get(id);
}

export function getSubstance(id: MaterialId): SubstanceDefinition {
  const substance = BY_ID.get(id);
  if (substance === undefined) throw new Error(`Unknown substance id "${id}".`);
  return substance;
}

/** The full library record, with every value's source and confidence. */
export function findMaterialRecord(id: MaterialId): MaterialRecord | undefined {
  return RECORDS.get(id);
}

export function findFluid(id: string): FluidRecord | undefined {
  return FLUIDS.get(id);
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
