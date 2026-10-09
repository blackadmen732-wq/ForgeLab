import { cubicCentimetersToCubicMeters, megaElectronVoltsToJoules } from "@forgelab/shared";

/**
 * D–T fusion reaction data.
 *
 * REACTIVITY: H.-S. Bosch and G. M. Hale, "Improved formulas for fusion cross-sections and
 * thermal reactivities", Nuclear Fusion 32 (1992) 611. Their Maxwellian-averaged
 * parametrisation for T(d,n)4He, Table IV coefficients, valid for 0.2 keV ≤ T ≤ 100 keV
 * with a stated accuracy better than 0.25 % over that range.
 *
 *   θ = T / [1 − T(C2 + T(C4 + T·C6)) / (1 + T(C3 + T(C5 + T·C7)))]
 *   ξ = (B_G² / 4θ)^(1/3)
 *   <σv> = C1 · θ · sqrt(ξ / (m_r c² · T³)) · exp(−3ξ)          [cm³/s, T in keV]
 *
 * ENERGY RELEASE: D + T → ⁴He (3.52 MeV) + n (14.07 MeV), Q = 17.59 MeV. The 3.52/14.07
 * split follows from momentum conservation with negligible reactant energy.
 */
const BG_SQRT_KEV = 34.3827;
const MRC2_KEV = 1124656;
const C1 = 1.17302e-9;
const C2 = 1.51361e-2;
const C3 = 7.51886e-2;
const C4 = 4.60643e-3;
const C5 = 1.35e-2;
const C6 = -1.0675e-4;
const C7 = 1.366e-5;

export const BOSCH_HALE_DT_MIN_KEV = 0.2;
export const BOSCH_HALE_DT_MAX_KEV = 100;

export const DT_ALPHA_ENERGY_J = megaElectronVoltsToJoules(3.52);
export const DT_NEUTRON_ENERGY_J = megaElectronVoltsToJoules(14.07);
export const DT_FUSION_ENERGY_J = DT_ALPHA_ENERGY_J + DT_NEUTRON_ENERGY_J;
/** Fraction of D–T fusion energy carried by the alpha particle (3.52 / 17.59). */
export const DT_ALPHA_FRACTION = DT_ALPHA_ENERGY_J / DT_FUSION_ENERGY_J;

/**
 * Maxwellian-averaged D–T reactivity <σv> in m³/s at ion temperature `temperatureKeV`.
 *
 * Returns 0 below 0.05 keV, where the reactivity is negligible (< 1e-30 m³/s) and the fit
 * is not intended to be used. Between 0.05 and 0.2 keV and above 100 keV the fit is
 * extrapolated; callers flag that through `isWithinBoschHaleRange`.
 */
export function dtReactivityM3PerS(temperatureKeV: number): number {
  const T = temperatureKeV;
  if (!(T >= 0.05)) return 0;
  const numerator = T * (C2 + T * (C4 + T * C6));
  const denominator = 1 + T * (C3 + T * (C5 + T * C7));
  const theta = T / (1 - numerator / denominator);
  const xi = Math.cbrt((BG_SQRT_KEV * BG_SQRT_KEV) / (4 * theta));
  const sigmaVCm3 = C1 * theta * Math.sqrt(xi / (MRC2_KEV * T * T * T)) * Math.exp(-3 * xi);
  return cubicCentimetersToCubicMeters(sigmaVCm3);
}

export function isWithinBoschHaleRange(temperatureKeV: number): boolean {
  return temperatureKeV >= BOSCH_HALE_DT_MIN_KEV && temperatureKeV <= BOSCH_HALE_DT_MAX_KEV;
}

export interface FusionPower {
  /** Reactions per second in the whole plasma volume. */
  readonly reactionRatePerS: number;
  readonly fusionPowerW: number;
  readonly alphaPowerW: number;
  readonly neutronPowerW: number;
}

/**
 * Thermal D–T fusion power of a uniform plasma.
 *
 *   R = n_D · n_T · <σv> · V        P_fus = R · 17.59 MeV
 *
 * DOCUMENTED APPROXIMATIONS: uniform density and temperature (0D), Maxwellian ions,
 * no D–D or T–T side reactions (D–D contributes ~1 % of D–T power at 10 keV), no helium
 * ash dilution.
 */
export function dtFusionPower(params: {
  deuteriumDensityM3: number;
  tritiumDensityM3: number;
  temperatureKeV: number;
  volumeM3: number;
}): FusionPower {
  const reactivity = dtReactivityM3PerS(params.temperatureKeV);
  const reactionRatePerS =
    params.deuteriumDensityM3 * params.tritiumDensityM3 * reactivity * params.volumeM3;
  return {
    reactionRatePerS,
    fusionPowerW: reactionRatePerS * DT_FUSION_ENERGY_J,
    alphaPowerW: reactionRatePerS * DT_ALPHA_ENERGY_J,
    neutronPowerW: reactionRatePerS * DT_NEUTRON_ENERGY_J,
  };
}
