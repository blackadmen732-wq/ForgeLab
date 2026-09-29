import { describe, expect, it } from "vitest";
import {
  MATERIAL_CATALOG,
  MaterialIds,
  SUBSTANCE_CATALOG,
  criticalTemperatureK,
  findMaterial,
  findSubstance,
  getMaterial,
  getSubstance,
  listMaterialIds,
  upperCriticalFieldT,
} from "./index.js";

describe("material catalogue", () => {
  it("contains the five Milestone 0 materials", () => {
    expect(listMaterialIds()).toEqual([
      "structural-steel",
      "stainless-steel",
      "tungsten",
      "copper",
      "aluminum",
    ]);
  });

  it("exposes every material through the well-known id map", () => {
    for (const id of Object.values(MaterialIds)) {
      expect(findMaterial(id)).toBeDefined();
    }
  });

  it("throws on an unknown material rather than substituting a default", () => {
    expect(() => getMaterial("unobtainium")).toThrowError(/Unknown material id/);
  });

  it("stores every property in SI units with physically plausible magnitudes", () => {
    for (const material of MATERIAL_CATALOG) {
      // Densities of engineering metals: lithium ~530, osmium ~22590 kg/m^3.
      expect(material.densityKgM3).toBeGreaterThan(500);
      expect(material.densityKgM3).toBeLessThan(23000);
      // Yield strengths in pascals, not megapascals: 10 MPa .. 5 GPa.
      expect(material.yieldStrengthPa).toBeGreaterThan(1e7);
      expect(material.yieldStrengthPa).toBeLessThan(5e9);
      // Absolute temperature, above room temperature and below any metal's boiling point.
      expect(material.maxOperatingTemperatureK).toBeGreaterThan(300);
      expect(material.maxOperatingTemperatureK).toBeLessThan(6000);
      // Metals span ~8 (stainless) to ~430 (silver) W/(m*K).
      expect(material.thermalConductivityWmK).toBeGreaterThan(5);
      expect(material.thermalConductivityWmK).toBeLessThan(500);
      // Young's modulus of engineering metals: magnesium ~45 GPa .. tungsten ~411 GPa.
      expect(material.youngsModulusPa).toBeGreaterThan(40e9);
      expect(material.youngsModulusPa).toBeLessThan(450e9);
      // Specific heat of metals near room temperature: ~120 (heavy) .. ~1000 (light) J/(kg K).
      expect(material.specificHeatJkgK).toBeGreaterThan(100);
      expect(material.specificHeatJkgK).toBeLessThan(1100);
      // Metallic resistivity in ohm-metres is on the order of 1e-8 .. 1e-6.
      expect(material.electricalResistivityOhmM).toBeGreaterThan(1e-9);
      expect(material.electricalResistivityOhmM).toBeLessThan(1e-5);
    }
  });

  it("documents provenance and a grade for every material", () => {
    for (const material of MATERIAL_CATALOG) {
      expect(material.grade.length).toBeGreaterThan(0);
      expect(material.sourceSummary.length).toBeGreaterThan(0);
      expect(material.notes.length).toBeGreaterThan(0);
    }
  });

  it("keeps copper the best conductor and tungsten the densest", () => {
    const byId = new Map(MATERIAL_CATALOG.map((m) => [m.id, m]));
    const copper = byId.get(MaterialIds.Copper)!;
    const tungsten = byId.get(MaterialIds.Tungsten)!;
    for (const material of MATERIAL_CATALOG) {
      expect(material.thermalConductivityWmK).toBeLessThanOrEqual(copper.thermalConductivityWmK);
      expect(material.electricalResistivityOhmM).toBeGreaterThanOrEqual(
        copper.electricalResistivityOhmM,
      );
      expect(material.densityKgM3).toBeLessThanOrEqual(tungsten.densityKgM3);
    }
  });
});

describe("internal substances", () => {
  it("resolves structural materials and internal-only substances through one lookup", () => {
    expect(getSubstance("copper").densityKgM3).toBe(getMaterial("copper").densityKgM3);
    expect(getSubstance("nbti").superconductor).toBeDefined();
    expect(findSubstance("nbti")?.densityKgM3).toBeCloseTo(6020, 0);
    expect(() => getSubstance("unobtainium")).toThrowError(/Unknown substance/);
  });

  it("keeps internal-only substances out of the structural catalogue", () => {
    expect(findMaterial("nbti")).toBeUndefined();
    expect(findMaterial("g10-cr")).toBeUndefined();
  });

  it("follows the NbTi critical surface (Bottura 2000: Tc0 9.2 K, Bc20 14.5 T, n 1.7)", () => {
    const sc = getSubstance("nbti").superconductor!;
    expect(criticalTemperatureK(sc, 0)).toBeCloseTo(9.2, 6);
    expect(criticalTemperatureK(sc, 14.5)).toBe(0);
    expect(upperCriticalFieldT(sc, 0)).toBeCloseTo(14.5, 6);
    expect(upperCriticalFieldT(sc, 9.2)).toBe(0);
    // The two relations are inverses of each other.
    for (const b of [1, 5, 9, 12]) {
      expect(upperCriticalFieldT(sc, criticalTemperatureK(sc, b))).toBeCloseTo(b, 6);
    }
    // At 4.5 K the conductor carries at most ~10.7 T (well-known NbTi operating range).
    expect(upperCriticalFieldT(sc, 4.5)).toBeGreaterThan(10);
    expect(upperCriticalFieldT(sc, 4.5)).toBeLessThan(11.5);
  });

  it("records no property it has no source for", () => {
    const nbti = getSubstance("nbti");
    expect(nbti.specificHeatJkgK).toBeUndefined();
    expect(nbti.thermalConductivityWmK).toBeUndefined();
    for (const s of SUBSTANCE_CATALOG) {
      expect(s.sourceSummary.length).toBeGreaterThan(20);
    }
  });
});
