import { describe, expect, it } from "vitest";
import {
  FLUID_LIBRARY,
  MATERIAL_CATALOG,
  MATERIAL_LIBRARY,
  SOURCES,
  curveValue,
  findFluid,
  findMaterialRecord,
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
  it("keeps the five Milestone 0 materials first, then the placeable library grades", () => {
    expect(listMaterialIds()).toEqual([
      "structural-steel",
      "stainless-steel",
      "tungsten",
      "copper",
      "aluminum",
      "stainless-304l",
      "hsla-steel",
      "aluminum-7075",
      "titanium-6al4v",
      "copper-ofhc",
      "molybdenum",
      "concrete-c30",
    ]);
  });

  it("keeps the Milestone 0 values exactly (simulation results must not move)", () => {
    const pick = (id: string) => {
      const m = getMaterial(id);
      return [
        m.densityKgM3,
        m.yieldStrengthPa,
        m.youngsModulusPa,
        m.specificHeatJkgK,
        m.maxOperatingTemperatureK,
        m.thermalConductivityWmK,
        m.electricalResistivityOhmM,
      ];
    };
    expect(pick("structural-steel")).toEqual([7850, 250e6, 200e9, 486, 673.15, 45, 1.6e-7]);
    expect(pick("stainless-steel")).toEqual([8000, 170e6, 193e9, 500, 1143.15, 16.3, 7.4e-7]);
    expect(pick("tungsten")).toEqual([19250, 550e6, 411e9, 132, 1573.15, 173, 5.6e-8]);
    expect(pick("copper")).toEqual([8960, 69e6, 117e9, 385, 473.15, 401, 1.678e-8]);
    expect(pick("aluminum")).toEqual([2700, 276e6, 68.9e9, 896, 473.15, 167, 3.99e-8]);
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
    for (const material of MATERIAL_CATALOG.filter(
      (m) => findMaterialRecord(m.id)?.category !== "civil",
    )) {
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
    // Reference-only library materials lack a sourced value the solvers need.
    expect(findMaterial("eurofer97")).toBeUndefined();
    expect(findMaterial("graphite-ig110")).toBeUndefined();
    expect(findMaterialRecord("eurofer97")?.thermal?.conductivity).toBeUndefined();
  });

  it("uses Godeke's unstrained Nb3Sn surface: about 12 K at 12 T", () => {
    const sc = getSubstance("nb3sn").superconductor!;
    expect(criticalTemperatureK(sc, 0)).toBe(18);
    expect(criticalTemperatureK(sc, 12)).toBeGreaterThan(11);
    expect(criticalTemperatureK(sc, 12)).toBeLessThan(13);
  });

  it("gives REBCO and MgB2 a Tc0 but no critical surface", () => {
    expect(findMaterialRecord("rebco")?.superconducting?.criticalTemperatureZeroField.value).toBe(
      92,
    );
    expect(getSubstance("rebco").superconductor).toBeUndefined();
    expect(getSubstance("mgb2").superconductor).toBeUndefined();
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

describe("material library", () => {
  const quantities = (value: unknown, path: string, out: [string, Record<string, unknown>][]) => {
    if (value === null || typeof value !== "object") return out;
    const o = value as Record<string, unknown>;
    if (typeof o["value"] === "number" && typeof o["unit"] === "string") {
      out.push([path, o]);
      return out;
    }
    for (const [k, v] of Object.entries(o)) quantities(v, `${path}.${k}`, out);
    return out;
  };

  it("holds a first-generation library of sourced materials and fluids", () => {
    expect(MATERIAL_LIBRARY.length).toBeGreaterThanOrEqual(24);
    expect(FLUID_LIBRARY.length).toBeGreaterThanOrEqual(6);
    const ids = [...MATERIAL_LIBRARY, ...FLUID_LIBRARY].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every number a known source, a unit and a confidence", () => {
    for (const record of [...MATERIAL_LIBRARY, ...FLUID_LIBRARY]) {
      const found = quantities(record, record.id, []);
      expect(found.length, record.id).toBeGreaterThan(0);
      for (const [path, q] of found) {
        expect(SOURCES.has(q["source"] as string), `${path} source`).toBe(true);
        expect(["specified", "handbook", "typical", "approximate"], path).toContain(
          q["confidence"],
        );
        expect(Number.isFinite(q["value"] as number), `${path} value`).toBe(true);
        const range = q["range"] as [number, number] | undefined;
        if (range !== undefined) expect(range[0], `${path} range`).toBeLessThanOrEqual(range[1]);
      }
      expect(record.sourceSummary.length).toBeGreaterThan(10);
    }
  });

  it("tabulates curves in ascending temperature with known sources", () => {
    for (const record of MATERIAL_LIBRARY) {
      for (const curve of [
        record.mechanical?.yieldReduction,
        record.mechanical?.modulusReduction,
        record.electrical?.resistivityCurve,
      ]) {
        if (curve === undefined) continue;
        expect(SOURCES.has(curve.source)).toBe(true);
        for (let i = 1; i < curve.points.length; i += 1)
          expect(curve.points[i]![0]).toBeGreaterThan(curve.points[i - 1]![0]);
      }
    }
  });

  it("interpolates curves and never extrapolates", () => {
    const steel = findMaterialRecord("structural-steel")!.mechanical!.yieldReduction!;
    expect(curveValue(steel, 293.15)).toBe(1);
    expect(curveValue(steel, 673.15)).toBe(1);
    expect(curveValue(steel, 773.15)).toBeCloseTo(0.78, 9);
    expect(curveValue(steel, 823.15)).toBeCloseTo((0.78 + 0.47) / 2, 9);
    expect(curveValue(steel, 5000)).toBe(0);
    const cu = findMaterialRecord("copper")!.electrical!.resistivityCurve!;
    expect(curveValue(cu, 293)).toBeCloseTo(1.678e-8, 12);
    expect(curveValue(cu, 400)).toBeCloseTo(2.402e-8, 12);
    // Below the table the purity-dependent value is not invented: held at 100 K.
    expect(curveValue(cu, 4)).toBeCloseTo(0.348e-8, 12);
  });

  it("marks no metal combustible, and every combustible with a sourced ignition", () => {
    for (const record of MATERIAL_LIBRARY) {
      const c = record.presentation.combustible;
      if (record.category === "structural-metal" || record.category === "conductor")
        expect(c, record.id).toBe(false);
      if (c !== false) expect(SOURCES.has(c.ignition.source)).toBe(true);
      if (c !== false && c.heatOfCombustion !== undefined)
        expect(SOURCES.has(c.heatOfCombustion.source)).toBe(true);
      if (c !== false && c.burningRate !== undefined)
        expect(SOURCES.has(c.burningRate.source)).toBe(true);
    }
  });

  it("burns only what has sourced burning data, and leaves the rest unburned", () => {
    const xlpe = getSubstance("xlpe");
    expect(xlpe.ignitionK).toBeCloseTo(623.15, 6);
    expect(xlpe.combustion!.heatOfCombustionJPerKg).toBe(43.3e6);
    expect(xlpe.combustion!.burningRateKgM2S).toBe(0.026);
    // Graphite and epoxy laminate ignite, but their burning is not sourced: no placeholder.
    expect(getSubstance("graphite-ig110").ignitionK).toBeGreaterThan(0);
    expect(getSubstance("graphite-ig110").combustion).toBeUndefined();
    expect(getSubstance("copper").ignitionK).toBeUndefined();
  });

  it("derives the fluid values it states", () => {
    const helium = findFluid("helium")!;
    expect(helium.latentHeatOfVaporization!.value).toBeCloseTo((82.9 / 4.0026) * 1000, -2);
    const tritium = findFluid("tritium")!.radioactive!;
    // ≈ 3.6e14 Bq per gram, ≈ 0.32 W per gram.
    expect(tritium.specificActivity.value / 1000).toBeGreaterThan(3.5e14);
    expect(tritium.specificActivity.value / 1000).toBeLessThan(3.7e14);
    expect(tritium.decayHeat.value / 1000).toBeGreaterThan(0.3);
    expect(tritium.decayHeat.value / 1000).toBeLessThan(0.34);
    const pbli = findFluid("lithium-lead")!.states[0]!.density!.value;
    expect(pbli).toBeCloseTo(10520.35 - 1.19051 * 773.15, 6);
  });

  it("builds plain concrete from its tensile strength, with no yield point invented", () => {
    const concrete = getMaterial("concrete-c30");
    expect(findMaterialRecord("concrete-c30")?.mechanical?.yieldStrength).toBeUndefined();
    expect(concrete.yieldStrengthPa).toBe(2.9e6); // EN 1992-1-1 fctm, C30/37
    expect(concrete.densityKgM3).toBe(2400);
    expect(concrete.maxOperatingTemperatureK).toBeCloseTo(373.15, 6);
    expect(concrete.thermalConductivityWmK).toBe(1.36);
  });
});
