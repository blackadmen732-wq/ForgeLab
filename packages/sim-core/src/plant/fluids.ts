import { STANDARD_GRAVITY_MPS2 } from "@forgelab/shared";

/**
 * Coolant fluids and incompressible pipe hydraulics for V0.1.
 *
 * Properties are single nominal values at one operating state per fluid. They do not vary
 * with temperature or pressure in V0.1; the operating state each value describes is part
 * of the data.
 */
export interface CoolantFluid {
  readonly id: CoolantFluidId;
  readonly name: string;
  readonly state: string;
  readonly densityKgM3: number;
  readonly specificHeatJkgK: number;
  readonly dynamicViscosityPaS: number;
  /**
   * Highest bulk temperature ForgeLab allows before raising a coolant failure.
   * For pressurised water this is below saturation at the stated pressure; for helium it is
   * a structural-materials limit rather than a fluid one.
   */
  readonly maxTemperatureK: number;
  /**
   * Pressure the loop is held at in normal operation (the operating state above). The
   * loop is at this pressure from the start of a run: a pressurised-water primary is
   * pressurised before its pumps start.
   */
  readonly systemPressurePa: number;
  /**
   * How the loop pressure responds when the coolant overheats:
   *  - saturating-water: water hotter than saturation at the system pressure boils, and
   *    the closed loop's pressure follows the saturation curve (IAPWS-IF97);
   *  - ideal-gas: a closed, rigid loop of gas: p ∝ T from the operating state.
   */
  readonly pressureModel: "saturating-water" | "ideal-gas";
  /** Temperature of the operating state, K (the ideal-gas reference). */
  readonly referenceTemperatureK: number;
  readonly source: string;
}

export type CoolantFluidId = "pressurized-water" | "helium";

export const COOLANT_FLUIDS: Readonly<Record<CoolantFluidId, CoolantFluid>> = Object.freeze({
  "pressurized-water": Object.freeze({
    id: "pressurized-water",
    name: "Pressurised water",
    state: "15.5 MPa, 300 °C (PWR primary conditions)",
    densityKgM3: 725.5,
    specificHeatJkgK: 5475,
    dynamicViscosityPaS: 9.0e-5,
    // Saturation at 15.5 MPa is 344.8 °C (617.9 K). ForgeLab raises a boiling failure
    // 10 K below it, a margin representing the subcooling a PWR keeps.
    maxTemperatureK: 607.9,
    systemPressurePa: 15.5e6,
    pressureModel: "saturating-water",
    referenceTemperatureK: 573.15,
    source: "IAPWS-IF97 properties of water at 15.5 MPa and 300 °C (rounded).",
  }),
  helium: Object.freeze({
    id: "helium",
    name: "Helium",
    state: "8 MPa, 400 °C (DEMO helium-cooled blanket conditions)",
    // Ideal gas: ρ = pM / RT = 8e6 × 0.0040026 / (8.314 × 673.15)
    densityKgM3: 5.72,
    specificHeatJkgK: 5193,
    dynamicViscosityPaS: 3.5e-5,
    maxTemperatureK: 1073.15,
    systemPressurePa: 8e6,
    pressureModel: "ideal-gas",
    referenceTemperatureK: 673.15,
    source:
      "Ideal-gas density at 8 MPa, 673 K; cp of a monatomic gas (5/2 R/M); viscosity from NIST tables near 673 K.",
  }),
});

export function getCoolantFluid(id: string): CoolantFluid {
  return COOLANT_FLUIDS[(id in COOLANT_FLUIDS ? id : "pressurized-water") as CoolantFluidId];
}

/** Absolute roughness of commercial steel pipe, m (Moody chart value). */
export const COMMERCIAL_STEEL_ROUGHNESS_M = 4.5e-5;

/**
 * Darcy friction factor.
 *   laminar (Re < 2300):  f = 64 / Re
 *   turbulent:            Swamee–Jain explicit approximation to Colebrook–White,
 *                         f = 0.25 / [log10(ε/3.7D + 5.74/Re^0.9)]²
 * Reference: P. K. Swamee and A. K. Jain, J. Hydraulics Div. ASCE 102 (1976) 657; within
 * ~1 % of Colebrook for 5000 ≤ Re ≤ 10⁸ and 10⁻⁶ ≤ ε/D ≤ 10⁻². The transitional range
 * 2300–4000 is taken as turbulent (a conservative, documented choice).
 */
