import { VACUUM_PERMEABILITY_H_PER_M, kiloElectronVoltsToJoules } from "@forgelab/shared";

/**
 * Reduced (zero-dimensional) plasma relations.
 *
 * Every function here is a published formula. The plasma is treated as one uniform
 * volume with a single temperature shared by ions and electrons (T_i = T_e) and equal
 * ion and electron densities (n_i = n_e, quasi-neutral hydrogenic plasma). Those are the
 * largest simplifications in ForgeLab and are stated wherever the numbers are shown.
 */

/* ------------------------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------------------------ */

/** Volume of an elongated torus plasma: V = 2π² R₀ κ a². */
export function toroidalPlasmaVolumeM3(
  majorRadiusM: number,
  minorRadiusM: number,
  elongation: number,
): number {
  return 2 * Math.PI ** 2 * majorRadiusM * elongation * minorRadiusM ** 2;
}

/** Volume of a cylindrical plasma column: V = π a² L. */
export function cylindricalPlasmaVolumeM3(radiusM: number, lengthM: number): number {
  return Math.PI * radiusM ** 2 * lengthM;
}

/* ------------------------------------------------------------------------------------ *
 * Energy content and pressure
 * ------------------------------------------------------------------------------------ */

/**
 * Thermal energy of a plasma with n_e = n_i = n and T_e = T_i = T:
 *   W = (3/2)(n_e T_e + n_i T_i) V = 3 n T V
 */
export function plasmaThermalEnergyJ(
  densityM3: number,
  temperatureKeV: number,
  volumeM3: number,
): number {
  return 3 * densityM3 * kiloElectronVoltsToJoules(temperatureKeV) * volumeM3;
}

/** Inverse of `plasmaThermalEnergyJ`: T = W / (3 n V), in keV. */
export function plasmaTemperatureKeV(energyJ: number, densityM3: number, volumeM3: number): number {
  if (!(densityM3 > 0) || !(volumeM3 > 0) || !(energyJ > 0)) return 0;
  return energyJ / (3 * densityM3 * volumeM3 * kiloElectronVoltsToJoules(1));
}

/**
 * Plasma beta: ratio of kinetic pressure p = 2 n T to magnetic pressure B² / 2μ₀.
 * Returns +Infinity with no field.
 */
export function plasmaBeta(densityM3: number, temperatureKeV: number, fieldT: number): number {
  const pressurePa = 2 * densityM3 * kiloElectronVoltsToJoules(temperatureKeV);
  const magneticPressurePa = (fieldT * fieldT) / (2 * VACUUM_PERMEABILITY_H_PER_M);
  if (!(magneticPressurePa > 0)) return pressurePa > 0 ? Infinity : 0;
  return pressurePa / magneticPressurePa;
}

/* ------------------------------------------------------------------------------------ *
 * Confinement
 * ------------------------------------------------------------------------------------ */

export interface Ipb98Inputs {
  readonly plasmaCurrentMA: number;
  readonly toroidalFieldT: number;
  /** Loss power: heating power crossing the separatrix, MW. */
  readonly lossPowerMW: number;
  /** Line-averaged electron density, 10¹⁹ m⁻³. ForgeLab uses the 0D volume average. */
  readonly densityE19: number;
  /** Average ion mass, amu (2.5 for 50:50 D–T). */
  readonly ionMassAmu: number;
  readonly majorRadiusM: number;
  /** Inverse aspect ratio a / R. */
  readonly inverseAspectRatio: number;
  /** Elongation (ForgeLab uses the geometric elongation for the areal κ_a). */
  readonly elongation: number;
}

/**
 * ITER IPB98(y,2) H-mode thermal energy confinement time, seconds.
 *
 *   τ_E = 0.0562 · I_p^0.93 · B_T^0.15 · P^−0.69 · n₁₉^0.41 · M^0.19 · R^1.97 · ε^0.58 · κ_a^0.78
 *
 * Reference: ITER Physics Expert Groups, "Chapter 2: Plasma confinement and transport",
 * Nuclear Fusion 39 (1999) 2175, Eq. 20. An empirical multi-machine regression; ForgeLab
 * applies it with H₉₈ = 1 (no confinement enhancement factor is offered to the player).
 */
