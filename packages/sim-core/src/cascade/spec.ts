import type { Kelvin, Meters, Pascals, Seconds, Vec3, Watts } from "@forgelab/shared";
import type { ComponentId } from "../connections.js";
import type { BatteryChemistry, CombustibleKind } from "./data.js";

/**
 * What the builder declares about a plant, beyond its geometry.
 *
 * Geometry, material and position come from the `SimulationComponent`s in the world. A
 * plant spec says what each component *is* in physical terms — a battery module of a
 * given chemistry, a pipe holding water at pressure, a superconducting coil — so the
 * cascade solver knows which physics applies to it. Every field is a design input or a
 * product parameter, never a "how likely is this to fail" number: whether something fails
 * is decided by the physics.
 *
 * The spec is plain JSON so it can live in a save file unchanged.
 */
export interface CascadePlantSpec {
  /** Air temperature around the plant. Default 293.15 K. */
  readonly ambientTemperatureK?: Kelvin;
  readonly nodes: readonly CascadeNodeSpec[];
  readonly enclosures?: readonly EnclosureSpec[];
  readonly coolantLoops?: readonly CoolantLoopSpec[];
  /** Faults the scenario starts with. A cascade should normally need exactly one. */
  readonly faults?: readonly InducedFaultSpec[];
}

export interface CascadeNodeSpec {
  readonly componentId: ComponentId;
  readonly initialTemperatureK?: Kelvin;
  readonly battery?: BatterySpec;
  readonly combustible?: CombustibleSpec;
  readonly electrical?: ElectricalSpec;
  readonly pipe?: PipeSpec;
  readonly pump?: PumpSpec;
  readonly cooledLoad?: CooledLoadSpec;
  readonly cryostat?: CryostatSpec;
  readonly cryoplant?: CryoplantSpec;
  readonly magnet?: MagnetSpec;
  readonly plasma?: PlasmaSpec;
  readonly barrier?: BarrierSpec;
}

/** A battery module: a row of identical cells inside the component (the cabinet shell). */
export interface BatterySpec {
  readonly chemistry: BatteryChemistry;
  readonly cellCount: number;
  readonly cellMassKg: number;
  /** Nameplate energy of one cell. */
  readonly cellEnergyJ: number;
  /** 0..1. Stored energy is nameplate × state of charge. */
  readonly stateOfCharge: number;
  /** Thermal conductance between adjacent cells. Low values = inter-cell barriers. */
  readonly interCellConductanceWPerK: number;
  /** Thermal conductance from the cabinet shell to each interior cell (base plate only). */
  readonly cabinetToCellConductanceWPerK: number;
  /**
   * Conductance to the two end cells, which also touch the side walls. Defaults to the
   * interior value. A difference here is what makes external heat reach one cell first.
   */
  readonly cabinetToEndCellConductanceWPerK?: number;
  /** Impact energy a cell can absorb before an internal short (from abuse testing). */
  readonly crushToleranceJ: number;
  /** Time for an internal short to discharge a cell's stored energy as heat. */
  readonly internalShortDurationSec?: Seconds;
}

export interface CombustibleSpec {
  readonly kind: CombustibleKind;
  readonly massKg: number;
  /** Surface area that burns once ignited (pool area, cable surface). */
  readonly burningAreaM2: number;
}

