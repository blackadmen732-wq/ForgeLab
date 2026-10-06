import { celsiusToKelvin, kilojoulesToJoules, megapascalsToPascals } from "@forgelab/shared";
import type { MaterialDefinition, MaterialId } from "./types.js";

/**
 * ForgeLab's Milestone 0 material catalogue.
 *
 * READ `docs/material-sources.md` BEFORE CHANGING ANY NUMBER HERE.
 *
 * Every value is a nominal handbook or supplier-datasheet figure for the named grade.
 * None of them are tuned for gameplay. If a value is process-dependent or scale-limited,
 * that is recorded in `notes` rather than smoothed away.
 *
 * `maxOperatingTemperatureK` is defined consistently across the catalogue as the
 * *maximum continuous service temperature at which the grade retains its listed
 * room-temperature structural properties*. It is not a melting point and not a
 * creep-rupture limit. Milestone 0 does not simulate temperature at all; the field
 * exists so Phase 2 has somewhere honest to read from.
 */

const STRUCTURAL_STEEL: MaterialDefinition = {
  id: "structural-steel",
  name: "Structural Steel",
  grade: "ASTM A36 hot-rolled carbon steel",
  densityKgM3: 7850,
  yieldStrengthPa: megapascalsToPascals(250),
  maxOperatingTemperatureK: celsiusToKelvin(400),
  thermalConductivityWmK: 45.0,
  electricalResistivityOhmM: 1.6e-7,
  sourceSummary: "ASTM A36/A36M specified minimum yield; handbook values for the rest.",
  specificHeatJkgK: 440,
  meltingPointK: celsiusToKelvin(1425),
  latentHeatOfFusionJkg: kilojoulesToJoules(247),
  emissivity: 0.7,
  notes: [
    "250 MPa is the ASTM A36 specified *minimum* yield strength for thicknesses up to 200 mm; real stock typically tests higher.",
    "400 degC is the temperature up to which EN 1993-1-2 applies no reduction to effective yield strength; above it carbon steel loses strength rapidly.",
    "Electrical resistivity for low-carbon steels spans roughly 1.4e-7 to 1.8e-7 ohm-m depending on carbon and alloy content.",
    "Specific heat 440 J/(kg*K) is the EN 1993-1-2 3.4.1.2 carbon-steel formula evaluated at 20 degC; it rises steeply with temperature (and spikes near 735 degC), which ForgeLab does not yet model.",
    "Melting begins near 1425 degC (the low end of the range quoted for A36). Latent heat is the pure-iron value (13.81 kJ/mol); emissivity 0.7 is the EN 1993-1-2 value for carbon steel.",
  ],
};

const STAINLESS_STEEL: MaterialDefinition = {
  id: "stainless-steel",
  name: "Stainless Steel",
  grade: "AISI 316L austenitic stainless, annealed",
  densityKgM3: 8000,
  yieldStrengthPa: megapascalsToPascals(170),
  maxOperatingTemperatureK: celsiusToKelvin(870),
  thermalConductivityWmK: 16.3,
  electricalResistivityOhmM: 7.4e-7,
  sourceSummary: "ASTM A240 specified minimum 0.2% proof stress; supplier datasheet physicals.",
  specificHeatJkgK: 500,
  meltingPointK: celsiusToKelvin(1375),
  latentHeatOfFusionJkg: kilojoulesToJoules(247),
  emissivity: 0.4,
  notes: [
    "170 MPa is the ASTM A240 minimum 0.2% proof stress for annealed 316L. Non-low-carbon 316 is specified at 205 MPa - do not substitute one for the other.",
    "870 degC is the intermittent-service scaling limit in air; continuous service in air is usually quoted as 925 degC. The lower figure is used here because thermal cycling is the harsher case.",
    "Pressure-retaining design codes allow far lower temperatures than the scaling limit because of creep. ForgeLab does not model creep.",
    "Thermal conductivity is quoted at 100 degC; at 20 degC it is nearer 14.6 W/(m*K).",
    "Specific heat 500 J/(kg*K) is the 0-100 degC datasheet value. Melting range 1375-1400 degC; the solidus is used. Latent heat is approximated by the pure-iron value.",
    "Emissivity 0.4 is the EN 1993-1-2 Annex C value for stainless steel members.",
  ],
};

const TUNGSTEN: MaterialDefinition = {
  id: "tungsten",
  name: "Tungsten",
  grade: "Pure sintered tungsten (>= 99.95%), stress-relieved",
  densityKgM3: 19250,
  yieldStrengthPa: megapascalsToPascals(550),
  maxOperatingTemperatureK: celsiusToKelvin(1300),
  thermalConductivityWmK: 173,
  electricalResistivityOhmM: 5.6e-8,
  sourceSummary: "CRC Handbook physicals; supplier datasheet mechanicals for sintered rod.",
  specificHeatJkgK: 132,
  meltingPointK: celsiusToKelvin(3422),
  latentHeatOfFusionJkg: kilojoulesToJoules(284.5),
  emissivity: 0.8,
  notes: [
    "Tungsten yield strength is extremely process-dependent: 550 MPa is a conservative figure for sintered stress-relieved stock, while heavily worked wire and rod are quoted from 750 MPa to well over 1500 MPa.",
    "1300 degC is the approximate recrystallization onset for pure tungsten, above which it embrittles. It is NOT the melting point (3422 degC).",
    "In air, oxidation limits tungsten to a few hundred degC. The figure above assumes vacuum or inert atmosphere, which ForgeLab does not model yet.",
    "Specific heat 132 J/(kg*K), melting point 3422 degC and latent heat 52.31 kJ/mol (284.5 kJ/kg) are CRC Handbook values. Older tables quote a far lower latent heat (35 kJ/mol).",
    "Emissivity 0.8 is the EN 1991-1-2 default for surfaces without a material-specific value. Clean tungsten is far lower (0.03-0.35).",
  ],
};

