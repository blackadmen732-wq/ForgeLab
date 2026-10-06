import {
  type JoulesPerKilogram,
  type JoulesPerKilogramKelvin,
  type Kelvin,
  type Pascals,
  type Ratio,
  type Seconds,
  celsiusToKelvin,
  kilojoulesToJoules,
  megajoulesToJoules,
  megapascalsToPascals,
} from "@forgelab/shared";
import type { MaterialDefinition } from "@forgelab/materials";

/**
 * Reference data for the cascade solver.
 *
 * READ `docs/CASCADE.md` ("Data and where it came from") BEFORE CHANGING ANY NUMBER.
 *
 * Two kinds of number live here and they are labelled differently:
 *  - SOURCED: a physical constant, a code/standard table, or a handbook property.
 *  - REPRESENTATIVE: a value chosen from inside a range the cited literature reports,
 *    because the real value depends on a specific product ForgeLab does not model (a
 *    particular cell, a particular cable). These feed reduced models and are labelled so.
 */

/** Stefan–Boltzmann constant, CODATA 2018 (exact). W/(m²·K⁴). SOURCED. */
export const STEFAN_BOLTZMANN_W_M2K4 = 5.670374419e-8;

/** Molar gas constant, CODATA 2018 (exact). J/(mol·K). SOURCED. */
export const GAS_CONSTANT_J_MOLK = 8.314462618;

/** Standard atmosphere. SOURCED. */
export const STANDARD_ATMOSPHERE_PA: Pascals = 101_325;

/** Ambient air used to dilute released gas: molar mass of dry air. SOURCED. */
export const AIR_MOLAR_MASS_KG_MOL = 0.028_965;

/** Ratio of specific heats for air, used for constant-volume combustion pressure rise. */
export const AIR_HEAT_CAPACITY_RATIO = 1.4;

/**
 * Convective heat transfer coefficients, EN 1991-1-2 §3.1 and §3.2.1. SOURCED.
 *  - 25 W/(m²·K) on a surface exposed to the standard fire / hot gas.
 *  - 4 W/(m²·K) on an unexposed surface losing heat to ambient, with radiation treated
 *    separately (as ForgeLab does).
 */
export const FIRE_EXPOSED_CONVECTION_W_M2K = 25;
export const AMBIENT_CONVECTION_W_M2K = 4;

/**
 * Heskestad plume centreline excess temperature, ambient air (SFPE Handbook):
 *   ΔT₀ = 25 · Q_c^(2/3) · z^(-5/3)      with Q_c in kW and z in m above the source.
 * The constant below is the 25 with units folded in. SOURCED.
 */
export const HESKESTAD_PLUME_COEFFICIENT = 25;

/**
 * Excess temperature of the continuous flame region (McCaffrey, 1979): roughly 800 K.
 * The plume correlation is capped here because it is not valid inside the flame. SOURCED.
 */
export const CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K = 800;

/**
 * Carbon-steel yield-strength reduction factor k_y,θ, EN 1993-1-2 Table 3.1. SOURCED.
 * Temperature in °C, factor relative to 20 °C yield. Linear interpolation between points.
 */
const EN1993_CARBON_STEEL_KY: readonly (readonly [number, number])[] = [
  [20, 1.0],
  [400, 1.0],
  [500, 0.78],
  [600, 0.47],
  [700, 0.23],
  [800, 0.11],
  [900, 0.06],
  [1000, 0.04],
  [1100, 0.02],
  [1200, 0.0],
];

/**
 * Effective yield-strength factor of a material at temperature.
 *
 * Structural steel uses the EN 1993-1-2 table above (SOURCED). Every other material uses
 * a documented APPROXIMATION: full strength up to its `maxOperatingTemperatureK` (the
 * catalogue's "retains room-temperature properties" limit), falling linearly to zero at
 * the onset of melting. That shape is conservative near the limit and optimistic just
 * below melting; it exists so that heat weakens every metal, not only steel.
 */
