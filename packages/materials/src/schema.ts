/**
 * The material library's data model.
 *
 * A material exposes only the property groups that apply to it and that we have sources
 * for. A group or a property that is absent is UNKNOWN — never zero, never a default.
 * Every number carries its unit, its source, the conditions it was measured or specified
 * at, its spread where the spread matters, and how far it should be trusted.
 */

/**
 * How far a value can be trusted.
 *  - specified:   a standard's minimum or maximum (ASTM, EN, IEC). Real stock is usually better.
 *  - handbook:    a conventional reference value for a pure substance (CRC, IAPWS, NIST).
 *  - typical:     a supplier datasheet or handbook typical for a grade; process-dependent.
 *  - approximate: a wide spread between sources or processes, or derived by us (the
 *                 derivation is in the note).
 */
export type Confidence = "specified" | "handbook" | "typical" | "approximate";

export interface Quantity {
  readonly value: number;
  /** SI unit symbol: "kg/m³", "Pa", "K", "W/(m·K)", "J/(kg·K)", "Ω·m", "1/K", "T", "V/m". */
  readonly unit: string;
  /** Key into SOURCES. */
  readonly source: string;
  readonly confidence: Confidence;
  /** Conditions the value applies at, e.g. "293 K", "0–100 °C", "25 µm film". */
  readonly at?: string;
  /** Spread across grades, processes or sources, in the same unit. */
  readonly range?: readonly [number, number];
  readonly note?: string;
}

/**
 * A property as a function of temperature: piecewise-linear between tabulated points,
 * held constant beyond the first and last. Only tabulated points are data; nothing is
 * extrapolated.
 */
export interface Curve {
  readonly unit: string;
  /** [temperature K, value] pairs, ascending in temperature. */
  readonly points: readonly (readonly [number, number])[];
  readonly source: string;
  readonly confidence: Confidence;
  readonly note?: string;
}

export interface MechanicalProperties {
  /** 0.2 % proof stress (yield). */
  readonly yieldStrength?: Quantity;
  readonly ultimateStrength?: Quantity;
  readonly youngsModulus?: Quantity;
  readonly poissonsRatio?: Quantity;
  /** Brittle materials: flexural (modulus of rupture) and compressive strength. */
  readonly flexuralStrength?: Quantity;
  readonly compressiveStrength?: Quantity;
  /** Yield strength at temperature ÷ room-temperature yield strength. */
  readonly yieldReduction?: Curve;
  /** Young's modulus at temperature ÷ room-temperature modulus. */
  readonly modulusReduction?: Curve;
}

export interface ThermalProperties {
  readonly specificHeat?: Quantity;
  readonly conductivity?: Quantity;
  /** Mean linear expansion coefficient. */
  readonly expansion?: Quantity;
  /** Melting point; for alloys `value` is the solidus and `range` [solidus, liquidus]. */
  readonly melting?: Quantity;
  /** Sublimation or decomposition, for materials that do not melt at 1 atm. */
  readonly decomposition?: Quantity;
  /**
   * Maximum continuous service temperature at which the grade keeps its listed
   * properties (see docs/material-sources.md for what this does and does not mean).
   */
  readonly maxService?: Quantity;
  /** Lowest recommended service temperature (embrittlement), where it matters. */
  readonly minService?: Quantity;
}

export interface ElectricalProperties {
  readonly resistivity?: Quantity;
  /** Resistivity against temperature, where tabulated. */
  readonly resistivityCurve?: Curve;
  readonly dielectricStrength?: Quantity;
  /** Insulators: true. Resistivity is then a volume resistivity. */
  readonly insulator: boolean;
}

export interface MagneticProperties {
  readonly ferromagnetic: boolean;
  readonly curieTemperature?: Quantity;
  readonly note?: string;
}

/**
 * The superconducting state. `criticalSurface` names the fit used for Tc(B); when it is
 * null only Tc0 is catalogued and the material cannot be used where a field-dependent
 * limit is needed.
 */
export interface SuperconductingProperties {
  readonly criticalTemperatureZeroField: Quantity;
  readonly upperCriticalFieldZeroTemperature?: Quantity;
  /** n in Bc2(T) = Bc20 · (1 − (T/Tc0)^n). */
  readonly temperatureExponent?: number;
  readonly criticalSurface: "lubell-bottura" | "godeke" | null;
  readonly note: string;
}

/** Qualitative nuclear behaviour we can state without inventing cross-sections. */
export interface NuclearProperties {
  readonly role: readonly ("structural" | "breeder" | "multiplier" | "shield" | "fuel")[];
  readonly notes: readonly string[];
  readonly source: string;
}

export interface PlasmaFacingProperties {
  readonly notes: readonly string[];
  readonly source: string;
}

/**
 * How the material looks and reacts on screen. Only how it LOOKS — every threshold that
 * decides when it reacts comes from the physical groups above (melting, service limit,
 * decomposition), so a renderer cannot make a material fail.
 */