const COPPER: MaterialDefinition = {
  id: "copper",
  name: "Copper",
  grade: "C11000 electrolytic tough pitch, annealed (O60)",
  densityKgM3: 8960,
  yieldStrengthPa: megapascalsToPascals(69),
  maxOperatingTemperatureK: celsiusToKelvin(200),
  thermalConductivityWmK: 401,
  electricalResistivityOhmM: 1.678e-8,
  sourceSummary:
    "CRC Handbook physicals for pure Cu at 20 degC; datasheet mechanicals for C11000-O60.",
  specificHeatJkgK: 385,
  meltingPointK: celsiusToKelvin(1084.62),
  latentHeatOfFusionJkg: kilojoulesToJoules(208.7),
  emissivity: 0.8,
  notes: [
    "69 MPa is annealed temper. Cold-worked C11000 (H04) reaches roughly 310 MPa - temper matters more than grade for copper.",
    "200 degC is a softening/annealing service limit for cold-worked copper, not a melting or oxidation limit.",
    "1.678e-8 ohm-m corresponds to about 103% IACS; the IACS reference standard itself is 1.7241e-8 ohm-m.",
    "Specific heat 385 J/(kg*K), melting point 1084.62 degC and latent heat 13.26 kJ/mol (208.7 kJ/kg) are CRC Handbook values for pure copper.",
    "Emissivity 0.8 is the EN 1991-1-2 default; oxidized copper is close (~0.78), polished copper is near 0.03.",
  ],
};

const ALUMINUM: MaterialDefinition = {
  id: "aluminum",
  name: "Aluminum",
  grade: "6061-T6 aluminium alloy",
  densityKgM3: 2700,
  yieldStrengthPa: megapascalsToPascals(276),
  maxOperatingTemperatureK: celsiusToKelvin(200),
  thermalConductivityWmK: 167,
  electricalResistivityOhmM: 3.99e-8,
  sourceSummary: "ASM/supplier datasheet values for 6061-T6.",
  specificHeatJkgK: 896,
  meltingPointK: celsiusToKelvin(582),
  latentHeatOfFusionJkg: kilojoulesToJoules(397),
  emissivity: 0.3,
  notes: [
    "276 MPa (40 ksi) is the typical 6061-T6 0.2% proof stress. The T4 temper of the same alloy is around 145 MPa.",
    "200 degC is an over-ageing limit: held above it, T6 temper degrades permanently and does not recover on cooling.",
    "Specific heat 896 J/(kg*K) is the 6061 datasheet value. Melting range 582-652 degC; the solidus is used. Latent heat is the pure-aluminium value (10.71 kJ/mol).",
    "Emissivity 0.3 is the EN 1999-1-2 value for clean aluminium surfaces; painted or covered surfaces are 0.7.",
  ],
};

/** Catalogue in a fixed, deterministic order. Never rely on object key order elsewhere. */
export const MATERIAL_CATALOG: readonly MaterialDefinition[] = Object.freeze([
  STRUCTURAL_STEEL,
  STAINLESS_STEEL,
  TUNGSTEN,
  COPPER,
  ALUMINUM,
]);

/**
 * Well-known material ids.
 *
 * Components reference these strings. They never embed density or strength directly,
 * so changing a catalogue value updates every component that uses it.
 */
export const MaterialIds = Object.freeze({
  StructuralSteel: "structural-steel",
  StainlessSteel: "stainless-steel",
  Tungsten: "tungsten",
  Copper: "copper",
  Aluminum: "aluminum",
} as const);

export type KnownMaterialId = (typeof MaterialIds)[keyof typeof MaterialIds];

const BY_ID: ReadonlyMap<MaterialId, MaterialDefinition> = new Map(
  MATERIAL_CATALOG.map((material) => [material.id, material]),
);

/** Returns the material, or `undefined` when the id is not in the catalogue. */
export function findMaterial(id: MaterialId): MaterialDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * Returns the material or throws.
 *
 * The simulation uses this form: an unknown material id is a data error that must not be
 * silently substituted with a default, because that would silently change every mass and
 * every stress result downstream.
 */
export function getMaterial(id: MaterialId): MaterialDefinition {
  const material = BY_ID.get(id);
  if (material === undefined) {
    const known = MATERIAL_CATALOG.map((m) => m.id).join(", ");
    throw new Error(`Unknown material id "${id}". Known materials: ${known}.`);
  }
  return material;
}

export function listMaterialIds(): readonly MaterialId[] {
  return MATERIAL_CATALOG.map((material) => material.id);
}
