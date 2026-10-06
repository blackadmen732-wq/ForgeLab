import type { Kelvin, Seconds, Vec3 } from "@forgelab/shared";
import type { ComponentId } from "../connections.js";
import type { GasFamily } from "./data.js";

/** The physical families a hazard belongs to. */
export type HazardFamily =
  | "thermal"
  | "pressure"
  | "electrical"
  | "mechanical"
  | "chemical"
  | "cryogenic"
  | "plasma"
  | "radiation";

/**
 * Specific hazard processes. Each one keeps its own physics and its own appearance; a
 * renderer may never merge them into one generic "explosion".
 */
export type HazardKind =
  /** Radiant heat from a hot surface (incandescent steel, a runaway cabinet). */
  | "radiant-surface"
  /** A flame: radiant heat plus a buoyant hot-gas plume above it. */
  | "flame"
  /** Hot gas without flame (unignited vent gas, arc plasma gas). */
  | "hot-gas"
  /** Radiant and convective output of an electric arc. */
  | "electric-arc"
  /** A jet of fluid escaping a breach. */
  | "fluid-jet"
  /** A pressure wave from a confined combustion. */
  | "pressure-wave"
  /** Smoke and combustion products. Not a heat source; tracked for the enclosure. */
  | "smoke"
  /** Cold gas from a cryogenic release. */
  | "cryogenic-gas"
  /** Plasma energy hitting the wall in a disruption. */
  | "plasma-wall-heat"
  /** Neutron and gamma heating from a burning plasma. */
  | "radiation-heating";

/**
 * One physical output of a component's current state.
 *
 * Hazards are re-derived from state every step: a fire emits a `flame` hazard each step
 * it is burning, at whatever power its fuel supports that step. One-shot events (a
 * deflagration, a disruption) emit a hazard that lasts exactly the step they occur in.
 */
export interface HazardEmission {
  readonly id: string;
  readonly kind: HazardKind;
  readonly family: HazardFamily;
  readonly sourceComponentId: ComponentId;
  /** Event that started this hazard. Exposures it causes are attributed to this event. */
  readonly causalEventId: string;
  readonly originM: Vec3;
  /** Unit direction for directed hazards (jets). Undefined means isotropic. */
  readonly directionM?: Vec3;
  readonly startTimeSec: Seconds;
  /** Undefined while the hazard is ongoing. */
  readonly durationSec?: Seconds;
  /** Size of the source region (flame radius, arc size). Exposure is not computed inside it. */
  readonly sourceRadiusM: number;
  /** Radius beyond which the hazard is negligible and no exposure is computed. */
  readonly reachM: number;
  /** Radiant power leaving the source, W. */
  readonly radiantPowerW: number;
  /** Convective power carried by hot gas, W. */
  readonly convectivePowerW: number;
  /** Gas temperature at the source, for hot-gas and jet hazards. */
  readonly gasTemperatureK?: Kelvin;
  /** Mass flow of released fluid/gas, kg/s. */
  readonly massFlowKgPerSec?: number;
  /** Momentum flow of a jet (ṁ·v), N. */
  readonly jetForceN?: number;
  /** Overpressure of a pressure wave, Pa. */
  readonly overpressurePa?: number;
  /**
   * Radii at which this hazard's radiant flux falls to reference levels (point-source
   * model), for the engineering hazard view. Computed here so the renderer never does.
   */
  readonly radiantContoursM?: readonly { readonly fluxWm2: number; readonly radiusM: number }[];
  /** What is being released ("steam", "battery-vent-gas", "copper", ...). */
  readonly substance: string;
  /** Whether this hazard can ignite flammable gas or a combustible surface. */
  readonly ignitionSource: boolean;
}

/**
 * Everything one component received this step, by channel. These are inputs to the
 * physics; the renderer reads them only to draw the hazard view.
 */
