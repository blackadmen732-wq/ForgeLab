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