export function yieldStrengthFactorAt(material: MaterialDefinition, temperatureK: Kelvin): Ratio {
  if (material.id === "structural-steel") {
    const c = temperatureK - celsiusToKelvin(0);
    const table = EN1993_CARBON_STEEL_KY;
    if (c <= table[0]![0]) return 1;
    for (let i = 1; i < table.length; i += 1) {
      const [t1, k1] = table[i]!;
      const [t0, k0] = table[i - 1]!;
      if (c <= t1) return k0 + ((k1 - k0) * (c - t0)) / (t1 - t0);
    }
    return 0;
  }
  const lo = material.maxOperatingTemperatureK;
  const hi = material.meltingPointK;
  if (temperatureK <= lo) return 1;
  if (temperatureK >= hi) return 0;
  return 1 - (temperatureK - lo) / (hi - lo);
}

/** Whether `yieldStrengthFactorAt` is a code table (true) or the generic approximation. */
export function yieldReductionIsSourced(material: MaterialDefinition): boolean {
  return material.id === "structural-steel";
}

/**
 * Linear temperature coefficient of resistivity, per kelvin, around 20 °C. SOURCED:
 * IEC 60028 for annealed copper (0.00393); handbook value for aluminium (0.00403).
 * Other materials: 0 (resistance held constant) — documented approximation.
 */
export function resistivityTemperatureCoefficientPerK(materialId: string): number {
  if (materialId === "copper") return 0.003_93;
  if (materialId === "aluminum") return 0.004_03;
  return 0;
}

/* ------------------------------------------------------------------------------------ *
 * Water
 * ------------------------------------------------------------------------------------ */

export const WATER = Object.freeze({
  /** Liquid specific heat near 25 °C (4181 J/(kg·K)). SOURCED. */
  specificHeatJkgK: 4181 as JoulesPerKilogramKelvin,
  /** Latent heat of vaporization at 100 °C (2257 kJ/kg). SOURCED. */
  latentHeatOfVaporizationJkg: kilojoulesToJoules(2257) as JoulesPerKilogram,
  /** Saturated liquid density near 150 °C (917 kg/m³). SOURCED (steam tables). */
  densityKgM3: 917,
  molarMassKgMol: 0.018_015,
});

/**
 * Saturation pressure of water, IAPWS-IF97 region 4, equation 30. SOURCED.
 * Valid 273.15 K .. 647.096 K; clamped to the critical point above that.
 */
export function waterSaturationPressurePa(temperatureK: Kelvin): Pascals {
  const n = [
    0.116_705_214_527_67e4, -0.724_213_167_032_06e6, -0.170_738_469_400_92e2,
    0.120_208_247_024_70e5, -0.323_255_503_223_33e7, 0.149_151_086_135_30e2,
    -0.482_326_573_615_91e4, 0.405_113_405_420_57e6, -0.238_555_575_678_49, 0.650_175_348_447_98e3,
  ] as const;
  const t = Math.min(Math.max(temperatureK, 273.15), 647.096);
  const theta = t + n[8] / (t - n[9]);
  const a = theta * theta + n[0] * theta + n[1];
  const b = n[2] * theta * theta + n[3] * theta + n[4];
  const c = n[5] * theta * theta + n[6] * theta + n[7];
  const ratio = (2 * c) / (-b + Math.sqrt(b * b - 4 * a * c));
  return megapascalsToPascals(ratio ** 4);
}