export function darcyFrictionFactor(
  reynolds: number,
  roughnessM: number,
  diameterM: number,
): number {
  if (!(reynolds > 0)) return 0;
  if (reynolds < 2300) return 64 / reynolds;
  const term = Math.log10(roughnessM / (3.7 * diameterM) + 5.74 / reynolds ** 0.9);
  return 0.25 / (term * term);
}

/**
 * Hydraulic resistance coefficient r in ΔP = r · ṁ² for one flow element.
 * Darcy–Weisbach plus a minor-loss coefficient K:
 *   ΔP = (f L / D + K) · ρ v² / 2,   v = ṁ / (ρ A)   ⇒   r = (f L/D + K) / (2 ρ A²)
 */
export function hydraulicResistance(params: {
  lengthM: number;
  diameterM: number;
  lossCoefficient: number;
  massFlowKgS: number;
  fluid: CoolantFluid;
  roughnessM?: number;
}): number {
  const { lengthM, diameterM, fluid } = params;
  if (!(diameterM > 0)) return Infinity;
  const areaM2 = (Math.PI * diameterM * diameterM) / 4;
  const velocity = Math.abs(params.massFlowKgS) / (fluid.densityKgM3 * areaM2);
  const reynolds = (fluid.densityKgM3 * velocity * diameterM) / fluid.dynamicViscosityPaS;
  // Before any flow exists assume fully turbulent friction so the first solve is sensible.
  const f =
    reynolds > 0
      ? darcyFrictionFactor(reynolds, params.roughnessM ?? COMMERCIAL_STEEL_ROUGHNESS_M, diameterM)
      : darcyFrictionFactor(1e6, params.roughnessM ?? COMMERCIAL_STEEL_ROUGHNESS_M, diameterM);
  return (
    ((f * lengthM) / diameterM + params.lossCoefficient) / (2 * fluid.densityKgM3 * areaM2 ** 2)
  );
}

/**
 * Generic centrifugal pump curve through a rated point (Q_r, H_r):
 *   H(Q) = H₀ (1 − (Q/Q₀)²),  H₀ = 4/3 H_r,  Q₀ = 2 Q_r
 * which passes through the rated point and is a common textbook idealisation. Running at
 * a fraction s of rated speed follows the affinity laws: H₀ ∝ s², Q₀ ∝ s.
 *
 * In mass-flow and pressure form: ΔP(ṁ) = P₀ s² − k ṁ², with P₀ = ρ g H₀ and
 * k = P₀ / ṁ₀².
 */
export interface PumpCurve {
  readonly shutoffPressurePa: number;
  readonly runoutMassFlowKgS: number;
}

export function pumpCurve(params: {
  ratedHeadM: number;
  ratedMassFlowKgS: number;
  speedFraction: number;
  fluid: CoolantFluid;
}): PumpCurve {
  const s = Math.max(0, params.speedFraction);
  const shutoffHeadM = (4 / 3) * params.ratedHeadM * s * s;
  return {
    shutoffPressurePa: params.fluid.densityKgM3 * STANDARD_GRAVITY_MPS2 * shutoffHeadM,
    runoutMassFlowKgS: 2 * params.ratedMassFlowKgS * s,
  };
}

/**
 * Operating point of pumps in series against a loop resistance r (ΔP = r ṁ²):
 *   Σ P₀ᵢ (1 − (ṁ/ṁ₀ᵢ)²) = r ṁ²   ⇒   ṁ = √( Σ P₀ᵢ / (r + Σ P₀ᵢ/ṁ₀ᵢ²) )
 */
export function seriesPumpOperatingPoint(pumps: readonly PumpCurve[], resistance: number): number {
  let totalShutoff = 0;
  let curvature = 0;
  for (const pump of pumps) {
    if (!(pump.shutoffPressurePa > 0) || !(pump.runoutMassFlowKgS > 0)) continue;
    totalShutoff += pump.shutoffPressurePa;
    curvature += pump.shutoffPressurePa / pump.runoutMassFlowKgS ** 2;
  }
  if (!(totalShutoff > 0)) return 0;
  const denominator = (Number.isFinite(resistance) ? resistance : 1e30) + curvature;
  return Math.sqrt(totalShutoff / denominator);
}

/**
 * Heat-exchanger effectiveness for a stream exchanging with a body at uniform temperature
 * (or a boiling secondary): ε = 1 − exp(−NTU), NTU = UA / (ṁ c_p).
 * Reference: Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, §11.4.
 */
