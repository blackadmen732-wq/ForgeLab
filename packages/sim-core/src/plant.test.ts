import { describe, expect, it } from "vitest";
import { findFluid } from "@forgelab/materials";
import {
  BREMSSTRAHLUNG_COEFFICIENT,
  DT_ALPHA_FRACTION,
  DT_FUSION_ENERGY_J,
  bohmConfinementTimeS,
  darcyFrictionFactor,
  dtFusionPower,
  dtReactivityM3PerS,
  edgeSafetyFactor,
  effectivenessUniformTemperature,
  gaussianSolve,
  getCoolantFluid,
  greenwaldDensityLimitM3,
  ipb98y2ConfinementTimeS,
  magneticPressurePa,
  plasmaTemperatureKeV,
  plasmaThermalEnergyJ,
  pumpCurve,
  resolveParameters,
  seriesPumpOperatingPoint,
  solenoidOnAxisFieldT,
  solveIsland,
  toroidalCoilTensionStressPa,
  toroidalFieldT,
  toroidalPlasmaVolumeM3,
} from "./index.js";

describe("D–T fusion (Bosch–Hale 1992)", () => {
  // Bosch & Hale, Nucl. Fusion 32 (1992) 611, Table VII: <σv> in cm³/s.
  const table: [number, number][] = [
    [1, 6.857e-21],
    [2, 2.977e-19],
    [5, 1.366e-17],
    [10, 1.136e-16],
    [20, 4.33e-16],
    [50, 8.649e-16],
  ];
  for (const [T, cm3] of table) {
    it(`reproduces the published reactivity at ${T} keV to 0.1 %`, () => {
      const m3 = dtReactivityM3PerS(T);
      expect(Math.abs(m3 / (cm3 * 1e-6) - 1)).toBeLessThan(1e-3);
    });
  }

  it("releases 17.59 MeV per reaction, 20 % of it in the alpha", () => {
    expect(DT_FUSION_ENERGY_J / 1.602176634e-13).toBeCloseTo(17.59, 6);
    expect(DT_ALPHA_FRACTION).toBeCloseTo(3.52 / 17.59, 9);
  });

  it("computes P = n_D n_T <σv> V E and splits it into alpha and neutron power", () => {
    const power = dtFusionPower({
      deuteriumDensityM3: 5e19,
      tritiumDensityM3: 5e19,
      temperatureKeV: 10,
      volumeM3: 830,
    });
    const expected = 5e19 * 5e19 * dtReactivityM3PerS(10) * 830 * DT_FUSION_ENERGY_J;
    expect(power.fusionPowerW).toBeCloseTo(expected, 0);
    expect(power.alphaPowerW + power.neutronPowerW).toBeCloseTo(power.fusionPowerW, 0);
    // A uniform (0D) ITER-sized plasma at 10 keV and 1e20 m^-3: 0.25e40 x 1.136e-22 x 830
    // x 2.818e-12 J = 665 MW. (ITER's 500 MW includes profile and dilution effects.)
    expect(power.fusionPowerW).toBeGreaterThan(6.6e8);
    expect(power.fusionPowerW).toBeLessThan(6.7e8);
  });

  it("returns zero reactivity for a cold plasma instead of a fitted artefact", () => {
    expect(dtReactivityM3PerS(0)).toBe(0);
    expect(dtReactivityM3PerS(0.01)).toBe(0);
  });
});

