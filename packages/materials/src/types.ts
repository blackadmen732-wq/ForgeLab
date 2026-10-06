import type {
  JoulesPerKilogram,
  JoulesPerKilogramKelvin,
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

  /** Specific heat capacity near room temperature. Sets how fast a heated part warms. */
  readonly specificHeatJkgK: JoulesPerKilogramKelvin;
  /**
   * Temperature at which melting begins (the solidus for alloys, the melting point for
   * pure metals). Melting is solid -> liquid only; it never produces gas by itself.
   */
  readonly meltingPointK: Kelvin;
  /** Latent heat of fusion: energy absorbed at the melting point to turn solid to liquid. */
  readonly latentHeatOfFusionJkg: JoulesPerKilogram;
  /**
   * Surface emissivity used for radiant exchange (gray body, so also absorptivity).
   * Strongly surface-dependent; the value is the fire-design default for the material.
   */
  readonly emissivity: number;

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