export interface ComponentExposure {
  readonly componentId: ComponentId;
  /** Total heat absorbed per unit surface area from all external sources. */
  readonly heatFluxWm2: number;
  readonly radiantHeatFluxWm2: number;
  readonly conductiveHeatW: number;
  readonly convectiveHeatW: number;
  readonly hotGasTemperatureK: Kelvin;
  readonly flameExposure: boolean;
  readonly fluidJetLoadN: number;
  /** Accumulated over the run. */
  readonly pressureImpulsePaS: number;
  readonly peakOverpressurePa: number;
  /** Accumulated over the run. */
  readonly debrisImpactEnergyJ: number;
  /** Arc power arriving at this component this step, W. */
  readonly electricalFaultExposureW: number;
  /** Volume fraction of flammable gas in the enclosure around this component. */
  readonly chemicalGasExposure: number;
  /** Cooling from cryogenic gas this step, W. */
  readonly cryogenicExposureW: number;
  readonly plasmaHeatFluxWm2: number;
  /** Accumulated radiation energy absorbed over the run. */
  readonly radiationExposureJ: number;
}

export type CascadeEventKind =
  | "induced-fault"
  | "conductor-overheated"
  | "insulation-breakdown"
  | "arc-fault"
  | "arc-extinguished"
  | "breaker-tripped"
  | "power-lost"
  | "decomposition"
  | "ignition"
  | "burned-out"
  | "overheated"
  | "melting-began"
  | "melted-through"
  | "strength-reduced"
  | "support-yielded"
  | "battery-heated"
  | "battery-vent-opened"
  | "battery-self-heating"
  | "thermal-runaway"
  | "runaway-propagated"
  | "battery-burned-out"
  | "cell-mechanical-damage"
  | "gas-flammable"
  | "deflagration"
  | "relief-valve-opened"
  | "pipe-ruptured"
  | "flange-separated"
  | "coolant-inventory-low"
  | "pump-stopped"
  | "coolant-flow-lost"
  | "refrigeration-lost"
  | "helium-dry-out"
  | "magnet-quench"
  | "quench-dump"
  | "field-collapsed"
  | "plasma-controlled-shutdown"
  | "plasma-disruption"
  | "first-wall-melted"
  | "barrier-failed"
  | "debris-impact";

/**
 * A node in the catastrophe graph.
 *
 * Every event records the events that physically caused it. A threshold crossed because
 * of absorbed heat lists the events whose hazards delivered that heat; a pump that stopped
 * lists the power loss that stopped it. Nothing is ever recorded as caused by mere
 * proximity.
 */
export interface CascadeEvent {
  /** Sequential id, "EVT-001", in order of occurrence. */
  readonly id: string;
  readonly tick: number;
  readonly timeSec: Seconds;
  readonly kind: CascadeEventKind;
  readonly family: HazardFamily;
  readonly componentId: ComponentId;
  readonly description: string;
  readonly parentIds: readonly string[];
  /** Distance from the nearest root along parent links: 0 root, 1 secondary, 2 tertiary... */
  readonly depth: number;
  /** Energy this event has released into the world so far, J. Used to rank drama. */
  readonly energyReleasedJ: number;
}

export interface CascadeDiagnosis {
  readonly rootCauseEventIds: readonly string[];
  readonly mostDramaticEventId: string | undefined;
  /** Root → … → most dramatic event, following the strongest parent at each step. */
  readonly chainEventIds: readonly string[];
  readonly summary: string;
}

/** Live state of one component as the cascade solver sees it. */
export interface CascadeNodeState {
  readonly componentId: ComponentId;
  readonly temperatureK: Kelvin;
  readonly peakTemperatureK: Kelvin;
  readonly liquidFraction: number;
  readonly yieldStrengthFactor: number;
  /** Short machine-readable condition words ("burning", "runaway", "quenched", ...). */
  readonly conditions: readonly string[];
  readonly battery?: {
    readonly cellTemperaturesK: readonly Kelvin[];
    readonly cellStates: readonly BatteryCellState[];
  };
  readonly combustible?: {
    readonly state: "intact" | "decomposing" | "burning" | "burned-out";
    readonly remainingMassKg: number;
    readonly heatReleaseRateW: number;
  };
  readonly electrical?: {
    readonly energized: boolean;
    readonly currentA: number;
    readonly arcing: boolean;
    readonly open: boolean;
  };
  readonly pipe?: {
    readonly pressurePa: number;
    readonly hoopUtilization: number;
    readonly breached: boolean;
    readonly reliefOpen: boolean;
  };
  readonly pump?: { readonly powered: boolean; readonly flowFraction: number };
  readonly cryostat?: {
    readonly heliumKg: number;
    readonly coldMassTemperatureK: Kelvin;
  };
  readonly magnet?: { readonly currentFraction: number; readonly quenched: boolean };
  readonly plasma?: { readonly state: PlasmaState; readonly energyFraction: number };
  readonly barrier?: { readonly unexposedFaceTemperatureK: Kelvin; readonly failed: boolean };
}