export type ThermalResponse =
  /** Iron-based: oxide temper colours, then incandescence; no flame. */
  | "steel"
  /** Copper: darkens and blackens with oxide; glows only near its melting point. */
  | "copper"
  /** Aluminium alloys: little colour change; soften and slump below visible glow. */
  | "light-alloy"
  /** Refractory metals: incandescent far beyond other metals. */
  | "refractory"
  /** Polymers and laminates: discolour, char and smoke. */
  | "char"
  /** Ceramics and graphite: glow; no oxide colours. */
  | "ceramic"
  /** Superconductors: no visible change; the quench shows as resistive heating. */
  | "superconductor";

export interface PresentationProperties {
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly thermalResponse: ThermalResponse;
  /**
   * Whether the material can burn in air, and from what temperature (autoignition or
   * the onset of sustained burning, sourced in the physical data). Metals listed here are
   * false: steel and tungsten do not burn like fuel.
   *
   * `heatOfCombustion` (J/kg) and `burningRate` (kg/(m²·s), free-burning) are what the
   * simulation needs to burn the material; where either is not sourced it is left out
   * and the material is not burned by the model — never given a placeholder.
   */
  readonly combustible:
    | false
    | {
        readonly ignition: Quantity;
        readonly smoke: "sooty" | "light";
        readonly heatOfCombustion?: Quantity;
        readonly burningRate?: Quantity;
      };
}

export type MaterialCategory =
  | "structural-metal"
  | "conductor"
  | "plasma-facing"
  | "superconductor"
  | "insulator-ceramic"
  | "nuclear"
  | "civil"
  | "electrochemical";

/**
 * Thermal runaway of an electrochemical cell, as characterised by accelerating-rate
 * calorimetry (ARC). T1/T2/T3 follow Feng et al. (2018): T1 is where self-heating exceeds
 * 0.02 K/min, T2 where it exceeds 1 K/s (runaway), T3 the maximum temperature reached.
 * Measured on charged cells, so T3 already includes the electrochemical energy.
 */
export interface ThermalRunawayProperties {
  readonly selfHeatingOnset: Quantity;
  readonly trigger: Quantity;
  readonly maximum: Quantity;
  /** Duration of the main exothermic reaction once triggered. */
  readonly reactionTime: Quantity;
  /** Mass fraction of the cell vented as gas during runaway. */
  readonly ventGasMassFraction: Quantity;
  /** Vent gas properties: what decides whether it burns at the vent or accumulates. */
  readonly ventGas: {
    readonly heatOfCombustion: Quantity;
    readonly autoIgnition: Quantity;
    readonly lowerFlammabilityLimit: Quantity;
    readonly molarMass: Quantity;
  };
}

export interface MaterialRecord {
  readonly id: string;
  readonly name: string;
  /** The specific grade the numbers describe — part of the data, not a label. */
  readonly grade: string;
  readonly category: MaterialCategory;
  readonly summary: string;
  readonly density: Quantity;
  readonly mechanical?: MechanicalProperties;
  readonly thermal?: ThermalProperties;
  readonly electrical?: ElectricalProperties;
  readonly magnetic?: MagneticProperties;
  readonly superconducting?: SuperconductingProperties;
  readonly nuclear?: NuclearProperties;
  readonly plasmaFacing?: PlasmaFacingProperties;
  /** Only for cell chemistries with sourced runaway data. */
  readonly thermalRunaway?: ThermalRunawayProperties;
  readonly presentation: PresentationProperties;
  /** Caveats a user must see before trusting a number. */
  readonly notes: readonly string[];
  /** Short provenance line for compact displays. */
  readonly sourceSummary: string;
}

/** A thermodynamic state of a fluid with the properties measured at it. */
export interface FluidState {
  readonly label: string;
  readonly pressure: Quantity;
  readonly temperature: Quantity;
  readonly density?: Quantity;
  readonly specificHeat?: Quantity;
  readonly conductivity?: Quantity;
  readonly viscosity?: Quantity;
}

/** What a release of the fluid looks like, chosen from its physics (see notes). */
export type FluidRelease =
  /** Hot water/steam: flashes, condenses into a white plume that rises. */
  | "steam"
  /** Cryogen: cold dense vapour that condenses air moisture into fog and sinks. */
  | "cryogenic-vapor"
  /** Hot or room-temperature gas with no visible condensate. */
  | "invisible-gas"
  /** Liquid that sprays and pools. */
  | "liquid-spray"
  /** Liquid metal: heavy, opaque, falls. */
  | "liquid-metal";

export interface FluidRecord {
  readonly id: string;
  readonly name: string;
  readonly formula: string;
  readonly summary: string;
  readonly molarMass?: Quantity;
  readonly states: readonly FluidState[];
  readonly normalBoilingPoint?: Quantity;
  readonly meltingPoint?: Quantity;
  readonly triplePoint?: Quantity;
  readonly criticalTemperature?: Quantity;
  readonly criticalPressure?: Quantity;
  readonly latentHeatOfVaporization?: Quantity;
  /** Fuels: energy released per kilogram of fuel consumed. */
  readonly specificEnergy?: Quantity;
  readonly release: FluidRelease;
  /** Flammable fluids; gases have no flash point (a liquid property), only the note. */
  readonly combustible: false | { readonly flashPoint?: Quantity; readonly note: string };
  readonly radioactive?: {
    readonly halfLife: Quantity;
    readonly specificActivity: Quantity;
    readonly decayHeat: Quantity;
  };
  readonly notes: readonly string[];
  readonly sourceSummary: string;
}