export function ipb98y2ConfinementTimeS(inputs: Ipb98Inputs): number {
  const values = [
    inputs.plasmaCurrentMA,
    inputs.toroidalFieldT,
    inputs.lossPowerMW,
    inputs.densityE19,
    inputs.ionMassAmu,
    inputs.majorRadiusM,
    inputs.inverseAspectRatio,
    inputs.elongation,
  ];
  if (values.some((value) => !(value > 0))) return 0;
  return (
    0.0562 *
    inputs.plasmaCurrentMA ** 0.93 *
    inputs.toroidalFieldT ** 0.15 *
    inputs.lossPowerMW ** -0.69 *
    inputs.densityE19 ** 0.41 *
    inputs.ionMassAmu ** 0.19 *
    inputs.majorRadiusM ** 1.97 *
    inputs.inverseAspectRatio ** 0.58 *
    inputs.elongation ** 0.78
  );
}

/**
 * The parameter envelope inside which ForgeLab labels IPB98(y,2) predictions "supported".
 *
 * These bounds are ForgeLab's judgement of roughly where the ITER H-mode database and the
 * ITER design point lie (JET, JT-60U, DIII-D, ASDEX Upgrade, Alcator C-Mod and others,
 * extrapolated to ITER). They are not limits published with the scaling law. Outside them
 * the scaling is an extrapolation and results are labelled "approximate".
 */
export const IPB98_ENVELOPE = Object.freeze({
  plasmaCurrentMA: [0.2, 20] as const,
  toroidalFieldT: [0.5, 8] as const,
  densityE19: [1, 30] as const,
  majorRadiusM: [0.5, 9] as const,
  inverseAspectRatio: [0.15, 0.5] as const,
  elongation: [1, 2.1] as const,
  lossPowerMW: [0.1, 1000] as const,
});

export function ipb98OutOfEnvelope(inputs: Ipb98Inputs): string[] {
  const reasons: string[] = [];
  const check = (value: number, [lo, hi]: readonly [number, number], label: string) => {
    if (value < lo || value > hi)
      reasons.push(`${label} ${value.toPrecision(3)} outside ${lo}–${hi}`);
  };
  check(inputs.plasmaCurrentMA, IPB98_ENVELOPE.plasmaCurrentMA, "plasma current (MA)");
  check(inputs.toroidalFieldT, IPB98_ENVELOPE.toroidalFieldT, "toroidal field (T)");
  check(inputs.densityE19, IPB98_ENVELOPE.densityE19, "density (1e19 m^-3)");
  check(inputs.majorRadiusM, IPB98_ENVELOPE.majorRadiusM, "major radius (m)");
  check(inputs.inverseAspectRatio, IPB98_ENVELOPE.inverseAspectRatio, "inverse aspect ratio");
  check(inputs.elongation, IPB98_ENVELOPE.elongation, "elongation");
  return reasons;
}

/**
 * Bohm diffusion confinement time for a plasma column of radius a in field B, seconds.
 *
 *   D_B = k T_e / (16 e B)         τ_B ≈ a² / (2 D_B)
 *
 * Reference: D. Bohm (1949); NRL Plasma Formulary. Bohm diffusion is an empirical,
 * pessimistic transport estimate. ForgeLab uses it only for non-toroidal (linear)
 * configurations, which are always labelled "experimental": open magnetic systems also
 * lose plasma along field lines, which V0.1 does not model at all.
 */
export function bohmConfinementTimeS(
  radiusM: number,
  temperatureKeV: number,
  fieldT: number,
): number {
  if (!(fieldT > 0) || !(temperatureKeV > 0)) return 0;
  const diffusivityM2PerS = (temperatureKeV * 1e3) / (16 * fieldT);
  return (radiusM * radiusM) / (2 * diffusivityM2PerS);
}

/* ------------------------------------------------------------------------------------ *
 * Radiation and resistivity
 * ------------------------------------------------------------------------------------ */

/**
 * Bremsstrahlung coefficient, W·m³·keV^−½: P_br = C · Z_eff · n_e² · √T_e · V.
 * From the NRL Plasma Formulary, P_Br = 1.69×10⁻³² N_e T_e^½ Σ(Z² N_i) W/cm³ (T in eV,
 * N in cm⁻³), converted to SI with T in keV: 1.69e-38 × √1000 = 5.34e-37.
 */
export const BREMSSTRAHLUNG_COEFFICIENT = 1.69e-38 * Math.sqrt(1000);

export function bremsstrahlungPowerW(
  densityM3: number,
  temperatureKeV: number,
  effectiveCharge: number,
  volumeM3: number,
): number {
  if (!(temperatureKeV > 0)) return 0;
  return (
    BREMSSTRAHLUNG_COEFFICIENT *
    effectiveCharge *
    densityM3 *
    densityM3 *
    Math.sqrt(temperatureKeV) *
    volumeM3
  );
}

