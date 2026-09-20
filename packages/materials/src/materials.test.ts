import { describe, expect, it } from "vitest";
import {
  MATERIAL_CATALOG,
  MaterialIds,
  findMaterial,
  getMaterial,
  listMaterialIds,
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