export type BatteryCellState =
  "normal" | "heated" | "venting" | "self-heating" | "runaway" | "burned-out";

export type PlasmaState = "burning" | "ramping-down" | "off" | "disrupted";

export interface EnclosureState {
  readonly id: string;
  readonly minM: Vec3;
  readonly maxM: Vec3;
  readonly volumeM3: number;
  readonly gasMassKg: Readonly<Record<GasFamily, number>>;
  readonly flammableVolumeFraction: number;
  readonly lowerFlammabilityLimit: number;
  readonly overpressurePa: number;
}

export interface DebrisParcelState {
  readonly id: string;
  readonly substance: string;
  readonly massKg: number;
  readonly temperatureK: Kelvin;
  readonly molten: boolean;
  readonly positionM: Vec3;
}

export type ModelConfidence = "supported" | "approximate" | "reduced";

export interface ModelConfidenceEntry {
  readonly model: string;
  readonly confidence: ModelConfidence;
  readonly note: string;
}

export interface CascadeSnapshot {
  readonly timeSec: Seconds;
  readonly nodes: readonly CascadeNodeState[];
  readonly exposures: readonly ComponentExposure[];
  readonly hazards: readonly HazardEmission[];
  readonly enclosures: readonly EnclosureState[];
  readonly debris: readonly DebrisParcelState[];
  readonly events: readonly CascadeEvent[];
  readonly diagnosis: CascadeDiagnosis;
  readonly modelConfidence: readonly ModelConfidenceEntry[];
}

/**
 * How honest each model is. Shown in the interface next to every cascade. ForgeLab is
 * not fire-safety, arc-flash or battery certification software.
 */
export const CASCADE_MODEL_CONFIDENCE: readonly ModelConfidenceEntry[] = Object.freeze([
  {
    model: "Thermal transfer",
    confidence: "approximate",
    note: "Lumped bodies. Conduction along connections, point-source radiation with Cauchy projected area, EN 1991-1-2 convection, Heskestad plumes. No internal temperature gradients.",
  },
  {
    model: "Melting / phase change",
    confidence: "supported",
    note: "Enthalpy method with sourced melting points and latent heats. Melting is solid to liquid only and never produces gas.",
  },
  {
    model: "Hot steel strength",
    confidence: "supported",
    note: "EN 1993-1-2 Table 3.1 for carbon steel. Other metals use an approximate linear loss between service limit and melting.",
  },
  {
    model: "Battery thermal runaway",
    confidence: "reduced",
    note: "Arrhenius self-heating calibrated to the T1/T2 ARC definitions, adiabatic rise to T3. Representative chemistry values, not a specific cell.",
  },
  {
    model: "Gas accumulation",
    confidence: "approximate",
    note: "Well-mixed enclosure with ventilation. No stratification, no local pockets.",
  },
  {
    model: "Combustion",
    confidence: "reduced",
    note: "Steady burning rate per area, radiative fraction, smoke yield. Constant-volume pressure rise for deflagrations. No flame spread model inside a component.",
  },
  {
    model: "Electrical faults",
    confidence: "reduced",
    note: "Radial network, constant-power loads, definite-time protection. Arc power from supply arc voltage and arcing current; fixed energy partition.",
  },
  {
    model: "Coolant and pipe failure",
    confidence: "approximate",
    note: "IAPWS-IF97 saturation pressure, thin-wall hoop stress against hot yield, orifice blowdown. No two-phase choking or water hammer.",
  },
  {
    model: "Magnet quench",
    confidence: "reduced",
    note: "Helium bath energy balance, Debye cryogenic copper heat capacity, exponential current decay. No normal-zone propagation.",
  },
  {
    model: "Plasma disruption",
    confidence: "reduced",
    note: "Thermal quench onto a wetted wall area, semi-infinite surface heating. No current quench forces or runaway electrons.",
  },
]);