describe("0D plasma relations", () => {
  it("evaluates IPB98(y,2) exactly as published and near 3.7 s at the ITER point", () => {
    const inputs = {
      plasmaCurrentMA: 15,
      toroidalFieldT: 5.3,
      lossPowerMW: 87,
      densityE19: 10.1,
      ionMassAmu: 2.5,
      majorRadiusM: 6.2,
      inverseAspectRatio: 2 / 6.2,
      elongation: 1.7,
    };
    const tau = ipb98y2ConfinementTimeS(inputs);
    const byHand =
      0.0562 *
      15 ** 0.93 *
      5.3 ** 0.15 *
      87 ** -0.69 *
      10.1 ** 0.41 *
      2.5 ** 0.19 *
      6.2 ** 1.97 *
      (2 / 6.2) ** 0.58 *
      1.7 ** 0.78;
    expect(tau).toBeCloseTo(byHand, 12);
    expect(tau).toBeGreaterThan(3.3);
    expect(tau).toBeLessThan(4.2);
  });

  it("uses Bohm's D = T/(16 e B)", () => {
    // T = 1 keV, B = 1 T: D = 1000/16 = 62.5 m^2/s; a = 0.5 m -> tau = 0.25/125 = 2 ms.
    expect(bohmConfinementTimeS(0.5, 1, 1)).toBeCloseTo(0.002, 12);
  });

  it("uses the NRL bremsstrahlung coefficient", () => {
    expect(BREMSSTRAHLUNG_COEFFICIENT).toBeCloseTo(5.344e-37, 39);
  });

  it("inverts plasma energy and temperature consistently", () => {
    const W = plasmaThermalEnergyJ(1e20, 8, 800);
    expect(plasmaTemperatureKeV(W, 1e20, 800)).toBeCloseTo(8, 12);
    // ITER stores ~350 MJ at ~8 keV and 1e20 m^-3 in ~830 m^3.
    expect(W).toBeGreaterThan(2.5e8);
    expect(W).toBeLessThan(4e8);
  });

  it("gives ITER's Greenwald limit and a sensible q95", () => {
    expect(greenwaldDensityLimitM3(15, 2)).toBeCloseTo((15 / (Math.PI * 4)) * 1e20, 0);
    const q = edgeSafetyFactor({
      minorRadiusM: 2,
      majorRadiusM: 6.2,
      fieldT: 5.3,
      plasmaCurrentMA: 15,
      elongation: 1.7,
    });
    expect(q).toBeGreaterThan(2);
    expect(q).toBeLessThan(3.5);
    expect(toroidalPlasmaVolumeM3(6.2, 2, 1.7)).toBeCloseTo(2 * Math.PI ** 2 * 6.2 * 1.7 * 4, 9);
  });
});

describe("magnetics", () => {
  it("gives 5.3 T at ITER's major radius from 164 MA-turns", () => {
    expect(toroidalFieldT(18 * 134, 68000, 6.2)).toBeCloseTo(5.29, 2);
  });

  it("tends to μ0 N I / L at the centre of a long solenoid", () => {
    const B = solenoidOnAxisFieldT({
      turns: 1000,
      currentA: 100,
      lengthM: 100,
      radiusM: 0.5,
      axialOffsetM: 0,
    });
    expect(B).toBeCloseTo((4e-7 * Math.PI * 1000 * 100) / 100, 6);
  });

  it("halves the field at the end of a long solenoid", () => {
    const centre = solenoidOnAxisFieldT({
      turns: 1000,
      currentA: 100,
      lengthM: 100,
      radiusM: 0.5,
      axialOffsetM: 0,
    });
    const end = solenoidOnAxisFieldT({
      turns: 1000,
      currentA: 100,
      lengthM: 100,
      radiusM: 0.5,
      axialOffsetM: 50,
    });
    expect(end / centre).toBeCloseTo(0.5, 3);
  });

  it("computes magnetic pressure B^2 / 2 mu0 and Princeton-D tension", () => {
    expect(magneticPressurePa(10)).toBeCloseTo(100 / (2 * 1.25663706212e-6), 0);
    const stress = toroidalCoilTensionStressPa({
      ampereTurns: 1e8,
      innerLegRadiusM: 2,
      outerLegRadiusM: 10,
      midplaneAreaM2: 50,
    });
    const tension = 1e-7 * 1e16 * Math.log(5);
    expect(stress).toBeCloseTo((2 * tension) / 50, 0);
  });
});