export type ElectricalSpec =
  | {
      readonly role: "source";
      readonly nominalVoltageV: number;
      /** Current an arcing fault draws on this supply (lower than the bolted fault). */
      readonly arcingFaultCurrentA: number;
      /** Voltage across an arc on this supply. */
      readonly arcVoltageV: number;
    }
  | {
      readonly role: "conductor";
      readonly lengthM: Meters;
      readonly conductorAreaM2: number;
      readonly conductorMaterialId: "copper" | "aluminum";
      readonly insulation: "pvc" | "xlpe";
      readonly insulationMassKg: number;
      /**
       * Insulation surface that burns once ignited. Defaults to the bare conductor's
       * surface; a cable tray or bundled cabinet wiring presents far more.
       */
      readonly insulationBurningAreaM2?: number;
      /** Thermal conductance from conductor to the component shell around it. */
      readonly conductorToShellConductanceWPerK: number;
      /**
       * Length of conductor an uncleared arc consumes before the circuit opens. An arc
       * runs along a bus, so this is longer than the arc gap.
       */
      readonly burnClearLengthM: Meters;
    }
  | {
      readonly role: "breaker";
      /** Current at or above which the protection starts timing. */
      readonly pickupCurrentA: number;
      /** Time the current must persist above pickup before the breaker opens. */
      readonly tripDelaySec: Seconds;
    }
  | {
      readonly role: "load";
      readonly powerW: Watts;
    };

export interface CoolantLoopSpec {
  readonly id: string;
  /** Water inventory in the loop. */
  readonly inventoryKg: number;
  /** Temperature at which coolant is returned to the components. */
  readonly supplyTemperatureK: Kelvin;
  /** Loop pressure maintained by the pressurizer while the loop is intact. */
  readonly operatingPressurePa: Pascals;
  /** Below this inventory fraction, pumps lose suction and flow stops. */
  readonly minimumInventoryFraction: number;
}

/** A water-filled pipe section. Wall radius and thickness come from cylinder geometry. */
export interface PipeSpec {
  readonly loopId: string;
  /** Water held in this section. */
  readonly waterMassKg: number;
  /** Heat removed by flowing coolant at full flow, per kelvin above supply (UA). */
  readonly flowCoolingWPerK: number;
  /**
   * True when the section can be isolated (check valve plus closed isolation valve), so
   * heated water cannot expand into the loop and pressure follows saturation. False for an
   * open line: water boils off into the loop at loop pressure.
   */
  readonly blockedIn?: boolean;
  /** Relief valve set pressure; omit when the section has no relief. */
  readonly reliefSetPressurePa?: Pascals;
  /** Area of the opening if the wall ruptures. */
  readonly breachAreaM2: number;
  /** Discharge coefficient of the breach (orifice flow). */
  readonly dischargeCoefficient?: number;
  /** How much further apart than as-built a flanged joint may be pulled before it opens. */
  readonly flangeSeparationLimitM?: Meters;
}

export interface PumpSpec {
  readonly loopId: string;
  readonly ratedFlowKgPerSec: number;
  /** Exponential coast-down time constant after power is lost (flywheel inertia). */
  readonly coastdownTimeConstantSec: Seconds;
}

/** A component with its own heat generation that a coolant loop must carry away. */
export interface CooledLoadSpec {
  readonly loopId: string;
  readonly heatGenerationW: Watts;
  /** Heat removal per kelvin above supply at full flow (UA). */
  readonly coolingWPerK: number;
}

export interface CryostatSpec {
  readonly heliumInventoryKg: number;
  /** Heat leak conductance from the warm outer vessel to the 4 K cold mass. */
  readonly heatLeakConductanceWPerK: number;
  /** Cold mass (coil winding pack), copper-equivalent. */
  readonly coldMassKg: number;
}

export interface CryoplantSpec {
  /** The cryostat this plant refrigerates. */
  readonly cryostatComponentId: ComponentId;
  readonly refrigerationW: Watts;
}

export interface MagnetSpec {
  /** Cryostat the coil sits in (normally the same component). */
  readonly cryostatComponentId: ComponentId;
  readonly storedEnergyJ: number;
  readonly operatingCurrentA: number;
  /** Temperature at which the conductor starts to share current with the stabilizer. */
  readonly currentSharingTemperatureK: Kelvin;
  /** Quench protection: external dump resistance. 0 means no dump circuit. */
  readonly dumpResistanceOhm: number;
  /** Time from quench to the dump switch opening. */
  readonly quenchDetectionDelaySec: Seconds;
  /** Current decay time constant when there is no dump (resistive normal zone only). */
  readonly unprotectedDecayTimeSec: Seconds;
}

