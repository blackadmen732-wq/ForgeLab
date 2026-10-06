import { describe, expect, it } from "vitest";
import { getMaterial } from "@forgelab/materials";
import { celsiusToKelvin } from "@forgelab/shared";
import {
  copperCryogenicEnthalpyJkg,
  copperCryogenicSpecificHeatJkgK,
  copperCryogenicTemperatureFromEnthalpyK,
  waterSaturationPressurePa,
  waterSaturationTemperatureK,
  yieldStrengthFactorAt,
} from "./data.js";
import { plumeExcessK } from "./solver.js";

describe("cascade reference data", () => {
  it("reproduces the IAPWS-IF97 saturation-pressure verification values", () => {
    // IAPWS-IF97 Table 35: 300 K -> 0.353658941e-2 MPa, 500 K -> 0.263889776e1 MPa.
    expect(waterSaturationPressurePa(300)).toBeCloseTo(3536.58941, 2);
    expect(waterSaturationPressurePa(500)).toBeCloseTo(2_638_897.76, -1);
    expect(waterSaturationPressurePa(373.15)).toBeCloseTo(101_418, -1);
    expect(waterSaturationTemperatureK(101_325)).toBeCloseTo(373.12, 1);
  });

  it("follows EN 1993-1-2 Table 3.1 for hot carbon steel", () => {
    const steel = getMaterial("structural-steel");
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(20))).toBe(1);
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(400))).toBe(1);
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(500))).toBeCloseTo(0.78, 10);
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(600))).toBeCloseTo(0.47, 10);
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(650))).toBeCloseTo(0.35, 10);
    expect(yieldStrengthFactorAt(steel, celsiusToKelvin(1200))).toBe(0);
  });

  it("weakens other metals between their service limit and melting", () => {
    const copper = getMaterial("copper");
    expect(yieldStrengthFactorAt(copper, copper.maxOperatingTemperatureK)).toBe(1);
    expect(yieldStrengthFactorAt(copper, copper.meltingPointK)).toBe(0);
  });

  it("uses a cryogenic copper heat capacity that matches NIST near 10 K and integrates it exactly", () => {
    expect(copperCryogenicSpecificHeatJkgK(10)).toBeCloseTo(0.86, 1);
    for (const t of [4.2, 6.5, 20, 79, 150, 300]) {
      expect(copperCryogenicTemperatureFromEnthalpyK(copperCryogenicEnthalpyJkg(t))).toBeCloseTo(
        t,
        6,
      );
    }
    // 1 kJ/kg into 4 K copper is a large rise but nowhere near melting.
    const t = copperCryogenicTemperatureFromEnthalpyK(copperCryogenicEnthalpyJkg(4.2) + 1000);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(60);
  });

  it("computes Heskestad plume temperatures and caps them at the continuous flame", () => {
    // ΔT = 25 · 100^(2/3) · 3^(-5/3) for a 100 kW convective plume at 3 m.
    expect(plumeExcessK(100_000, 3)).toBeCloseTo(25 * 100 ** (2 / 3) * 3 ** (-5 / 3), 8);
    expect(plumeExcessK(5_000_000, 0.5)).toBe(800);
    expect(plumeExcessK(0, 2)).toBe(0);
  });
});