/** Saturation temperature at a pressure, by bisection on the IAPWS-IF97 curve. */
export function waterSaturationTemperatureK(pressurePa: Pascals): Kelvin {
  let lo = 273.15;
  let hi = 647.096;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (waterSaturationPressurePa(mid) < pressurePa) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------------------------ *
 * Helium and cryogenic copper
 * ------------------------------------------------------------------------------------ */

export const HELIUM = Object.freeze({
  /** Normal boiling point of He-4 (4.222 K). SOURCED (NIST). */
  normalBoilingPointK: 4.222 as Kelvin,
  /** Latent heat of vaporization at the normal boiling point (≈20.7 kJ/kg). SOURCED. */
  latentHeatOfVaporizationJkg: kilojoulesToJoules(20.7) as JoulesPerKilogram,
  /** Ideal monatomic gas cp = 5/2 R / M (5193 J/(kg·K)). SOURCED. */
  gasSpecificHeatJkgK: 5193 as JoulesPerKilogramKelvin,
  molarMassKgMol: 0.004_002_6,
});

/**
 * Specific heat of copper at cryogenic temperature from the Sommerfeld + Debye low-
 * temperature form cp = γT + βT³, with γ = 0.695 mJ/(mol·K²) and Debye θ = 343 K, per
 * kilogram. Gives 0.87 J/(kg·K) at 10 K, matching NIST OFHC copper data. SOURCED form.
 *
 * APPROXIMATION above ~15 K: the T³ law overshoots, so the result is capped at the room-
 * temperature value. Over-estimating cp under-estimates quench hot-spot temperature.
 */
export function copperCryogenicSpecificHeatJkgK(temperatureK: Kelvin): JoulesPerKilogramKelvin {
  const gamma = 0.010_94; // J/(kg·K²)
  const beta = 7.58e-4; // J/(kg·K⁴)
  return Math.min(gamma * temperatureK + beta * temperatureK ** 3, 385);
}

const CU_GAMMA = 0.010_94;
const CU_BETA = 7.58e-4;
/** Temperature where the low-temperature form reaches the room-temperature cp (≈79.6 K). */
const CU_CAP_K = solveCapTemperature();

function solveCapTemperature(): number {
  let lo = 1;
  let hi = 300;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (CU_GAMMA * mid + CU_BETA * mid ** 3 < 385) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Enthalpy of copper above 0 K per kilogram, the integral of
 * `copperCryogenicSpecificHeatJkgK`. Integrating enthalpy rather than multiplying by cp
 * at the current temperature matters at 4 K, where cp is a thousand times smaller than at
 * room temperature and an explicit step would overshoot by hundreds of kelvin.
 */
export function copperCryogenicEnthalpyJkg(temperatureK: Kelvin): number {
  const t = Math.max(temperatureK, 0);
  const below = Math.min(t, CU_CAP_K);
  const h = (CU_GAMMA * below * below) / 2 + (CU_BETA * below ** 4) / 4;
  return t <= CU_CAP_K ? h : h + 385 * (t - CU_CAP_K);
}

/** Inverse of `copperCryogenicEnthalpyJkg`. */
export function copperCryogenicTemperatureFromEnthalpyK(enthalpyJkg: number): Kelvin {
  const atCap = copperCryogenicEnthalpyJkg(CU_CAP_K);
  if (enthalpyJkg >= atCap) return CU_CAP_K + (enthalpyJkg - atCap) / 385;
  let lo = 0;
  let hi = CU_CAP_K;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (copperCryogenicEnthalpyJkg(mid) < enthalpyJkg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------------------------ *
 * Combustible materials
 * ------------------------------------------------------------------------------------ */

export type CombustibleKind = "transformer-oil" | "pvc-insulation" | "xlpe-insulation";

export interface CombustibleData {
  readonly name: string;
  readonly specificHeatJkgK: JoulesPerKilogramKelvin;
  /** Onset of thermal decomposition (pyrolysis): smoke and combustible vapour begin. */
  readonly decompositionTemperatureK: Kelvin;
  /** Surface temperature for ignition when a pilot (flame, arc, spark) is present. */
  readonly pilotedIgnitionTemperatureK: Kelvin;
  /** Surface temperature for ignition with no pilot. */
  readonly autoIgnitionTemperatureK: Kelvin;
  /** Heat of combustion released per kilogram burned. */
  readonly heatOfCombustionJkg: JoulesPerKilogram;
  /** Energy to turn a kilogram of solid/liquid into fuel vapour (heat of gasification). */
  readonly heatOfGasificationJkg: JoulesPerKilogram;
  /** Steady mass burning rate per unit burning area, kg/(m²·s). */
  readonly massBurningRateKgM2s: number;
  /** Fraction of heat release leaving the flame as radiation. */
  readonly radiativeFraction: Ratio;
  /** Mass of smoke (soot) produced per kilogram burned. */
  readonly smokeYield: Ratio;
  /** How much of this is sourced vs representative. */
  readonly confidence: string;
}

/**
 * Combustibles. Heat of combustion and burning rates are from the SFPE Handbook tables
 * (Babrauskas; Tewarson). Ignition and decomposition temperatures vary strongly with
 * formulation; those are REPRESENTATIVE values inside the reported ranges.
 */
export const COMBUSTIBLES: Readonly<Record<CombustibleKind, CombustibleData>> = Object.freeze({
  "transformer-oil": Object.freeze({
    name: "Mineral transformer oil",
    specificHeatJkgK: 1860,
    // IEC 60296 requires a flash point of at least 135 °C.
    decompositionTemperatureK: celsiusToKelvin(135),
    pilotedIgnitionTemperatureK: celsiusToKelvin(165),
    autoIgnitionTemperatureK: celsiusToKelvin(310),
    heatOfCombustionJkg: megajoulesToJoules(46),
    heatOfGasificationJkg: kilojoulesToJoules(700),
    massBurningRateKgM2s: 0.039,
    radiativeFraction: 0.3,
    smokeYield: 0.06,
    confidence:
      "Heat of combustion and burning rate SOURCED (SFPE, transformer oil, hydrocarbon). Flash point is the IEC 60296 minimum; fire point and auto-ignition REPRESENTATIVE.",
  }),
  "pvc-insulation": Object.freeze({
    name: "PVC cable insulation",
    specificHeatJkgK: 1000,
    decompositionTemperatureK: celsiusToKelvin(220),
    pilotedIgnitionTemperatureK: celsiusToKelvin(390),
    autoIgnitionTemperatureK: celsiusToKelvin(450),
    heatOfCombustionJkg: megajoulesToJoules(16.4),
    heatOfGasificationJkg: megajoulesToJoules(2.5),
    massBurningRateKgM2s: 0.016,
    radiativeFraction: 0.35,
    smokeYield: 0.17,
    confidence:
      "Heat of combustion, heat of gasification and smoke yield SOURCED (SFPE/Tewarson, rigid PVC). Decomposition and ignition temperatures REPRESENTATIVE; cable compounds vary widely.",
  }),
  "xlpe-insulation": Object.freeze({
    name: "XLPE cable insulation",
    specificHeatJkgK: 2300,
    decompositionTemperatureK: celsiusToKelvin(300),
    pilotedIgnitionTemperatureK: celsiusToKelvin(360),
    autoIgnitionTemperatureK: celsiusToKelvin(400),
    heatOfCombustionJkg: megajoulesToJoules(43),
    heatOfGasificationJkg: megajoulesToJoules(2.3),
    massBurningRateKgM2s: 0.014,
    radiativeFraction: 0.35,
    smokeYield: 0.06,
    confidence:
      "Heat of combustion and gasification SOURCED (SFPE, polyethylene). Ignition and decomposition temperatures REPRESENTATIVE.",
  }),
});

/**
 * Cable insulation conductor temperature limits, IEC 60364-5-52 / IEC 60949. SOURCED.
 * Continuous: the rated conductor temperature. Short-circuit: the limit above which the
 * insulation is damaged; ForgeLab treats crossing it as insulation breakdown.
 */
export const INSULATION_LIMITS: Readonly<
  Record<"pvc" | "xlpe", { continuousK: Kelvin; shortCircuitK: Kelvin }>
> = Object.freeze({
  pvc: Object.freeze({ continuousK: celsiusToKelvin(70), shortCircuitK: celsiusToKelvin(160) }),
  xlpe: Object.freeze({ continuousK: celsiusToKelvin(90), shortCircuitK: celsiusToKelvin(250) }),
});

/* ------------------------------------------------------------------------------------ *
 * Lithium-ion chemistries
 * ------------------------------------------------------------------------------------ */

export type BatteryChemistry = "nmc" | "lfp";

export interface BatteryChemistryData {
  readonly name: string;
  readonly cellSpecificHeatJkgK: JoulesPerKilogramKelvin;
  /** Highest temperature of normal operation. Above it the cell is "heated". */
  readonly maxOperatingTemperatureK: Kelvin;
  /** Cell safety vent opens: electrolyte vapour released, no runaway yet. */
  readonly ventOpeningTemperatureK: Kelvin;
  /** T1: onset of self-heating, ARC criterion 0.02 K/min. */
  readonly selfHeatingOnsetK: Kelvin;
  /** T2: thermal runaway trigger, criterion 1 K/s. */
  readonly runawayTriggerK: Kelvin;
  /** T3: maximum cell temperature reached in runaway. */
  readonly runawayMaxK: Kelvin;
  /** Characteristic duration of the main runaway reaction. */
  readonly runawayDurationSec: Seconds;
  /** Fraction of cell mass released as gas during runaway. */
  readonly ventGasMassFraction: Ratio;
  /** Fraction of cell mass released as electrolyte vapour when the safety vent opens. */
  readonly ventOpeningGasMassFraction: Ratio;
  /** Specific heat of the vented gas, for its sensible heat. */
  readonly ventGasSpecificHeatJkgK: JoulesPerKilogramKelvin;
  /** Fraction of cell mass ejected as hot solid/liquid particles. */
  readonly ejectaMassFraction: Ratio;
  readonly ventGas: GasFamilyData;
  readonly confidence: string;
}

export interface GasFamilyData {
  readonly name: string;
  readonly molarMassKgMol: number;
  readonly flammable: boolean;
  /** Lower flammability limit, volume fraction in air. */
  readonly lowerFlammabilityLimit: Ratio;
  readonly heatOfCombustionJkg: JoulesPerKilogram;
  readonly autoIgnitionTemperatureK: Kelvin;
}

/** Characteristic self-heating rates that define T1 and T2 (Feng et al., 2018). SOURCED. */
export const SELF_HEATING_ONSET_RATE_K_PER_S = 0.02 / 60;
export const RUNAWAY_TRIGGER_RATE_K_PER_S = 1;

const LIB_VENT_GAS: GasFamilyData = Object.freeze({
  name: "Li-ion vent gas (H2, CO, CO2, hydrocarbons)",
  molarMassKgMol: 0.028,
  flammable: true,
  lowerFlammabilityLimit: 0.075,
  heatOfCombustionJkg: megajoulesToJoules(12),
  autoIgnitionTemperatureK: celsiusToKelvin(500),
});

/**
 * Lithium-ion chemistries. REPRESENTATIVE values chosen inside the ranges reported by
 * Feng et al., "Thermal runaway mechanism of lithium ion battery for electric vehicles: A
 * review", Energy Storage Materials 10 (2018) 246–267, and Golubkov et al., RSC Advances
 * 4 (2014) 3633 (LFP max ≈ 400 °C, NMC ≈ 680–850 °C). Vent-gas LFL follows Baird et al.,
 * J. Power Sources 446 (2020). No specific commercial cell is represented.
 */
export const BATTERY_CHEMISTRIES: Readonly<Record<BatteryChemistry, BatteryChemistryData>> =
  Object.freeze({
    nmc: Object.freeze({
      name: "NMC (nickel manganese cobalt oxide)",
      cellSpecificHeatJkgK: 1000,
      maxOperatingTemperatureK: celsiusToKelvin(60),
      ventOpeningTemperatureK: celsiusToKelvin(130),
      selfHeatingOnsetK: celsiusToKelvin(100),
      runawayTriggerK: celsiusToKelvin(200),
      runawayMaxK: celsiusToKelvin(780),
      runawayDurationSec: 10,
      ventGasMassFraction: 0.1,
      ventOpeningGasMassFraction: 0.01,
      ventGasSpecificHeatJkgK: 1100,
      ejectaMassFraction: 0.05,
      ventGas: LIB_VENT_GAS,
      confidence: "REDUCED MODEL, representative literature values; not a specific cell.",
    }),
    lfp: Object.freeze({
      name: "LFP (lithium iron phosphate)",
      cellSpecificHeatJkgK: 1000,
      maxOperatingTemperatureK: celsiusToKelvin(60),
      ventOpeningTemperatureK: celsiusToKelvin(150),
      selfHeatingOnsetK: celsiusToKelvin(120),
      runawayTriggerK: celsiusToKelvin(240),
      runawayMaxK: celsiusToKelvin(420),
      runawayDurationSec: 30,
      ventGasMassFraction: 0.04,
      ventOpeningGasMassFraction: 0.01,
      ventGasSpecificHeatJkgK: 1100,
      ejectaMassFraction: 0.01,
      ventGas: LIB_VENT_GAS,
      confidence: "REDUCED MODEL, representative literature values; not a specific cell.",
    }),
  });

/** Other gas families the enclosure model tracks. */
export const GAS_FAMILIES = Object.freeze({
  smoke: Object.freeze({
    name: "Smoke (soot and combustion products)",
    molarMassKgMol: 0.029,
    flammable: false,
    lowerFlammabilityLimit: 1,
    heatOfCombustionJkg: 0,
    autoIgnitionTemperatureK: Infinity,
  }) as GasFamilyData,
  pyrolyzate: Object.freeze({
    name: "Pyrolysis vapour (decomposing insulation/oil)",
    molarMassKgMol: 0.06,
    flammable: true,
    lowerFlammabilityLimit: 0.02,
    heatOfCombustionJkg: megajoulesToJoules(25),
    autoIgnitionTemperatureK: celsiusToKelvin(400),
  }) as GasFamilyData,
  steam: Object.freeze({
    name: "Steam",
    molarMassKgMol: WATER.molarMassKgMol,
    flammable: false,
    lowerFlammabilityLimit: 1,
    heatOfCombustionJkg: 0,
    autoIgnitionTemperatureK: Infinity,
  }) as GasFamilyData,
  helium: Object.freeze({
    name: "Helium (cold boil-off)",
    molarMassKgMol: HELIUM.molarMassKgMol,
    flammable: false,
    lowerFlammabilityLimit: 1,
    heatOfCombustionJkg: 0,
    autoIgnitionTemperatureK: Infinity,
  }) as GasFamilyData,
  "battery-vent-gas": LIB_VENT_GAS,
});

export type GasFamily = keyof typeof GAS_FAMILIES;
export const GAS_FAMILY_IDS: readonly GasFamily[] = Object.freeze([
  "battery-vent-gas",
  "helium",
  "pyrolyzate",
  "smoke",
  "steam",
]);

/**
 * Electric-arc energy partition. REPRESENTATIVE: arc-flash literature reports that a
 * large share of arc power leaves as radiation and a large share goes into the
 * electrodes (melting and ejecting conductor metal), the rest heating the surrounding
 * gas. ForgeLab uses 40 / 40 / 20. Reduced model.
 */
export const ARC_RADIANT_FRACTION: Ratio = 0.4;
export const ARC_ELECTRODE_FRACTION: Ratio = 0.4;
export const ARC_CONVECTIVE_FRACTION: Ratio = 0.2;

/**
 * Semi-infinite solid surface temperature rise under a constant flux q for time t
 * (Carslaw & Jaeger): ΔT = 2 q √(t / (π k ρ c)). SOURCED closed form. Used for plasma
 * disruption heat loads, which last milliseconds — far too short for a lumped body.
 */
export function semiInfiniteSurfaceRiseK(
  fluxWm2: number,
  durationSec: Seconds,
  material: MaterialDefinition,
): number {
  const effusivity =
    material.thermalConductivityWmK * material.densityKgM3 * material.specificHeatJkgK;
  return 2 * fluxWm2 * Math.sqrt(durationSec / (Math.PI * effusivity));
}