/** Coulomb logarithm used for resistivity. A representative constant (NRL: 15–20). */
export const COULOMB_LOGARITHM = 17;

/**
 * Spitzer parallel resistivity, Ω·m: η = 5.2×10⁻⁵ · Z · lnΛ / T_e^(3/2), T_e in eV.
 * Reference: NRL Plasma Formulary (transverse Spitzer resistivity is ~2× higher;
 * ForgeLab uses the parallel value, appropriate to toroidal current).
 */
export function spitzerResistivityOhmM(temperatureKeV: number, effectiveCharge: number): number {
  const eV = Math.max(temperatureKeV * 1e3, 1);
  return (5.2e-5 * effectiveCharge * COULOMB_LOGARITHM) / eV ** 1.5;
}

/** Ohmic heating of a toroidal plasma carrying `plasmaCurrentA`, watts. */
export function ohmicHeatingW(params: {
  plasmaCurrentA: number;
  temperatureKeV: number;
  effectiveCharge: number;
  majorRadiusM: number;
  minorRadiusM: number;
  elongation: number;
}): number {
  const eta = spitzerResistivityOhmM(params.temperatureKeV, params.effectiveCharge);
  const crossSectionM2 = Math.PI * params.minorRadiusM ** 2 * params.elongation;
  const resistanceOhm = (eta * 2 * Math.PI * params.majorRadiusM) / crossSectionM2;
  return resistanceOhm * params.plasmaCurrentA ** 2;
}

/* ------------------------------------------------------------------------------------ *
 * Operational limits
 * ------------------------------------------------------------------------------------ */

/**
 * Greenwald density limit, 10²⁰ m⁻³: n_G = I_p / (π a²), I_p in MA, a in m.
 * Reference: M. Greenwald et al., Nucl. Fusion 28 (1988) 2199. Exceeding it typically
 * ends in a radiative collapse and disruption.
 */
export function greenwaldDensityLimitM3(plasmaCurrentMA: number, minorRadiusM: number): number {
  if (!(minorRadiusM > 0)) return 0;
  return (plasmaCurrentMA / (Math.PI * minorRadiusM ** 2)) * 1e20;
}

/**
 * Normalised beta β_N = β[%] · a[m] · B[T] / I_p[MA]. The Troyon limit is β_N ≈ 2.8–3.5
 * without active wall stabilisation (F. Troyon et al., Plasma Phys. Control. Fusion 26
 * (1984) 209). ForgeLab uses 3.5 as the disruption threshold.
 */
export const TROYON_BETA_N_LIMIT = 3.5;

export function normalisedBeta(
  beta: number,
  minorRadiusM: number,
  fieldT: number,
  plasmaCurrentMA: number,
): number {
  if (!(plasmaCurrentMA > 0)) return Infinity;
  return (beta * 100 * minorRadiusM * fieldT) / plasmaCurrentMA;
}

/**
 * Edge safety factor, cylindrical approximation with an elongation correction:
 *   q ≈ (5 a² B / (R I_p)) · (1 + κ²) / 2          (a, R in m, B in T, I_p in MA)
 * Reference: J. Wesson, Tokamaks (4th ed.), §3.5 and the ITER Physics Basis. Tokamaks
 * disrupt from external kink modes when q₉₅ falls below about 2.
 */
export const LOW_Q_KINK_LIMIT = 2;

export function edgeSafetyFactor(params: {
  minorRadiusM: number;
  majorRadiusM: number;
  fieldT: number;
  plasmaCurrentMA: number;
  elongation: number;
}): number {
  if (!(params.plasmaCurrentMA > 0)) return Infinity;
  return (
    ((5 * params.minorRadiusM ** 2 * params.fieldT) /
      (params.majorRadiusM * params.plasmaCurrentMA)) *
    ((1 + params.elongation ** 2) / 2)
  );
}

/**
 * Plasma self-inductance, H: L_p = μ₀ R (ln(8R/a) − 2 + l_i/2), with internal inductance
 * l_i = 0.8. Reference: Wesson, Tokamaks, §3.7. Used only to estimate the magnetic energy
 * (½ L_p I_p²) released into the vessel when a plasma disrupts.
 */
export function plasmaInductanceH(majorRadiusM: number, minorRadiusM: number): number {
  const internalInductance = 0.8;
  const logTerm = Math.log((8 * majorRadiusM) / minorRadiusM) - 2 + internalInductance / 2;
  return VACUUM_PERMEABILITY_H_PER_M * majorRadiusM * Math.max(logTerm, 0);
}
