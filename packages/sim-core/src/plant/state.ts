/**
 * Plant state published in snapshots.
 *
 * Everything here is written by the plant solver alone and is read-only to every other
 * part of ForgeLab. All quantities are SI with unit suffixes.
 */

export interface ThermalState {
  readonly temperatureK: number;
  /** Limit above which the component raises an over-temperature (or quench) failure. */
  readonly limitTemperatureK: number;
  /** Heat generated or deposited in the component this tick (ohmic, nuclear, plasma), W. */
  readonly heatGeneratedW: number;
  /** Heat carried away by coolant this tick, W. */
  readonly heatToCoolantW: number;
  /** Heat lost to surroundings (convection + radiation) this tick, W. */
  readonly heatToAmbientW: number;
}

export interface ElectricalState {
  /** Island this component belongs to, or null when it is not on any powered network. */
  readonly islandId: string | null;
  readonly voltageV: number;
  /** Current through the component (conductors, sources) or drawn by it (loads), A. */
  readonly currentA: number;
  /** Power the component asks for, W (loads only). */
  readonly demandW: number;
  /** Power actually delivered, W (loads only). */
  readonly deliveredW: number;
  /** Power supplied into the network, W (sources only). */
  readonly suppliedW: number;
  /** Resistive loss dissipated in this component, W. */
  readonly lossW: number;
  /** deliveredW / demandW, 1 when nothing is demanded. */
  readonly supplyFraction: number;
}

export interface CoolantState {
  readonly loopId: string;
  readonly massFlowKgS: number;
  readonly coolantTemperatureK: number;
  readonly pressureDropPa: number;
}

export interface MagnetState {
  readonly currentA: number;
  /** Field this coil produces at the plasma centre of the vessel it serves, T. */
  readonly fieldAtPlasmaT: number;
  readonly servesVesselId: string | null;
  readonly peakFieldT: number;
  readonly hoopStressPa: number;
  readonly hoopUtilization: number;
  readonly quenched: boolean;
  readonly tripped: boolean;
  /** Electrical demand of the cryoplant (superconducting) or I²R (resistive), W. */
  readonly powerDemandW: number;
  /** Self-inductance of the winding (ideal toroid or Wheeler solenoid), H. */
  readonly inductanceH: number;
  /** Magnetic energy stored in the winding, ½ L I², J. */
  readonly storedEnergyJ: number;
  /** Seconds since the quench began (−1 if it has not quenched). */
  readonly quenchAgeS: number;
  /** Whether protection has detected the quench and opened the dump circuit. */
  readonly dumping: boolean;
  /** Power going into the dump resistor, I² L / τ, W. */
  readonly dumpPowerW: number;
  /**
   * Helium boiled off because heat reaching the cold mass exceeds the refrigeration
   * (ṁ = Q_deficit / h_fg at 4.2 K), kg/s. Superconducting coils only.
   */
  readonly heliumBoilOffKgS: number;
}

export type PlasmaPhase = "off" | "ramp-up" | "flat-top" | "shutdown" | "ended" | "disrupted";

export type PlasmaConfiguration = "tokamak" | "linear" | "none";

export interface PlasmaState {
  readonly phase: PlasmaPhase;
  readonly configuration: PlasmaConfiguration;
  readonly densityM3: number;
  readonly temperatureKeV: number;
  readonly thermalEnergyJ: number;
  readonly volumeM3: number;
  readonly majorRadiusM: number;
  readonly minorRadiusM: number;
  readonly plasmaCurrentA: number;
  readonly fieldT: number;
  readonly confinementTimeS: number;
  readonly fusionPowerW: number;
  readonly alphaPowerW: number;
  readonly neutronPowerW: number;
  readonly auxiliaryHeatingW: number;
  readonly ohmicHeatingW: number;
  readonly bremsstrahlungW: number;
  readonly transportLossW: number;
  readonly fuelingRatePerS: number;
  readonly deuteriumFraction: number;
  /** Plasma gain P_fus / P_aux (0 with no plasma; Infinity if ignited with no heating). */
  readonly gainQ: number;
  readonly beta: number;
  readonly normalisedBeta: number;
  readonly greenwaldFraction: number;
  readonly safetyFactorQ95: number;
  /** Why the plasma is not running, or why it ended. */
  readonly statusText: string;
}