export function effectivenessUniformTemperature(
  conductanceWK: number,
  capacityRateWK: number,
): number {
  if (!(capacityRateWK > 0) || !(conductanceWK > 0)) return 0;
  return 1 - Math.exp(-conductanceWK / capacityRateWK);
}

/* ------------------------------------------------------------------------------------ *
 * Saturation of water (IAPWS-IF97 Region 4)
 * ------------------------------------------------------------------------------------ */

/** Coefficients n1…n10 of the IAPWS-IF97 saturation equation. */
const N = [
  0.11670521452767e4, -0.72421316598856e6, -0.17073846940092e2, 0.1202082470247e5,
  -0.3232555032233e7, 0.1491510861353e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849,
  0.65017534844798e3,
] as const;

export const WATER_CRITICAL_TEMPERATURE_K = 647.096;
export const WATER_CRITICAL_PRESSURE_PA = 22.064e6;

/**
 * Saturation pressure of water at temperature T (273.15 K ≤ T ≤ 647.096 K), Pa.
 * IAPWS-IF97 eq. 30. Above the critical temperature there is no saturation: the
 * critical pressure is returned and callers must treat the state as beyond the model.
 */
export function waterSaturationPressurePa(temperatureK: number): number {
  if (temperatureK >= WATER_CRITICAL_TEMPERATURE_K) return WATER_CRITICAL_PRESSURE_PA;
  const t = Math.max(273.15, temperatureK);
  const theta = t + N[8] / (t - N[9]);
  const a = theta * theta + N[0] * theta + N[1];
  const b = N[2] * theta * theta + N[3] * theta + N[4];
  const c = N[5] * theta * theta + N[6] * theta + N[7];
  const mpa = ((2 * c) / (-b + Math.sqrt(b * b - 4 * a * c))) ** 4;
  return mpa * 1e6;
}

/** Saturation temperature of water at pressure p (611.213 Pa ≤ p ≤ 22.064 MPa), K. IF97 eq. 31. */
export function waterSaturationTemperatureK(pressurePa: number): number {
  const beta = Math.min(WATER_CRITICAL_PRESSURE_PA, Math.max(611.213, pressurePa)) / 1e6;
  const b = beta ** 0.25;
  const e = b * b + N[2] * b + N[5];
  const f = N[0] * b * b + N[3] * b + N[6];
  const g = N[1] * b * b + N[4] * b + N[7];
  const d = (2 * g) / (-f - Math.sqrt(f * f - 4 * e * g));
  return (N[9] + d - Math.sqrt((N[9] + d) ** 2 - 4 * (N[8] + N[9] * d))) / 2;
}

/**
 * Pressure in a closed loop of this coolant at bulk temperature T:
 *  - water: the system pressure, or the saturation pressure once the water is hotter than
 *    saturation at that pressure (it boils and the vapour pressurises the loop). Above the
 *    critical point the critical pressure is returned (beyond the model);
 *  - gas: p = p_sys · T / T_ref (closed rigid loop).
 */
export function loopPressurePa(fluid: CoolantFluid, temperatureK: number): number {
  if (fluid.pressureModel === "ideal-gas")
    return (fluid.systemPressurePa * Math.max(1, temperatureK)) / fluid.referenceTemperatureK;
  return Math.max(fluid.systemPressurePa, waterSaturationPressurePa(temperatureK));
}

/**
 * Net positive suction head available at a pump inlet, m: (p_suction − p_vapour) / (ρ g).
 * Only liquids cavitate; a gas loop returns Infinity.
 */
export function npshAvailableM(fluid: CoolantFluid, temperatureK: number): number {
  if (fluid.pressureModel === "ideal-gas") return Infinity;
  const vapour = waterSaturationPressurePa(temperatureK);
  const suction = loopPressurePa(fluid, temperatureK);
  return Math.max(0, suction - vapour) / (fluid.densityKgM3 * STANDARD_GRAVITY_MPS2);
}

/**
 * Peak hoop stress in a thick-walled cylinder under internal pressure p (Lamé), at the
 * bore: σ_θ = p (r_o² + r_i²) / (r_o² − r_i²). Exact for an elastic cylinder; it tends
 * to the thin-wall p·r/t as the wall gets thin.
 */
export function lameHoopStressPa(
  pressurePa: number,
  innerRadiusM: number,
  outerRadiusM: number,
): number {
  const ro2 = outerRadiusM * outerRadiusM;
  const ri2 = innerRadiusM * innerRadiusM;
  if (!(ro2 > ri2)) return Infinity;
  return (pressurePa * (ro2 + ri2)) / (ro2 - ri2);
}