export interface PlasmaSpec {
  readonly magnetComponentId: ComponentId;
  /** Stored plasma thermal energy. */
  readonly storedThermalEnergyJ: number;
  /** Heat deposited in this component (wall, blanket) while the plasma burns. */
  readonly wallHeatingW: Watts;
  /** Below this fraction of rated field, confinement is lost and the plasma disrupts. */
  readonly minimumFieldFraction: number;
  /** Fraction of wall area that takes the thermal quench. */
  readonly disruptionWettedAreaFraction: number;
  readonly thermalQuenchDurationSec: Seconds;
  /** Isotropic neutron/radiation power while burning. */
  readonly radiationPowerW?: Watts;
  /**
   * Automatic plasma control: a controlled ramp-down when these trip. Omit for no
   * automatic shutdown.
   */
  readonly controlledShutdown?: {
    readonly onCoolantFlowFractionBelow?: number;
    readonly onFieldFractionBelow?: number;
    readonly onWallTemperatureAboveK?: Kelvin;
    readonly rampDownSec: Seconds;
  };
}

/** A fire/heat barrier: an insulating layer across this component's volume. */
export interface BarrierSpec {
  readonly insulationThicknessM: Meters;
  readonly insulationConductivityWmK: number;
  readonly insulationDensityKgM3: number;
  readonly insulationSpecificHeatJkgK: number;
  /** Overpressure the barrier withstands. */
  readonly overpressureCapacityPa?: Pascals;
}

/** A volume in which released gas accumulates. */
export interface EnclosureSpec {
  readonly id: string;
  readonly minM: Vec3;
  readonly maxM: Vec3;
  /** Mechanical ventilation, air changes per hour. */
  readonly airChangesPerHour: number;
  /** Deflagration vent panels cap the overpressure here. Omit for an unvented room. */
  readonly ventReliefPressurePa?: Pascals;
}

export type InducedFaultSpec =
  | {
      readonly kind: "high-resistance-joint";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
      readonly addedResistanceOhm: number;
    }
  | {
      readonly kind: "insulation-breakdown";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
    }
  | {
      readonly kind: "external-heat";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
      readonly powerW: Watts;
      readonly durationSec: Seconds;
    }
  | {
      /** A spark, welding work or small flame in contact with the component. */
      readonly kind: "pilot-flame";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
      readonly durationSec: Seconds;
    }
  | {
      readonly kind: "cell-internal-short";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
      readonly cellIndex: number;
    }
  | {
      readonly kind: "loss-of-power";
      readonly componentId: ComponentId;
      readonly atTimeSec: Seconds;
    };

/**
 * Shape validation for a plant spec read from a file.
 *
 * Checks that the document is the right shape and every number is finite; it does not
 * check that a design is sensible — that is the physics' job.
 */
export function parseCascadePlantSpec(
  raw: unknown,
  knownComponentIds: ReadonlySet<string>,
): CascadePlantSpec {
  if (!isRecord(raw)) throw new Error("cascade: expected an object.");
  if (!Array.isArray(raw.nodes)) throw new Error("cascade.nodes: expected an array.");
  raw.nodes.forEach((node: unknown, index: number) => {
    if (!isRecord(node) || typeof node.componentId !== "string") {
      throw new Error(`cascade.nodes[${index}].componentId: expected a string.`);
    }
    if (!knownComponentIds.has(node.componentId)) {
      throw new Error(`cascade.nodes[${index}]: no component "${node.componentId}".`);
    }
  });
  for (const key of ["enclosures", "coolantLoops", "faults"] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      throw new Error(`cascade.${key}: expected an array.`);
    }
  }
  assertFiniteNumbers(raw, "cascade");
  return raw as unknown as CascadePlantSpec;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: expected a finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteNumbers(item, `${path}[${i}]`));
    return;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) assertFiniteNumbers(value[key], `${path}.${key}`);
  }
}