export interface VesselState {
  readonly pressurePa: number;
  readonly pumpingSpeedM3PerS: number;
  readonly gasLoadPaM3PerS: number;
  readonly interiorVolumeM3: number;
  readonly plasma: PlasmaState;
}

export interface ComponentPlantState {
  readonly thermal: ThermalState;
  readonly electrical: ElectricalState | null;
  readonly coolant: CoolantState | null;
  readonly magnet: MagnetState | null;
  readonly vessel: VesselState | null;
  /** Role-specific scalar outputs, SI, keyed with unit suffixes (e.g. `shaftPowerW`). */
  readonly outputs: Readonly<Record<string, number>>;
  /** Human-readable conditions worth showing in an inspector (not failures). */
  readonly warnings: readonly string[];
  /** Knocked out by a failure this run (burned-out conductor, tripped coil...). */
  readonly disabled: boolean;
}

export const AMBIENT_TEMPERATURE_K = 293.15;

export const ZERO_THERMAL_STATE: ThermalState = Object.freeze({
  temperatureK: AMBIENT_TEMPERATURE_K,
  limitTemperatureK: Infinity,
  heatGeneratedW: 0,
  heatToCoolantW: 0,
  heatToAmbientW: 0,
});

export const ZERO_PLANT_STATE: ComponentPlantState = Object.freeze({
  thermal: ZERO_THERMAL_STATE,
  electrical: null,
  coolant: null,
  magnet: null,
  vessel: null,
  outputs: Object.freeze({}),
  warnings: Object.freeze([]),
  disabled: false,
});

export interface ElectricalIslandSummary {
  readonly id: string;
  readonly componentIds: readonly string[];
  readonly nominalVoltageV: number;
  readonly demandW: number;
  readonly deliveredW: number;
  readonly lossW: number;
  readonly generationW: number;
  readonly gridImportW: number;
  readonly supplyFraction: number;
  readonly minVoltageV: number;
}

export interface CoolantLoopSummary {
  readonly id: string;
  readonly componentIds: readonly string[];
  readonly fluidId: string;
  readonly closed: boolean;
  readonly massFlowKgS: number;
  readonly ratedMassFlowKgS: number;
  readonly pressureRisePa: number;
  /** Loop pressure from its bulk temperature (system pressure, saturation or ideal gas). */
  readonly pressurePa: number;
  readonly temperatureK: number;
  readonly heatPickupW: number;
  readonly heatRejectedW: number;
}

export type ConfidenceLevel = "supported" | "approximate" | "experimental";

export interface SubsystemConfidence {
  readonly subsystem: string;
  readonly level: ConfidenceLevel;
  readonly reasons: readonly string[];
}

export interface ModelConfidence {
  readonly level: ConfidenceLevel;
  readonly subsystems: readonly SubsystemConfidence[];
}

export interface PlantMetrics {
  readonly fusionPowerW: number;
  readonly alphaPowerW: number;
  readonly neutronPowerW: number;
  readonly auxiliaryHeatingW: number;
  /** P_fus / P_aux across all vessels. */
  readonly plasmaGainQ: number;
  readonly thermalPowerToCycleW: number;
  readonly grossElectricW: number;
  /** Everything the plant consumes: loads plus resistive losses. */
  readonly houseLoadW: number;
  /** Gross electrical generation − internal plant consumption. */
  readonly netElectricW: number;
  readonly gridImportW: number;
  /** Gross electric / house load. */
  readonly engineeringGain: number;
  readonly peakTemperatureK: number;
  readonly burningVesselCount: number;
}

export interface PlantSummary {
  readonly metrics: PlantMetrics;
  readonly islands: readonly ElectricalIslandSummary[];
  readonly loops: readonly CoolantLoopSummary[];
  readonly confidence: ModelConfidence;
}

export const EMPTY_PLANT_METRICS: PlantMetrics = Object.freeze({
  fusionPowerW: 0,
  alphaPowerW: 0,
  neutronPowerW: 0,
  auxiliaryHeatingW: 0,
  plasmaGainQ: 0,
  thermalPowerToCycleW: 0,
  grossElectricW: 0,
  houseLoadW: 0,
  netElectricW: 0,
  gridImportW: 0,
  engineeringGain: 0,
  peakTemperatureK: AMBIENT_TEMPERATURE_K,
  burningVesselCount: 0,
});
