import { MATERIAL_LIBRARY } from "./library.js";
import type { MaterialRecord } from "./schema.js";
import type { MaterialDefinition, MaterialId } from "./types.js";

/**
 * The structural catalogue: library materials with every property the solvers need
 * (density, yield, stiffness, heat capacity, conductivity, resistivity and a service
 * limit). Only these can be assigned to a placed part. A library material that lacks any
 * of them is reference data, and stays so until the missing value is sourced — nothing
 * is filled in to make it placeable.
 *
 * READ docs/material-sources.md BEFORE CHANGING ANY NUMBER (they live in library.ts).
 *
 * `maxOperatingTemperatureK` is the *maximum continuous service temperature at which the
 * grade retains its listed room-temperature structural properties*. It is not a melting
 * point and not a creep-rupture limit.
 */
export function structuralDefinition(record: MaterialRecord): MaterialDefinition | null {
  const m = record.mechanical;
  const t = record.thermal;
  const e = record.electrical;
  // Brittle materials have no yield point: their tensile strength is the limit.
  const strength = m?.yieldStrength ?? m?.tensileStrength;
  if (
    strength === undefined ||
    m?.youngsModulus === undefined ||
    t?.specificHeat === undefined ||
    t.conductivity === undefined ||
    t.maxService === undefined ||
    e?.resistivity === undefined
  )
    return null;
  return Object.freeze({
    id: record.id,
    name: record.name,
    grade: record.grade,
    densityKgM3: record.density.value,
    yieldStrengthPa: strength.value,
    youngsModulusPa: m.youngsModulus.value,
    specificHeatJkgK: t.specificHeat.value,
    maxOperatingTemperatureK: t.maxService.value,
    thermalConductivityWmK: t.conductivity.value,
    electricalResistivityOhmM: e.resistivity.value,
    sourceSummary: record.sourceSummary,
    notes: record.notes,
  });
}

/** Catalogue in a fixed, deterministic order. Never rely on object key order elsewhere. */
export const MATERIAL_CATALOG: readonly MaterialDefinition[] = Object.freeze(
  MATERIAL_LIBRARY.map(structuralDefinition).filter((m): m is MaterialDefinition => m !== null),
);

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
  Stainless304L: "stainless-304l",
  HighStrengthSteel: "hsla-steel",
  Aluminum7075: "aluminum-7075",
  Titanium: "titanium-6al4v",
  CopperOFHC: "copper-ofhc",
  Molybdenum: "molybdenum",
  Concrete: "concrete-c30",
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