describe("DC network", () => {
  it("solves a linear system by Gaussian elimination", () => {
    const x = gaussianSolve(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBeCloseTo(3, 12);
    expect(x[2]).toBeCloseTo(-1, 12);
  });

  it("delivers demand through a resistive feeder and conserves energy", () => {
    const result = solveIsland(
      [
        {
          id: "grid",
          demandW: 0,
          sourceVoltageV: 1000,
          sourceResistanceOhm: 0.1,
          sourceCapacityW: 1e6,
          sourceKind: "grid",
        },
        { id: "load", demandW: 50e3 },
      ],
      [{ id: "feeder", a: "grid", b: "load", resistanceOhm: 0.5 }],
    );
    expect(result.supplyFraction).toBe(1);
    expect(result.deliveredW).toBeCloseTo(50e3, 6);
    // 50 A through 0.6 ohm in total: 1.5 kW of I^2 R loss.
    expect(result.lossW).toBeCloseTo(50 * 50 * 0.6, 3);
    expect(result.gridImportW).toBeCloseTo(result.deliveredW + result.lossW, 3);
    // Voltage at the load drops by I (R_s + R_feeder).
    // (5 decimals: the 1 nS leakage that keeps floating islands solvable shifts it by ~1e-6 V.)
    expect(result.nodes.get("load")!.voltageV).toBeCloseTo(1000 - 50 * 0.6, 5);
  });

  it("curtails every load proportionally when the sources cannot cover demand", () => {
    const result = solveIsland(
      [
        {
          id: "gen",
          demandW: 0,
          sourceVoltageV: 1000,
          sourceResistanceOhm: 0.001,
          sourceCapacityW: 60e3,
          sourceKind: "generator",
        },
        { id: "a", demandW: 50e3 },
        { id: "b", demandW: 50e3 },
      ],
      [
        { id: "ea", a: "gen", b: "a", resistanceOhm: 0.001 },
        { id: "eb", a: "gen", b: "b", resistanceOhm: 0.001 },
      ],
    );
    expect(result.supplyFraction).toBeLessThan(0.6);
    expect(result.supplyFraction).toBeGreaterThan(0.59);
    expect(result.nodes.get("a")!.deliveredW).toBeCloseTo(result.nodes.get("b")!.deliveredW, 9);
    expect(result.deliveredW + result.lossW).toBeLessThanOrEqual(60e3 + 1e-6);
    expect(result.generationW).toBeCloseTo(result.deliveredW + result.lossW, 3);
  });

  it("delivers nothing on an island with no source", () => {
    const result = solveIsland([{ id: "load", demandW: 1000 }], []);
    expect(result.supplyFraction).toBe(0);
    expect(result.deliveredW).toBe(0);
  });
});

describe("hydraulics and heat transfer", () => {
  it("uses 64/Re in laminar flow and Swamee–Jain in turbulent flow", () => {
    expect(darcyFrictionFactor(1000, 4.5e-5, 0.1)).toBeCloseTo(0.064, 12);
    // Smooth pipe at Re = 1e5: Colebrook gives 0.01799.
    expect(darcyFrictionFactor(1e5, 0, 0.1)).toBeCloseTo(0.018, 3);
  });

  it("passes the pump curve through its rated point and meets the system curve", () => {
    const fluid = getCoolantFluid("pressurized-water");
    const curve = pumpCurve({ ratedHeadM: 100, ratedMassFlowKgS: 1000, speedFraction: 1, fluid });
    const rise = (m: number) => curve.shutoffPressurePa * (1 - (m / curve.runoutMassFlowKgS) ** 2);
    expect(rise(1000)).toBeCloseTo(fluid.densityKgM3 * 9.80665 * 100, 3);
    const r = 0.5;
    const m = seriesPumpOperatingPoint([curve], r);
    expect(rise(m)).toBeCloseTo(r * m * m, 3);
  });

  it("follows the pump affinity laws at reduced speed", () => {
    const fluid = getCoolantFluid("pressurized-water");
    const full = pumpCurve({ ratedHeadM: 100, ratedMassFlowKgS: 1000, speedFraction: 1, fluid });
    const half = pumpCurve({ ratedHeadM: 100, ratedMassFlowKgS: 1000, speedFraction: 0.5, fluid });
    expect(half.shutoffPressurePa / full.shutoffPressurePa).toBeCloseTo(0.25, 12);
    expect(half.runoutMassFlowKgS / full.runoutMassFlowKgS).toBeCloseTo(0.5, 12);
  });

  it("uses exactly the library's coolant states", () => {
    const pairs = [
      ["pressurized-water", "water", "PWR primary"],
      ["helium", "helium", "DEMO blanket"],
    ] as const;
    for (const [coolantId, fluidId, label] of pairs) {
      const coolant = getCoolantFluid(coolantId);
      const state = findFluid(fluidId)!.states.find((st) => st.label.includes(label))!;
      expect(coolant.densityKgM3).toBe(state.density!.value);
      expect(coolant.specificHeatJkgK).toBe(state.specificHeat!.value);
      expect(coolant.dynamicViscosityPaS).toBe(state.viscosity!.value);
    }
  });

  it("gives effectiveness 1 - exp(-NTU)", () => {
    expect(effectivenessUniformTemperature(2e6, 1e6)).toBeCloseTo(1 - Math.exp(-2), 12);
    expect(effectivenessUniformTemperature(0, 1e6)).toBe(0);
  });
});

describe("role parameters", () => {
  it("fills defaults, clamps ranges and rejects wrong types", () => {
    const p = resolveParameters("plasma-heater", {
      heatingPowerW: 1e12,
      wallPlugEfficiency: "high",
      bogus: 3,
    });
    expect(p["heatingPowerW"]).toBe(500e6);
    expect(p["wallPlugEfficiency"]).toBe(0.35);
    expect(p["enabled"]).toBe(true);
    expect("bogus" in p).toBe(false);
  });
});
