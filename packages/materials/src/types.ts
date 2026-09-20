import type {
  KgPerCubicMeter,
  Kelvin,
  OhmMeters,
  Pascals,
  WattsPerMeterKelvin,
} from "@forgelab/shared";

/** Stable identifier for a material. Components store this string, never the properties. */
export type MaterialId = string;

/**
 * A ForgeLab material.
 *
 * Milestone 0 stores a deliberately small set of properties: enough for mass, structural
 * capacity and the thermal/electrical phases already on the roadmap, and nothing that we
 * would have to invent. Every number is sourced in `docs/material-sources.md`.
 *
 * Properties are single scalars at room temperature unless the source note says
 * otherwise. Temperature-dependent property curves are a Phase 2 concern.
 */
export interface MaterialDefinition {
  readonly id: MaterialId;
  readonly name: string;
  readonly densityKgM3: KgPerCubicMeter;
  readonly yieldStrengthPa: Pascals;
  readonly maxOperatingTemperatureK: Kelvin;
  readonly thermalConductivityWmK: WattsPerMeterKelvin;
  readonly electricalResistivityOhmM: OhmMeters;

  /**
   * The specific alloy/grade the numbers above describe. Two different grades of
   * "stainless steel" differ by more than a factor of two in yield strength, so the
   * grade is part of the data, not decoration.
   */
  readonly grade: string;

  /** Short human-readable provenance. Full citations live in `docs/material-sources.md`. */
  readonly sourceSummary: string;

  /** Caveats a user should know before trusting a number (process dependence, etc.). */
  readonly notes: readonly string[];
}
