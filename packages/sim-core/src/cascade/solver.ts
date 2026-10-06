import { type MaterialDefinition, getMaterial } from "@forgelab/materials";
import {
  type Kelvin,
  type Seconds,
  type Vec3,
  Vec3Math,
  celsiusToKelvin,
  kelvinToCelsius,
  localPointToWorld,
  vec3,
} from "@forgelab/shared";
import { type SimulationComponent, currentTransform } from "../component.js";
import type { ComponentId, Connection } from "../connections.js";
import { type FailureEvent, type SimulationSystemName, formatQuantity } from "../failure.js";
import {
  type Aabb,
  type ComponentGeometry,
  sectionAreaPerpendicularToLocalAxis,
  worldAabb,
} from "../geometry.js";
import {
  AIR_HEAT_CAPACITY_RATIO,
  AMBIENT_CONVECTION_W_M2K,
  ARC_CONVECTIVE_FRACTION,
  ARC_ELECTRODE_FRACTION,
  ARC_RADIANT_FRACTION,
  BATTERY_CHEMISTRIES,
  type BatteryChemistryData,
  COMBUSTIBLES,
  CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K,
  type CombustibleData,
  FIRE_EXPOSED_CONVECTION_W_M2K,
  GAS_CONSTANT_J_MOLK,
  GAS_FAMILIES,
  GAS_FAMILY_IDS,
  type GasFamily,
  HELIUM,
  HESKESTAD_PLUME_COEFFICIENT,
  INSULATION_LIMITS,
  RUNAWAY_TRIGGER_RATE_K_PER_S,
  SELF_HEATING_ONSET_RATE_K_PER_S,
  STANDARD_ATMOSPHERE_PA,
  STEFAN_BOLTZMANN_W_M2K4,
  WATER,
  copperCryogenicEnthalpyJkg,
  copperCryogenicTemperatureFromEnthalpyK,
  resistivityTemperatureCoefficientPerK,
  semiInfiniteSurfaceRiseK,
  waterSaturationPressurePa,
  waterSaturationTemperatureK,
  yieldStrengthFactorAt,
} from "./data.js";
import { AttributionLedger, CatastropheGraph } from "./graph.js";
import type {
  BatterySpec,
  CascadeNodeSpec,
  CascadePlantSpec,
  CoolantLoopSpec,
  ElectricalSpec,
  EnclosureSpec,
  InducedFaultSpec,
} from "./spec.js";
import { SpatialHash, aabbCenter, distanceToAabb, segmentIntersectsAabb } from "./spatial-hash.js";
import {
  type BatteryCellState,
  CASCADE_MODEL_CONFIDENCE,
  type CascadeEventKind,
  type CascadeNodeState,
  type CascadeSnapshot,
  type ComponentExposure,
  type DebrisParcelState,
  type EnclosureState,
  type HazardEmission,
  type HazardFamily,
  type HazardKind,
  type PlasmaState,
} from "./types.js";

/* ====================================================================================== *
 * Performance and attribution constants. None of these decide whether anything fails.
 * ====================================================================================== */

/** Broad-phase cell size. */
const SPATIAL_CELL_SIZE_M = 4;
/**
 * Radiant reach cutoff: beyond the distance where a source's flux falls under 100 W/m²
 * its contribution is skipped. At that flux a steel member warms by well under 0.01 K/s.
 */
const NEGLIGIBLE_FLUX_WM2 = 100;
/** Plume reach cutoff: excess gas temperature below 2 K is skipped. */
const NEGLIGIBLE_PLUME_EXCESS_K = 2;
/** Surfaces hotter than ambient by more than this are treated as radiant sources. */
const RADIANT_SURFACE_THRESHOLD_K = 150;
/** No point-source calculation closer than this; the point model fails at contact. */
const MIN_RADIANT_DISTANCE_M = 0.25;
/** Hot debris is aggregated into parcels of at least this mass. */
const DEBRIS_PARCEL_MASS_KG = 0.2;
const MAX_DEBRIS_PARCELS = 64;
/** A flame, arc or spark ignites things it actually touches: within this of its source. */
const PILOT_CONTACT_M = 1;
/**
 * Reference radiant flux levels drawn in the hazard view: 12.5 kW/m² (commonly used as
 * the piloted-ignition level for wood and many plastics) and 4 kW/m² (commonly used as the
 * limit for people). Display references only; nothing in the solver tests against them.
 */
const REFERENCE_FLUX_LEVELS_WM2 = [12_500, 4_000] as const;

/* ====================================================================================== *
 * Internal state
 * ====================================================================================== */

interface Body {
  readonly id: string;
  readonly componentId: ComponentId;
  capacityJK: number;
  meltMassKg: number;
  meltingPointK: Kelvin;
  latentJkg: number;
  liquidFraction: number;
  temperatureK: Kelvin;
  peakTemperatureK: Kelvin;
  /** Surface exchanging heat with ambient air. 0 for bodies inside another. */
  ambientAreaM2: number;
  emissivity: number;
  /** External heat absorbed this step, W. */
  externalW: number;
  /** Heat generated inside the body this step, W. */
  generationW: number;
  /** Coolant cooling this step: conductance and the temperature it cools toward. */
  coolingWPerK: number;
  coolantTemperatureK: Kelvin;
  /** Cooling the design expects but is not getting this step, and the event to blame. */
  coolingDeficitW: number;
  coolingDeficitCause: string | undefined;
  links: { other: Body; conductanceWPerK: number }[];
  readonly ledger: AttributionLedger;
  lastEventId: string | undefined;
}

interface CellRuntime {
  readonly body: Body;
  state: BatteryCellState;
  storedEnergyJ: number;
  runawayRemainingJ: number;
  ventGasRemainingKg: number;
  shortRemainingJ: number;
  shortPowerW: number;
  runawayEventId: string | undefined;
}

interface BatteryRuntime {
  readonly spec: BatterySpec;
  readonly chemistry: BatteryChemistryData;
  readonly arrheniusA: number;
  readonly arrheniusB: number;
  readonly cells: CellRuntime[];
  raised: Set<string>;
}

interface CombustibleRuntime {
  readonly data: CombustibleData;
  readonly body: Body;
  readonly burningAreaM2: number;
  remainingKg: number;
  state: "intact" | "decomposing" | "burning" | "burned-out";
  heatReleaseRateW: number;
  ignitionEventId: string | undefined;
}

interface ConductorRuntime {
  readonly spec: Extract<ElectricalSpec, { role: "conductor" }>;
  readonly body: Body;
  readonly material: MaterialDefinition;
  addedResistanceOhm: number;
  jointFaultEventId: string | undefined;
  insulationState: "ok" | "overheated" | "broken";
  arcing: boolean;
  arcEventId: string | undefined;
  erodedKg: number;
  pendingEjectaKg: number;
  readonly burnClearKg: number;
  /** The conductor's own insulation, as fuel. */
  readonly insulationFuel: CombustibleRuntime;
}

interface ElectricalRuntime {
  readonly spec: ElectricalSpec;
  conductor: ConductorRuntime | undefined;
  open: boolean;
  openEventId: string | undefined;
  breakerTimerSec: number;
  forcedOffEventId: string | undefined;
  energized: boolean;
  powered: boolean;
  currentA: number;
  loadCurrentA: number;
  powerLostEventId: string | undefined;
  /** Arc events whose fault current passed through this element this step. */
  faultCurrentCauses: string[];
}

interface PipeRuntime {
  readonly loopId: string;
  breached: boolean;
  breachEventId: string | undefined;
  reliefOpen: boolean;
  pressurePa: number;
  hoopUtilization: number;
  waterKg: number;
  breachDirection: Vec3;
}

interface LoopRuntime {
  readonly spec: CoolantLoopSpec;
  inventoryKg: number;
  flowFraction: number;
  flowCauseEventId: string | undefined;
  lowRaised: boolean;
  flowLostRaised: boolean;
  lowEventId: string | undefined;
}

interface PumpRuntime {
  flowFraction: number;
  stoppedEventId: string | undefined;
}

interface CryostatRuntime {
  heliumKg: number;
  readonly initialHeliumKg: number;
  coldTemperatureK: Kelvin;
  readonly coldLedger: AttributionLedger;
  refrigerationLostEventId: string | undefined;
  dryOutEventId: string | undefined;
  coldMeltRaised: boolean;
}

interface MagnetRuntime {
  currentFraction: number;
  quenched: boolean;
  quenchEventId: string | undefined;
  sinceQuenchSec: number;
  dumping: boolean;
  dumpEventId: string | undefined;
  fieldCollapsedEventId: string | undefined;
}

interface PlasmaRuntime {
  state: PlasmaState;
  energyJ: number;
  rampRateJps: number;
  endEventId: string | undefined;
}

interface BarrierRuntime {
  readonly back: Body;
  failed: boolean;
  insulationFailedRaised: boolean;
}

interface NodeRuntime {
  readonly componentId: ComponentId;
  readonly spec: CascadeNodeSpec | undefined;
  component: SimulationComponent;
  readonly material: MaterialDefinition;
  readonly shell: Body;
  readonly closedShell: boolean;
  box: Aabb;
  centerM: Vec3;
  readonly surfaceAreaM2: number;
  readonly battery: BatteryRuntime | undefined;
  readonly combustible: CombustibleRuntime | undefined;
  readonly electrical: ElectricalRuntime | undefined;
  readonly pipe: PipeRuntime | undefined;
  readonly pump: PumpRuntime | undefined;
  readonly cryostat: CryostatRuntime | undefined;
  readonly magnet: MagnetRuntime | undefined;
  readonly plasma: PlasmaRuntime | undefined;
  readonly barrier: BarrierRuntime | undefined;
  raised: Set<string>;
  displacedCauseEventId: string | undefined;
  externalHeatSec: { untilSec: number; powerW: number; eventId: string } | undefined;
  pilotFault: { untilSec: number; eventId: string } | undefined;
  /** Supply cut by an induced fault on a component without an electrical model. */
  powerFaultEventId: string | undefined;
  exposure: MutableExposure;
  pilotPresent: boolean;
  pilotCauseEventId: string | undefined;
}

type MutableExposure = { -readonly [K in keyof ComponentExposure]: ComponentExposure[K] };

interface EnclosureRuntime {
  readonly spec: EnclosureSpec;
  readonly volumeM3: number;
  readonly box: Aabb;
  gasKg: Record<GasFamily, number>;
  readonly ledger: AttributionLedger;
  flammableEventId: string | undefined;
  overpressurePa: number;
}

interface Parcel {
  readonly id: string;
  readonly substance: string;
  readonly massKg: number;
  readonly specificHeatJkgK: number;
  readonly meltingPointK: number;
  readonly latentJkg: number;
  temperatureK: number;
  liquidFraction: number;
  positionM: Vec3;
  velocityMps: Vec3;
  readonly sourceComponentId: ComponentId;
  readonly causalEventId: string | undefined;
}

export interface CascadeStepContext {
  readonly components: readonly SimulationComponent[];
  readonly connections: readonly Connection[];
  readonly tick: number;
  /** Simulated time at the start of the step. */
  readonly timeSec: Seconds;
  readonly dtSec: Seconds;
  readonly gravityMps2: number;
  readonly groundLevelM: number;
  /** Structural failures the world raised this step. */
  readonly newStructuralFailures: readonly FailureEvent[];
}

/** Event kinds that are also written to the world's failure log. */
const FAILURE_LOG_KINDS: Partial<Record<CascadeEventKind, SimulationSystemName>> = {
  "insulation-breakdown": "electrical",
  "arc-fault": "electrical",
  "breaker-tripped": "electrical",
  ignition: "thermal",
  "thermal-runaway": "thermal",
  "melted-through": "thermal",
  "pipe-ruptured": "fluid",
  "flange-separated": "fluid",
  "coolant-flow-lost": "fluid",
  "magnet-quench": "magnetic",
  "plasma-disruption": "plasma",
  "first-wall-melted": "plasma",
  "barrier-failed": "thermal",
  deflagration: "thermal",
};

/**
 * The cascading multi-physics failure solver.
 *
 * A failed component changes the physical environment around it. This class turns each
 * component's state into the physical outputs it actually releases (heat, gas, flame,
 * arcs, jets, debris, plasma), propagates them through space and through networks, lets
 * every affected component update its own physical state, and records a new event only
 * when a component's *own* limit is crossed. Nothing fails because it is near something
 * else; things fail because of what reached them.
 *
 * ORDER EACH FIXED STEP (never recursive — a cascade unfolds across steps in time):
 *   A. apply scheduled faults; solve networks (electrical, coolant, cryogenic, plasma)
 *   B. derive hazard emissions from current states
 *   C. propagate hazards spatially (broad phase, then exposure)
 *   D. move hot debris and resolve its impacts
 *   E. solve thermal response, phase change and gas accumulation
 *   F. evaluate each model's thresholds and raise events
 *   G. record causality in the catastrophe graph
 */
export class CascadeSolver {
  readonly #spec: CascadePlantSpec;
  readonly #ambientK: Kelvin;
  readonly #nodes = new Map<ComponentId, NodeRuntime>();
  readonly #sortedIds: ComponentId[] = [];
  readonly #loops = new Map<string, LoopRuntime>();
  readonly #enclosures: EnclosureRuntime[] = [];
  readonly #graph = new CatastropheGraph();
  readonly #faultsApplied = new Set<number>();
  #parcels: Parcel[] = [];
  #parcelCounter = 0;
  #hazards: HazardEmission[] = [];
  #pendingHazards: HazardEmission[] = [];
  #pendingFailures: FailureEvent[] = [];
  #timeSec: Seconds = 0;
  #tick = 0;
  #hash = new SpatialHash(SPATIAL_CELL_SIZE_M);
  #initialized = false;
  /** Set when any component moved this step: broad phase and conduction links are rebuilt. */
  #geometryChanged = true;
  #conductionLinks: { a: Body; b: Body; g: number }[] = [];
  /** As-built socket separation of each coolant joint, recorded the first time it is seen. */
  readonly #designGapM = new Map<string, number>();

  constructor(spec: CascadePlantSpec) {
    this.#spec = spec;
    this.#ambientK = spec.ambientTemperatureK ?? celsiusToKelvin(20);
    for (const loop of [...(spec.coolantLoops ?? [])].sort(byId)) {
      this.#loops.set(loop.id, {
        spec: loop,
        inventoryKg: loop.inventoryKg,
        flowFraction: 1,
        flowCauseEventId: undefined,
        lowRaised: false,
        flowLostRaised: false,
        lowEventId: undefined,
      });
    }
    for (const enclosure of [...(spec.enclosures ?? [])].sort(byId)) {
      const box = { minM: enclosure.minM, maxM: enclosure.maxM };
      const size = Vec3Math.subtract(enclosure.maxM, enclosure.minM);
      this.#enclosures.push({
        spec: enclosure,
        box,
        volumeM3: Math.max(size.x * size.y * size.z, 1e-6),
        gasKg: emptyGas(),
        ledger: new AttributionLedger(),
        flammableEventId: undefined,
        overpressurePa: 0,
      });
    }
  }

  get spec(): CascadePlantSpec {
    return this.#spec;
  }

  get eventCount(): number {
    return this.#graph.size;
  }

  /**
   * Effective yield strength of each component at its current temperature, as a factor
   * of room-temperature yield. Handed to the structural solver, which is how heat weakens
   * structure without the cascade solver ever doing structural analysis itself.
   */
  yieldStrengthFactors(): ReadonlyMap<ComponentId, { factor: number; temperatureK: Kelvin }> {
    const result = new Map<ComponentId, { factor: number; temperatureK: Kelvin }>();
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const factor =
        node.shell.liquidFraction >= 1
          ? 0
          : yieldStrengthFactorAt(node.material, node.shell.temperatureK);
      if (factor < 1) result.set(id, { factor, temperatureK: node.shell.temperatureK });
    }
    return result;
  }

  /** Failures raised since the last call, for the world's failure log. */
  drainFailures(): FailureEvent[] {
    const out = this.#pendingFailures;
    this.#pendingFailures = [];
    return out;
  }

  /* ==================================================================================== *
   * The step
   * ==================================================================================== */

  step(ctx: CascadeStepContext): void {
    this.#tick = ctx.tick;
    this.#timeSec = ctx.timeSec;
    this.#syncComponents(ctx.components);
    const dt = ctx.dtSec;

    for (const id of this.#sortedIds) this.#resetStepAccumulators(this.#nodes.get(id)!);

    // A. Faults, then the network solvers.
    this.#applyFaults();
    this.#handleStructuralFailures(ctx.newStructuralFailures);
    this.#checkFlanges(ctx.connections);
    this.#solveElectrical(dt);
    this.#solveCoolant(dt);
    this.#solveCryogenics(dt);
    this.#solvePlasma(dt);

    // B. Hazards from states.
    const hazards = this.#deriveHazards(dt);
    this.#hazards = hazards;

    // C. Spatial propagation.
    this.#propagate(hazards, dt);

    // D. Debris.
    this.#moveDebris(ctx, dt);

    // E. Thermal solve and model responses.
    this.#linkConduction(ctx.connections);
    this.#applyModelHeat(dt);
    this.#solveThermal(dt);
    this.#solveGas(dt);

    // F + G. Thresholds and causality.
    this.#evaluateThresholds();
  }

  snapshot(describe: (id: ComponentId) => string = (id) => `"${id}"`): CascadeSnapshot {
    const nodes = this.#sortedIds.map((id) => this.#nodeState(this.#nodes.get(id)!));
    return Object.freeze({
      timeSec: this.#timeSec,
      nodes: Object.freeze(nodes),
      exposures: Object.freeze(
        this.#sortedIds.map((id) => Object.freeze({ ...this.#nodes.get(id)!.exposure })),
      ),
      hazards: Object.freeze([...this.#hazards]),
      enclosures: Object.freeze(this.#enclosures.map((e) => this.#enclosureState(e))),
      debris: Object.freeze(
        this.#parcels.map((p): DebrisParcelState =>
          Object.freeze({
            id: p.id,
            substance: p.substance,
            massKg: p.massKg,
            temperatureK: p.temperatureK,
            molten: p.liquidFraction > 0,
            positionM: p.positionM,
          }),
        ),
      ),
      events: this.#graph.list(),
      diagnosis: this.#graph.diagnose(describe),
      modelConfidence: CASCADE_MODEL_CONFIDENCE,
    });
  }

  /** Every ancestor of an event, nearest first. */
  ancestorsOf(eventId: string): string[] {
    return this.#graph.ancestors(eventId);
  }

  /* ==================================================================================== *
   * Setup and bookkeeping
   * ==================================================================================== */

  #syncComponents(components: readonly SimulationComponent[]): void {
    const live = new Map(components.map((c) => [c.id, c]));
    if (!this.#initialized) {
      const specs = new Map(this.#spec.nodes.map((n) => [n.componentId, n]));
      for (const component of [...components].sort(byId)) {
        this.#nodes.set(component.id, this.#createNode(component, specs.get(component.id)));
        this.#sortedIds.push(component.id);
      }
      this.#initialized = true;
    }

    this.#geometryChanged = false;
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const current = live.get(id);
      if (current !== undefined && current !== node.component) {
        const before = node.component.state.physical;
        const after = current.state.physical;
        if (before.positionM !== after.positionM || before.rotation !== after.rotation)
          this.#geometryChanged = true;
        node.component = current;
      }
    }
    if (!this.#geometryChanged && this.#hash.size > 0) return;
    this.#geometryChanged = true;
    this.#hash = new SpatialHash(SPATIAL_CELL_SIZE_M);
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      node.box = worldAabb(node.component.geometry, currentTransform(node.component));
      node.centerM = aabbCenter(node.box);
      this.#hash.insert(id, node.box);
    }
  }

  #createNode(component: SimulationComponent, spec: CascadeNodeSpec | undefined): NodeRuntime {
    const material = getMaterial(component.materialId);
    const structuralMassKg = Math.max(component.massKg - component.additionalMassKg, 0);
    const surfaceAreaM2 = geometrySurfaceAreaM2(component.geometry);
    const initialK = spec?.initialTemperatureK ?? this.#ambientK;

    let capacityJK = structuralMassKg * material.specificHeatJkgK;
    if (spec?.pipe !== undefined) capacityJK += spec.pipe.waterMassKg * WATER.specificHeatJkgK;
    if (spec?.combustible !== undefined) {
      capacityJK += spec.combustible.massKg * COMBUSTIBLES[spec.combustible.kind].specificHeatJkgK;
    }

    const shell = makeBody({
      id: component.id,
      componentId: component.id,
      capacityJK: Math.max(capacityJK, 1),
      meltMassKg: structuralMassKg,
      material,
      temperatureK: initialK,
      ambientAreaM2: surfaceAreaM2,
    });

    const box = worldAabb(component.geometry, currentTransform(component));
    const node: NodeRuntime = {
      componentId: component.id,
      spec,
      component,
      material,
      shell,
      closedShell: component.geometry.wallThicknessM !== undefined,
      box,
      centerM: aabbCenter(box),
      surfaceAreaM2,
      battery:
        spec?.battery !== undefined
          ? this.#createBattery(component.id, spec.battery, shell, initialK)
          : undefined,
      combustible:
        spec?.combustible !== undefined
          ? {
              data: COMBUSTIBLES[spec.combustible.kind],
              body: shell,
              burningAreaM2: spec.combustible.burningAreaM2,
              remainingKg: spec.combustible.massKg,
              state: "intact",
              heatReleaseRateW: 0,
              ignitionEventId: undefined,
            }
          : undefined,
      electrical: undefined,
      pipe:
        spec?.pipe !== undefined
          ? {
              loopId: spec.pipe.loopId,
              breached: false,
              breachEventId: undefined,
              reliefOpen: false,
              pressurePa:
                this.#loops.get(spec.pipe.loopId)?.spec.operatingPressurePa ??
                STANDARD_ATMOSPHERE_PA,
              hoopUtilization: 0,
              waterKg: spec.pipe.waterMassKg,
              breachDirection: vec3(0, -1, 0),
            }
          : undefined,
      pump: spec?.pump !== undefined ? { flowFraction: 1, stoppedEventId: undefined } : undefined,
      cryostat:
        spec?.cryostat !== undefined
          ? {
              heliumKg: spec.cryostat.heliumInventoryKg,
              initialHeliumKg: spec.cryostat.heliumInventoryKg,
              coldTemperatureK: HELIUM.normalBoilingPointK,
              coldLedger: new AttributionLedger(),
              refrigerationLostEventId: undefined,
              dryOutEventId: undefined,
              coldMeltRaised: false,
            }
          : undefined,
      magnet:
        spec?.magnet !== undefined
          ? {
              currentFraction: 1,
              quenched: false,
              quenchEventId: undefined,
              sinceQuenchSec: 0,
              dumping: false,
              dumpEventId: undefined,
              fieldCollapsedEventId: undefined,
            }
          : undefined,
      plasma:
        spec?.plasma !== undefined
          ? {
              state: "burning",
              energyJ: spec.plasma.storedThermalEnergyJ,
              rampRateJps: 0,
              endEventId: undefined,
            }
          : undefined,
      barrier: undefined,
      raised: new Set(),
      displacedCauseEventId: undefined,
      externalHeatSec: undefined,
      powerFaultEventId: undefined,
      pilotFault: undefined,
      exposure: emptyExposure(component.id),
      pilotPresent: false,
      pilotCauseEventId: undefined,
    };

    if (spec?.electrical !== undefined) {
      (node as { electrical: ElectricalRuntime }).electrical = this.#createElectrical(
        component.id,
        spec.electrical,
        shell,
        initialK,
      );
    }

    if (spec?.barrier !== undefined) {
      const b = spec.barrier;
      const faceAreaM2 = largestFaceAreaM2(component.geometry);
      const insulationCapacity =
        faceAreaM2 *
        b.insulationThicknessM *
        b.insulationDensityKgM3 *
        b.insulationSpecificHeatJkgK;
      shell.capacityJK += insulationCapacity / 2;
      shell.ambientAreaM2 = faceAreaM2;
      const back = makeBody({
        id: `${component.id}#unexposed`,
        componentId: component.id,
        capacityJK: Math.max(insulationCapacity / 2, 1),
        meltMassKg: 0,
        material,
        temperatureK: initialK,
        ambientAreaM2: faceAreaM2,
      });
      (node as { barrier: BarrierRuntime }).barrier = {
        back,
        failed: false,
        insulationFailedRaised: false,
      };
    }
    return node;
  }

  #createBattery(
    componentId: ComponentId,
    spec: BatterySpec,
    shell: Body,
    initialK: Kelvin,
  ): BatteryRuntime {
    const chemistry = BATTERY_CHEMISTRIES[spec.chemistry];
    // Calibrate dT/dt = A·exp(−B/T) through the two ARC definitions (Feng et al., 2018):
    // 0.02 K/min at T1 and 1 K/s at T2. Nothing else sets the self-heating rate.
    const t1 = chemistry.selfHeatingOnsetK;
    const t2 = chemistry.runawayTriggerK;
    const arrheniusB =
      Math.log(RUNAWAY_TRIGGER_RATE_K_PER_S / SELF_HEATING_ONSET_RATE_K_PER_S) / (1 / t1 - 1 / t2);
    const arrheniusA = SELF_HEATING_ONSET_RATE_K_PER_S * Math.exp(arrheniusB / t1);
    const cells: CellRuntime[] = [];
    for (let i = 0; i < spec.cellCount; i += 1) {
      cells.push({
        body: makeBody({
          id: `${componentId}#cell${i}`,
          componentId,
          capacityJK: spec.cellMassKg * chemistry.cellSpecificHeatJkgK,
          meltMassKg: 0,
          material: undefined,
          temperatureK: initialK,
          ambientAreaM2: 0,
        }),
        state: "normal",
        storedEnergyJ: spec.cellEnergyJ * spec.stateOfCharge,
        runawayRemainingJ: 0,
        ventGasRemainingKg: 0,
        shortRemainingJ: 0,
        shortPowerW: 0,
        runawayEventId: undefined,
      });
    }
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i]!.body;
      const end = i === 0 || i === spec.cellCount - 1;
      link(
        cell,
        shell,
        end
          ? (spec.cabinetToEndCellConductanceWPerK ?? spec.cabinetToCellConductanceWPerK)
          : spec.cabinetToCellConductanceWPerK,
      );
      if (i + 1 < cells.length) link(cell, cells[i + 1]!.body, spec.interCellConductanceWPerK);
    }
    return { spec, chemistry, arrheniusA, arrheniusB, cells, raised: new Set() };
  }

  #createElectrical(
    componentId: ComponentId,
    spec: ElectricalSpec,
    shell: Body,
    initialK: Kelvin,
  ): ElectricalRuntime {
    let conductor: ConductorRuntime | undefined;
    if (spec.role === "conductor") {
      const material = getMaterial(spec.conductorMaterialId);
      const insulation =
        COMBUSTIBLES[spec.insulation === "pvc" ? "pvc-insulation" : "xlpe-insulation"];
      const conductorMassKg = spec.conductorAreaM2 * spec.lengthM * material.densityKgM3;
      const body = makeBody({
        id: `${componentId}#conductor`,
        componentId,
        capacityJK:
          conductorMassKg * material.specificHeatJkgK +
          spec.insulationMassKg * insulation.specificHeatJkgK,
        meltMassKg: conductorMassKg,
        material,
        temperatureK: initialK,
        ambientAreaM2: 0,
      });
      link(body, shell, spec.conductorToShellConductanceWPerK);
      conductor = {
        spec,
        body,
        material,
        addedResistanceOhm: 0,
        jointFaultEventId: undefined,
        insulationState: "ok",
        arcing: false,
        arcEventId: undefined,
        erodedKg: 0,
        pendingEjectaKg: 0,
        burnClearKg: spec.conductorAreaM2 * spec.burnClearLengthM * material.densityKgM3,
        insulationFuel: {
          data: insulation,
          body,
          burningAreaM2:
            spec.insulationBurningAreaM2 ??
            2 * Math.sqrt(Math.PI * spec.conductorAreaM2) * spec.lengthM,
          remainingKg: spec.insulationMassKg,
          state: "intact",
          heatReleaseRateW: 0,
          ignitionEventId: undefined,
        },
      };
    }
    return {
      spec,
      conductor,
      open: false,
      openEventId: undefined,
      breakerTimerSec: 0,
      forcedOffEventId: undefined,
      energized: true,
      powered: true,
      currentA: 0,
      loadCurrentA: 0,
      powerLostEventId: undefined,
      faultCurrentCauses: [],
    };
  }

  #resetStepAccumulators(node: NodeRuntime): void {
    for (const body of this.#bodiesOf(node)) {
      body.externalW = 0;
      body.generationW = 0;
      body.coolingWPerK = 0;
      body.coolingDeficitW = 0;
      body.coolingDeficitCause = undefined;
      body.links = body.links.filter((l) => l.other.componentId === node.componentId);
    }
    const e = node.exposure;
    e.heatFluxWm2 = 0;
    e.radiantHeatFluxWm2 = 0;
    e.conductiveHeatW = 0;
    e.convectiveHeatW = 0;
    e.hotGasTemperatureK = this.#ambientK;
    e.flameExposure = false;
    e.fluidJetLoadN = 0;
    e.peakOverpressurePa = 0;
    e.electricalFaultExposureW = 0;
    e.chemicalGasExposure = 0;
    e.cryogenicExposureW = 0;
    e.plasmaHeatFluxWm2 = 0;
    node.pilotPresent = false;
    node.pilotCauseEventId = undefined;
    if (node.pilotFault !== undefined && this.#timeSec < node.pilotFault.untilSec) {
      node.pilotPresent = true;
      node.pilotCauseEventId = node.pilotFault.eventId;
    }
  }

  #bodiesOf(node: NodeRuntime): Body[] {
    const bodies = [node.shell];
    if (node.battery !== undefined) for (const cell of node.battery.cells) bodies.push(cell.body);
    if (node.electrical?.conductor !== undefined) bodies.push(node.electrical.conductor.body);
    if (node.barrier !== undefined) bodies.push(node.barrier.back);
    return bodies;
  }

  #record(params: {
    kind: CascadeEventKind;
    family: HazardFamily;
    node: NodeRuntime;
    description: string;
    parents: readonly (string | undefined)[];
    failure?: { measured: number; limit: number; unit: string };
    bodies?: readonly Body[];
  }): string {
    const parents = params.parents.filter((p): p is string => p !== undefined);
    const id = this.#graph.record({
      tick: this.#tick,
      timeSec: this.#timeSec,
      kind: params.kind,
      family: params.family,
      componentId: params.node.componentId,
      description: params.description,
      parentIds: parents,
    });
    for (const body of params.bodies ?? [params.node.shell]) body.lastEventId = id;

    const system = FAILURE_LOG_KINDS[params.kind];
    if (system !== undefined) {
      const measured = params.failure?.measured ?? 1;
      const limit = params.failure?.limit ?? 1;
      this.#pendingFailures.push(
        Object.freeze({
          timestampSec: this.#timeSec,
          tick: this.#tick,
          componentId: params.node.componentId,
          system,
          failureType: params.kind.replace(/-/g, "_"),
          cause: `${params.description} [${id}]`,
          measuredValue: measured,
          limitValue: limit,
          unit: params.failure?.unit ?? "",
          utilization: limit !== 0 ? measured / limit : 1,
          loadPathComponentIds: Object.freeze([]),
        }),
      );
    }
    return id;
  }

  /** The event currently responsible for a body's condition, used to attribute what it passes on. */
  #causeOf(body: Body): string | undefined {
    return body.lastEventId ?? body.ledger.dominant();
  }

  /* ==================================================================================== *
   * A. Faults and structural hand-off
   * ==================================================================================== */

  #applyFaults(): void {
    const faults = this.#spec.faults ?? [];
    faults.forEach((fault, index) => {
      if (this.#faultsApplied.has(index) || this.#timeSec < fault.atTimeSec) return;
      const node = this.#nodes.get(fault.componentId);
      if (node === undefined) return;
      this.#faultsApplied.add(index);
      this.#applyFault(fault, node);
    });
  }

  #applyFault(fault: InducedFaultSpec, node: NodeRuntime): void {
    const describe = describeFault(fault);
    switch (fault.kind) {
      case "high-resistance-joint": {
        const conductor = node.electrical?.conductor;
        const id = this.#record({
          kind: "induced-fault",
          family: "electrical",
          node,
          description: describe,
          parents: [],
          bodies: conductor !== undefined ? [conductor.body] : [node.shell],
        });
        if (conductor !== undefined) {
          conductor.addedResistanceOhm += fault.addedResistanceOhm;
          conductor.jointFaultEventId = id;
        }
        return;
      }
      case "insulation-breakdown": {
        const conductor = node.electrical?.conductor;
        const id = this.#record({
          kind: "induced-fault",
          family: "electrical",
          node,
          description: describe,
          parents: [],
        });
        if (conductor !== undefined) this.#breakInsulation(node, conductor, [id]);
        return;
      }
      case "external-heat": {
        const id = this.#record({
          kind: "induced-fault",
          family: "thermal",
          node,
          description: describe,
          parents: [],
        });
        node.externalHeatSec = {
          untilSec: this.#timeSec + fault.durationSec,
          powerW: fault.powerW,
          eventId: id,
        };
        return;
      }
      case "pilot-flame": {
        const id = this.#record({
          kind: "induced-fault",
          family: "chemical",
          node,
          description: describe,
          parents: [],
        });
        node.pilotFault = { untilSec: this.#timeSec + fault.durationSec, eventId: id };
        return;
      }
      case "cell-internal-short": {
        const id = this.#record({
          kind: "induced-fault",
          family: "electrical",
          node,
          description: describe,
          parents: [],
        });
        const cell = node.battery?.cells[fault.cellIndex];
        if (cell !== undefined) this.#startInternalShort(node, cell, id);
        return;
      }
      case "loss-of-power": {
        const id = this.#record({
          kind: "induced-fault",
          family: "electrical",
          node,
          description: describe,
          parents: [],
        });
        const el = node.electrical;
        if (el === undefined) {
          node.powerFaultEventId = id;
          return;
        }
        if (el.spec.role === "load") el.forcedOffEventId = id;
        else {
          el.open = true;
          el.openEventId = id;
        }
        return;
      }
    }
  }

  #startInternalShort(node: NodeRuntime, cell: CellRuntime, causeId: string): void {
    const battery = node.battery!;
    const duration = battery.spec.internalShortDurationSec ?? 30;
    cell.shortRemainingJ = cell.storedEnergyJ;
    cell.shortPowerW = cell.storedEnergyJ / duration;
    cell.storedEnergyJ = 0;
    cell.body.lastEventId = causeId;
  }

  #handleStructuralFailures(failures: readonly FailureEvent[]): void {
    for (const failure of failures) {
      if (failure.failureType !== "yield_exceeded") continue;
      const node = this.#nodes.get(failure.componentId);
      if (node === undefined) continue;
      const factor = yieldStrengthFactorAt(node.material, node.shell.temperatureK);
      if (factor >= 1 || node.raised.has("support-yielded")) continue;
      node.raised.add("support-yielded");
      const id = this.#record({
        kind: "support-yielded",
        family: "mechanical",
        node,
        description:
          `Heated to ${formatTemperature(node.shell.temperatureK)}, ${node.material.name} keeps only ` +
          `${(factor * 100).toFixed(0)}% of its yield strength. The load it carries now exceeds what ` +
          `the hot section can hold (${formatQuantity(failure.measuredValue, "Pa")} against ` +
          `${formatQuantity(failure.limitValue, "Pa")}).`,
        parents: [this.#causeOf(node.shell)],
      });
      // Everything resting on the yielded member is displaced by this event.
      const queue = [...node.component.state.support.supportingComponentIds];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const above = queue.shift()!;
        if (seen.has(above)) continue;
        seen.add(above);
        const aboveNode = this.#nodes.get(above);
        if (aboveNode === undefined) continue;
        aboveNode.displacedCauseEventId ??= id;
        queue.push(...aboveNode.component.state.support.supportingComponentIds);
      }
    }
  }

  #checkFlanges(connections: readonly Connection[]): void {
    for (const connection of connections) {
      if (connection.type !== "coolant") continue;
      const a = this.#nodes.get(connection.from.componentId);
      const b = this.#nodes.get(connection.to.componentId);
      if (a === undefined || b === undefined) continue;
      const pipeNode = a.pipe !== undefined ? a : b.pipe !== undefined ? b : undefined;
      if (pipeNode === undefined || pipeNode.pipe!.breached) continue;
      const limit = pipeNode.spec?.pipe?.flangeSeparationLimitM;
      if (limit === undefined) continue;
      const pa = socketWorld(a.component, connection.from.connectionPointId);
      const pb = socketWorld(b.component, connection.to.connectionPointId);
      if (pa === undefined || pb === undefined) continue;
      const separation = Vec3Math.distance(pa, pb);
      if (!this.#designGapM.has(connection.id)) this.#designGapM.set(connection.id, separation);
      const gap = separation - this.#designGapM.get(connection.id)!;
      if (gap <= limit) continue;
      const cause = a.displacedCauseEventId ?? b.displacedCauseEventId;
      const pipe = pipeNode.pipe!;
      pipe.breached = true;
      pipe.breachDirection = Vec3Math.normalize(Vec3Math.subtract(pb, pa));
      pipe.breachEventId = this.#record({
        kind: "flange-separated",
        family: "pressure",
        node: pipeNode,
        description:
          `The flanged joint ${connection.id} has been pulled ${formatQuantity(gap, "m")} apart, beyond ` +
          `its ${formatQuantity(limit, "m")} limit, because the parts it joins moved. Coolant escapes.`,
        parents: [cause],
        failure: { measured: gap, limit, unit: "m" },
      });
    }
  }

  /* ==================================================================================== *
   * A. Electrical network
   * ==================================================================================== */

  #solveElectrical(dt: Seconds): void {
    const electricalIds = this.#sortedIds.filter(
      (id) => this.#nodes.get(id)!.electrical !== undefined,
    );
    if (electricalIds.length === 0) return;

    // Topology from the world's electrical connections. Radial: BFS from each source.
    const adjacency = new Map<ComponentId, ComponentId[]>();
    for (const id of electricalIds) adjacency.set(id, []);
    for (const node of electricalIds.map((id) => this.#nodes.get(id)!)) {
      for (const connection of node.component.connections) {
        if (connection.type !== "electrical") continue;
        const other =
          connection.from.componentId === node.componentId
            ? connection.to.componentId
            : connection.from.componentId;
        if (adjacency.has(other)) adjacency.get(node.componentId)!.push(other);
      }
    }
    for (const list of adjacency.values()) list.sort();

    const parent = new Map<ComponentId, ComponentId | null>();
    const sourceOf = new Map<ComponentId, ComponentId>();
    const order: ComponentId[] = [];
    for (const id of electricalIds) {
      if (this.#nodes.get(id)!.electrical!.spec.role !== "source" || parent.has(id)) continue;
      parent.set(id, null);
      sourceOf.set(id, id);
      const queue = [id];
      while (queue.length > 0) {
        const current = queue.shift()!;
        order.push(current);
        // Loads are leaves: power never flows through a load to reach another bus.
        if (current !== id && this.#nodes.get(current)!.electrical!.spec.role === "load") continue;
        for (const next of adjacency.get(current) ?? []) {
          if (parent.has(next)) continue;
          parent.set(next, current);
          sourceOf.set(next, id);
          queue.push(next);
        }
      }
    }

    const conducting = (id: ComponentId): boolean => {
      const el = this.#nodes.get(id)!.electrical!;
      return !el.open && !(el.conductor !== undefined && el.conductor.body.liquidFraction >= 1);
    };
    const pathCause = (id: ComponentId): string | undefined => {
      let cursor = parent.get(id) ?? null;
      while (cursor !== null) {
        const el = this.#nodes.get(cursor)!.electrical!;
        if (!conducting(cursor))
          return (
            el.openEventId ?? this.#causeOf(el.conductor?.body ?? this.#nodes.get(cursor)!.shell)
          );
        cursor = parent.get(cursor) ?? null;
      }
      return undefined;
    };

    // Energization.
    for (const id of electricalIds) {
      const el = this.#nodes.get(id)!.electrical!;
      el.currentA = 0;
      el.loadCurrentA = 0;
      el.faultCurrentCauses = [];
      if (!parent.has(id)) {
        el.energized = false;
        continue;
      }
      let ok = true;
      let cursor = parent.get(id) ?? null;
      while (cursor !== null) {
        if (!conducting(cursor)) ok = false;
        cursor = parent.get(cursor) ?? null;
      }
      el.energized = ok;
    }

    // Automatic transfer: a load with more than one feed draws from the first energized one.
    for (const id of electricalIds) {
      const el = this.#nodes.get(id)!.electrical!;
      if (el.spec.role !== "load" || el.energized) continue;
      for (const feed of adjacency.get(id) ?? []) {
        if (!parent.has(feed) || this.#nodes.get(feed)!.electrical!.spec.role === "load") continue;
        if (this.#nodes.get(feed)!.electrical!.energized && conducting(feed)) {
          parent.set(id, feed);
          sourceOf.set(id, sourceOf.get(feed)!);
          el.energized = true;
          break;
        }
      }
    }

    // Load currents (constant power at nominal source voltage) summed up the tree.
    const isLoad = (id: ComponentId) => this.#nodes.get(id)!.electrical!.spec.role === "load";
    const accumulation = [...order.filter(isLoad), ...order.filter((id) => !isLoad(id)).reverse()];
    for (const id of accumulation) {
      const node = this.#nodes.get(id)!;
      const el = node.electrical!;
      const source = this.#nodes.get(sourceOf.get(id)!)!.electrical!.spec as Extract<
        ElectricalSpec,
        { role: "source" }
      >;
      if (el.spec.role === "load") {
        const wasPowered = el.powered;
        el.powered = el.energized && el.forcedOffEventId === undefined;
        if (el.powered) el.currentA = el.spec.powerW / source.nominalVoltageV;
        if (wasPowered && !el.powered && el.powerLostEventId === undefined) {
          el.powerLostEventId = this.#record({
            kind: "power-lost",
            family: "electrical",
            node,
            description: `Supply to this ${formatQuantity(el.spec.powerW, "W")} load is interrupted upstream.`,
            parents: [el.forcedOffEventId ?? pathCause(id)],
          });
        }
      }
      const up = parent.get(id) ?? null;
      el.loadCurrentA = el.currentA;
      if (up !== null && conducting(id) && el.currentA > 0) {
        this.#nodes.get(up)!.electrical!.currentA += el.currentA;
      }
    }

    // Arcing faults: fault current from the source through every element up to the arc.
    for (const id of order) {
      const node = this.#nodes.get(id)!;
      const conductor = node.electrical!.conductor;
      if (conductor === undefined || !conductor.arcing) continue;
      const el = node.electrical!;
      if (!el.energized || !conducting(id)) {
        this.#extinguishArc(node, conductor, [pathCause(id) ?? el.openEventId]);
        continue;
      }
      const source = this.#nodes.get(sourceOf.get(id)!)!.electrical!.spec as Extract<
        ElectricalSpec,
        { role: "source" }
      >;
      let cursor: ComponentId | null = id;
      while (cursor !== null) {
        const e = this.#nodes.get(cursor)!.electrical!;
        e.currentA += source.arcingFaultCurrentA;
        if (conductor.arcEventId !== undefined) e.faultCurrentCauses.push(conductor.arcEventId);
        cursor = parent.get(cursor) ?? null;
      }
      this.#burnArc(node, conductor, source.arcVoltageV * source.arcingFaultCurrentA, dt);
    }

    // Protection: definite-time breakers.
    for (const id of order) {
      const node = this.#nodes.get(id)!;
      const el = node.electrical!;
      if (el.spec.role !== "breaker" || el.open) continue;
      if (el.currentA >= el.spec.pickupCurrentA) {
        el.breakerTimerSec += dt;
        if (el.breakerTimerSec + 1e-12 >= el.spec.tripDelaySec) {
          el.open = true;
          el.openEventId = this.#record({
            kind: "breaker-tripped",
            family: "electrical",
            node,
            description:
              `Current of ${formatQuantity(el.currentA, "A")} stayed above the ${formatQuantity(el.spec.pickupCurrentA, "A")} ` +
              `pickup for ${formatQuantity(el.spec.tripDelaySec, "s")}; the breaker opened and isolated everything downstream.`,
            parents: [...new Set(el.faultCurrentCauses)],
            failure: { measured: el.currentA, limit: el.spec.pickupCurrentA, unit: "A" },
          });
        }
      } else {
        el.breakerTimerSec = 0;
      }
    }

    // Resistive heating of conductors: I²R with copper's temperature coefficient.
    for (const id of order) {
      const node = this.#nodes.get(id)!;
      const el = node.electrical!;
      const conductor = el.conductor;
      if (conductor === undefined || el.currentA <= 0 || !conducting(id)) continue;
      const alpha = resistivityTemperatureCoefficientPerK(conductor.material.id);
      const rho =
        conductor.material.electricalResistivityOhmM *
        (1 + alpha * (conductor.body.temperatureK - celsiusToKelvin(20)));
      const r = (rho * conductor.spec.lengthM) / conductor.spec.conductorAreaM2;
      const loadA = el.loadCurrentA;
      const rTotal = r + conductor.addedResistanceOhm;
      const total = el.currentA * el.currentA * rTotal;
      const jointPart = loadA * loadA * conductor.addedResistanceOhm;
      const faultPart = Math.max(total - loadA * loadA * rTotal, 0);
      conductor.body.generationW += total;
      conductor.body.ledger.add(conductor.jointFaultEventId, jointPart * dt);
      const faultCauses = [...new Set(el.faultCurrentCauses)];
      for (const cause of faultCauses)
        conductor.body.ledger.add(cause, (faultPart * dt) / faultCauses.length);
    }
  }

  #breakInsulation(
    node: NodeRuntime,
    conductor: ConductorRuntime,
    parents: readonly (string | undefined)[],
  ): void {
    if (conductor.insulationState === "broken") return;
    conductor.insulationState = "broken";
    const limit = INSULATION_LIMITS[conductor.spec.insulation].shortCircuitK;
    const breakdown = this.#record({
      kind: "insulation-breakdown",
      family: "electrical",
      node,
      description:
        `${conductor.spec.insulation.toUpperCase()} insulation reached ${formatTemperature(conductor.body.temperatureK)}, ` +
        `past its ${formatTemperature(limit)} short-circuit limit (IEC 60949). It no longer separates the conductor from earth.`,
      parents,
      failure: { measured: conductor.body.temperatureK, limit, unit: "K" },
      bodies: [conductor.body],
    });
    if (node.electrical!.energized) {
      conductor.arcing = true;
      conductor.arcEventId = this.#record({
        kind: "arc-fault",
        family: "electrical",
        node,
        description: "An arcing fault strikes across the failed insulation.",
        parents: [breakdown],
        bodies: [conductor.body],
      });
    }
  }

  #burnArc(node: NodeRuntime, conductor: ConductorRuntime, arcPowerW: number, dt: Seconds): void {
    const energy = arcPowerW * dt;
    this.#graph.addEnergy(conductor.arcEventId, energy);
    node.exposure.electricalFaultExposureW += arcPowerW;

    // Electrode share erodes conductor metal: heat to melting plus latent heat, ejected molten.
    const m = conductor.material;
    const perKg =
      m.specificHeatJkgK * Math.max(m.meltingPointK - conductor.body.temperatureK, 0) +
      m.latentHeatOfFusionJkg;
    const erodedKg = (ARC_ELECTRODE_FRACTION * energy) / perKg;
    conductor.erodedKg += erodedKg;
    conductor.pendingEjectaKg += erodedKg;
    if (conductor.pendingEjectaKg >= DEBRIS_PARCEL_MASS_KG) {
      this.#spawnParcel({
        node,
        substance: m.id,
        massKg: conductor.pendingEjectaKg,
        temperatureK: m.meltingPointK,
        liquidFraction: 1,
        specificHeatJkgK: m.specificHeatJkgK,
        meltingPointK: m.meltingPointK,
        latentJkg: m.latentHeatOfFusionJkg,
        speedMps: 6,
        cause: conductor.arcEventId,
      });
      conductor.pendingEjectaKg = 0;
    }
    // Hot arc gas heats the conductor and its insulation directly.
    conductor.body.externalW += ARC_CONVECTIVE_FRACTION * arcPowerW;
    conductor.body.ledger.add(conductor.arcEventId, ARC_CONVECTIVE_FRACTION * energy);
    node.pilotPresent = true;
    node.pilotCauseEventId = conductor.arcEventId;

    if (conductor.erodedKg >= conductor.burnClearKg) {
      const el = node.electrical!;
      el.open = true;
      el.openEventId = this.#record({
        kind: "arc-extinguished",
        family: "electrical",
        node,
        description:
          `The uncleared arc consumed ${formatQuantity(conductor.erodedKg, "kg")} of conductor and burned the ` +
          `circuit open. Everything fed through it loses power.`,
        parents: [conductor.arcEventId],
        bodies: [conductor.body],
      });
      conductor.arcing = false;
    }
  }

  #extinguishArc(
    node: NodeRuntime,
    conductor: ConductorRuntime,
    parents: readonly (string | undefined)[],
  ): void {
    conductor.arcing = false;
    this.#record({
      kind: "arc-extinguished",
      family: "electrical",
      node,
      description: "The arc goes out: its supply has been isolated upstream.",
      parents,
      bodies: [conductor.body],
    });
  }

  /* ==================================================================================== *
   * A. Coolant loops, pumps, pipes
   * ==================================================================================== */

  #solveCoolant(dt: Seconds): void {
    if (this.#loops.size === 0) return;
    const pumpFlow = new Map<string, { flow: number; rated: number; cause: string | undefined }>();

    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const pumpSpec = node.spec?.pump;
      if (pumpSpec === undefined || node.pump === undefined) continue;
      const loop = this.#loops.get(pumpSpec.loopId);
      const el = node.electrical;
      const powered = this.#powered(node);
      const suction =
        loop !== undefined &&
        loop.inventoryKg > loop.spec.minimumInventoryFraction * loop.spec.inventoryKg;
      if (powered && suction) {
        node.pump.flowFraction = 1;
      } else {
        node.pump.flowFraction *= Math.exp(-dt / pumpSpec.coastdownTimeConstantSec);
        if (node.pump.stoppedEventId === undefined) {
          node.pump.stoppedEventId = this.#record({
            kind: "pump-stopped",
            family: "mechanical",
            node,
            description: powered
              ? "The pump has lost suction: there is not enough coolant left in the loop."
              : `The pump has lost power and is coasting down (time constant ${formatQuantity(pumpSpec.coastdownTimeConstantSec, "s")}).`,
            parents: [
              powered ? loop?.lowEventId : (el?.powerLostEventId ?? node.powerFaultEventId),
            ],
          });
        }
      }
      const entry = pumpFlow.get(pumpSpec.loopId) ?? { flow: 0, rated: 0, cause: undefined };
      entry.flow += node.pump.flowFraction * pumpSpec.ratedFlowKgPerSec;
      entry.rated += pumpSpec.ratedFlowKgPerSec;
      entry.cause ??= node.pump.stoppedEventId;
      pumpFlow.set(pumpSpec.loopId, entry);
    }

    for (const [loopId, loop] of this.#loops) {
      const entry = pumpFlow.get(loopId);
      loop.flowFraction = entry === undefined || entry.rated === 0 ? 1 : entry.flow / entry.rated;
      if (loop.flowFraction < 0.999) loop.flowCauseEventId ??= entry?.cause ?? loop.lowEventId;
    }

    // Pipes: pressure, cooling by flow, blowdown through a breach.
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const pipe = node.pipe;
      const spec = node.spec?.pipe;
      if (pipe === undefined || spec === undefined) continue;
      const loop = this.#loops.get(pipe.loopId);
      if (loop === undefined) continue;
      const loopIntact =
        loop.inventoryKg > loop.spec.minimumInventoryFraction * loop.spec.inventoryKg;
      const sat = waterSaturationPressurePa(node.shell.temperatureK);

      const loopPressure = loopIntact ? loop.spec.operatingPressurePa : STANDARD_ATMOSPHERE_PA;
      pipe.pressurePa =
        pipe.breached || spec.blockedIn !== true ? loopPressure : Math.max(loopPressure, sat);

      // Flow carries heat away; lost flow is a heat deficit attributed to whatever stopped it.
      const g = spec.flowCoolingWPerK * (loopIntact ? loop.flowFraction : 0);
      node.shell.coolingWPerK += g;
      node.shell.coolantTemperatureK = loop.spec.supplyTemperatureK;
      node.shell.coolingDeficitW +=
        (spec.flowCoolingWPerK - g) *
        Math.max(node.shell.temperatureK - loop.spec.supplyTemperatureK, 0);
      node.shell.coolingDeficitCause = loop.flowCauseEventId;

      if (pipe.breached && pipe.pressurePa > STANDARD_ATMOSPHERE_PA && loop.inventoryKg > 0) {
        const dp = pipe.pressurePa - STANDARD_ATMOSPHERE_PA;
        const cd = spec.dischargeCoefficient ?? 0.61;
        const mdot = cd * spec.breachAreaM2 * Math.sqrt(2 * WATER.densityKgM3 * dp);
        const lost = Math.min(mdot * dt, loop.inventoryKg);
        loop.inventoryKg -= lost;
        // What escapes is loop coolant (at least at supply temperature), flashing to steam
        // as it drops to atmospheric pressure: x = cp·(T − T_sat,atm) / h_fg.
        const coolantK = Math.max(node.shell.temperatureK, loop.spec.supplyTemperatureK);
        const flash = Math.min(
          Math.max(
            (WATER.specificHeatJkgK * (coolantK - celsiusToKelvin(100))) /
              WATER.latentHeatOfVaporizationJkg,
            0,
          ),
          1,
        );
        this.#releaseGas(node.centerM, "steam", flash * lost, pipe.breachEventId);
        this.#graph.addEnergy(pipe.breachEventId, 0.5 * lost * ((2 * dp) / WATER.densityKgM3));
      }
    }

    for (const loop of this.#loops.values()) {
      if (
        !loop.lowRaised &&
        loop.inventoryKg <= loop.spec.minimumInventoryFraction * loop.spec.inventoryKg
      ) {
        loop.lowRaised = true;
        const breachNode = this.#sortedIds
          .map((id) => this.#nodes.get(id)!)
          .find((n) => n.pipe?.loopId === loop.spec.id && n.pipe.breached);
        if (breachNode !== undefined) {
          loop.lowEventId = this.#record({
            kind: "coolant-inventory-low",
            family: "pressure",
            node: breachNode,
            description:
              `Loop "${loop.spec.id}" has lost coolant down to ${formatQuantity(loop.inventoryKg, "kg")}; ` +
              `pumps can no longer hold suction and the loop depressurizes.`,
            parents: [breachNode.pipe!.breachEventId],
          });
          loop.flowCauseEventId ??= loop.lowEventId;
        }
      }
      const intact = loop.inventoryKg > loop.spec.minimumInventoryFraction * loop.spec.inventoryKg;
      const effective = intact ? loop.flowFraction : 0;
      if (!loop.flowLostRaised && effective < 0.1) {
        loop.flowLostRaised = true;
        const anchor = this.#sortedIds
          .map((id) => this.#nodes.get(id)!)
          .find((n) => (n.spec?.pump?.loopId ?? n.spec?.pipe?.loopId) === loop.spec.id);
        if (anchor !== undefined) {
          const id = this.#record({
            kind: "coolant-flow-lost",
            family: "pressure",
            node: anchor,
            description: `Coolant flow in loop "${loop.spec.id}" has fallen below 10% of rated. Heat is no longer being carried away.`,
            parents: [loop.flowCauseEventId],
            failure: { measured: effective, limit: 0.1, unit: "" },
          });
          loop.flowCauseEventId = id;
        }
      }
    }

    // Cooled loads (reactor chamber, magnets' warm structure...).
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const spec = node.spec?.cooledLoad;
      if (spec === undefined) continue;
      const loop = this.#loops.get(spec.loopId);
      const intact =
        loop !== undefined &&
        loop.inventoryKg > loop.spec.minimumInventoryFraction * loop.spec.inventoryKg;
      const f = intact ? loop.flowFraction : 0;
      node.shell.generationW += spec.heatGenerationW;
      node.shell.coolingWPerK += spec.coolingWPerK * f;
      node.shell.coolantTemperatureK = loop?.spec.supplyTemperatureK ?? this.#ambientK;
      node.shell.coolingDeficitW +=
        spec.coolingWPerK *
        (1 - f) *
        Math.max(node.shell.temperatureK - node.shell.coolantTemperatureK, 0);
      node.shell.coolingDeficitCause = loop?.flowCauseEventId;
    }
  }

  /** Whether a machine has supply: its electrical load is powered and no fault cut it. */
  #powered(node: NodeRuntime): boolean {
    if (node.powerFaultEventId !== undefined) return false;
    const el = node.electrical;
    return el === undefined || el.spec.role !== "load" || el.powered;
  }

  /* ==================================================================================== *
   * A. Cryogenics and magnets
   * ==================================================================================== */

  #solveCryogenics(dt: Seconds): void {
    // Refrigeration available to each cryostat.
    const refrigeration = new Map<ComponentId, number>();
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const plant = node.spec?.cryoplant;
      if (plant === undefined) continue;
      const el = node.electrical;
      const powered = this.#powered(node);
      const target = this.#nodes.get(plant.cryostatComponentId);
      if (target?.cryostat === undefined) continue;
      if (powered) {
        refrigeration.set(
          plant.cryostatComponentId,
          (refrigeration.get(plant.cryostatComponentId) ?? 0) + plant.refrigerationW,
        );
      } else if (target.cryostat.refrigerationLostEventId === undefined) {
        target.cryostat.refrigerationLostEventId = this.#record({
          kind: "refrigeration-lost",
          family: "cryogenic",
          node: target,
          description: `The ${formatQuantity(plant.refrigerationW, "W")} cryoplant has lost power; heat leaking into the cold mass is no longer removed.`,
          parents: [el?.powerLostEventId ?? node.powerFaultEventId],
        });
      }
    }

    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const cryo = node.cryostat;
      const spec = node.spec?.cryostat;
      if (cryo === undefined || spec === undefined) continue;
      const leakW =
        spec.heatLeakConductanceWPerK *
        Math.max(node.shell.temperatureK - cryo.coldTemperatureK, 0);
      cryo.coldLedger.add(this.#causeOf(node.shell), leakW * dt);
      const refW = refrigeration.get(id) ?? 0;
      // Nominal refrigeration that is no longer delivered counts against the event that lost it.
      for (const plantId of this.#sortedIds) {
        const plant = this.#nodes.get(plantId)!.spec?.cryoplant;
        if (plant?.cryostatComponentId === id && !refrigeration.has(id)) {
          cryo.coldLedger.add(
            cryo.refrigerationLostEventId,
            Math.min(plant.refrigerationW, leakW) * dt,
          );
        }
      }

      // Magnet energy deposited in the coil this step.
      let magnetW = 0;
      for (const magnetId of this.#sortedIds) {
        const mNode = this.#nodes.get(magnetId)!;
        if (mNode.spec?.magnet?.cryostatComponentId === id && mNode.magnet !== undefined) {
          magnetW += this.#stepMagnet(mNode, dt, cryo);
        }
      }

      const netW = leakW + magnetW - refW;
      if (cryo.heliumKg > 0) {
        if (netW > 0) {
          const boilKg = Math.min((netW * dt) / HELIUM.latentHeatOfVaporizationJkg, cryo.heliumKg);
          cryo.heliumKg -= boilKg;
          this.#releaseGas(
            node.centerM,
            "helium",
            boilKg,
            cryo.refrigerationLostEventId ?? this.#causeOf(node.shell),
          );
          node.exposure.cryogenicExposureW +=
            (boilKg / dt) *
            HELIUM.gasSpecificHeatJkgK *
            (this.#ambientK - HELIUM.normalBoilingPointK);
        }
        if (cryo.heliumKg <= 0 && cryo.dryOutEventId === undefined) {
          cryo.dryOutEventId = this.#record({
            kind: "helium-dry-out",
            family: "cryogenic",
            node,
            description:
              `All ${formatQuantity(cryo.initialHeliumKg, "kg")} of liquid helium has boiled off. ` +
              `The cold mass is no longer held at ${formatTemperature(HELIUM.normalBoilingPointK)} and begins to warm.`,
            parents: cryo.coldLedger.parents(),
          });
        }
      } else {
        const enthalpy =
          copperCryogenicEnthalpyJkg(cryo.coldTemperatureK) + (netW * dt) / spec.coldMassKg;
        cryo.coldTemperatureK = Math.max(
          copperCryogenicTemperatureFromEnthalpyK(enthalpy),
          HELIUM.normalBoilingPointK,
        );
        if (!cryo.coldMeltRaised && cryo.coldTemperatureK >= getMaterial("copper").meltingPointK) {
          cryo.coldMeltRaised = true;
          this.#record({
            kind: "melted-through",
            family: "thermal",
            node,
            description:
              "The coil winding pack has reached copper's melting point: the magnet is burned out.",
            parents: [node.magnet?.quenchEventId ?? cryo.dryOutEventId],
          });
        }
      }

      // Quench check.
      for (const magnetId of this.#sortedIds) {
        const mNode = this.#nodes.get(magnetId)!;
        const mSpec = mNode.spec?.magnet;
        const magnet = mNode.magnet;
        if (mSpec?.cryostatComponentId !== id || magnet === undefined || magnet.quenched) continue;
        if (cryo.coldTemperatureK >= mSpec.currentSharingTemperatureK) {
          magnet.quenched = true;
          magnet.quenchEventId = this.#record({
            kind: "magnet-quench",
            family: "cryogenic",
            node: mNode,
            description:
              `The winding reached ${formatTemperature(cryo.coldTemperatureK)}, past its ${formatTemperature(mSpec.currentSharingTemperatureK)} ` +
              `current-sharing temperature. Superconductivity is lost; ${formatQuantity(mSpec.storedEnergyJ, "J")} of stored field energy must go somewhere.`,
            parents: [cryo.dryOutEventId ?? cryo.coldLedger.dominant()],
            failure: {
              measured: cryo.coldTemperatureK,
              limit: mSpec.currentSharingTemperatureK,
              unit: "K",
            },
          });
        }
      }
    }
  }

  /** Advances a magnet's current. Returns power deposited into its cold mass, W. */
  #stepMagnet(node: NodeRuntime, dt: Seconds, cryo: CryostatRuntime): number {
    const spec = node.spec!.magnet!;
    const magnet = node.magnet!;
    if (!magnet.quenched) return 0;
    magnet.sinceQuenchSec += dt;
    if (
      !magnet.dumping &&
      spec.dumpResistanceOhm > 0 &&
      magnet.sinceQuenchSec >= spec.quenchDetectionDelaySec
    ) {
      magnet.dumping = true;
      magnet.dumpEventId = this.#record({
        kind: "quench-dump",
        family: "electrical",
        node,
        description: `Quench detected; the dump switch opens and diverts the coil current into a ${formatQuantity(spec.dumpResistanceOhm, "ohm")} resistor outside the cryostat.`,
        parents: [magnet.quenchEventId],
      });
    }
    const inductanceH =
      (2 * spec.storedEnergyJ) / (spec.operatingCurrentA * spec.operatingCurrentA);
    const tau = magnet.dumping
      ? inductanceH / spec.dumpResistanceOhm
      : spec.unprotectedDecayTimeSec;
    const before = magnet.currentFraction;
    magnet.currentFraction = before * Math.exp(-dt / tau);
    const releasedJ =
      spec.storedEnergyJ * (before * before - magnet.currentFraction * magnet.currentFraction);
    if (magnet.dumping) {
      this.#graph.addEnergy(magnet.dumpEventId, releasedJ);
    } else {
      this.#graph.addEnergy(magnet.quenchEventId, releasedJ);
      cryo.coldLedger.add(magnet.quenchEventId, releasedJ);
    }
    if (magnet.currentFraction < 0.1 && magnet.fieldCollapsedEventId === undefined) {
      magnet.fieldCollapsedEventId = this.#record({
        kind: "field-collapsed",
        family: "electrical",
        node,
        description: "Coil current, and with it the magnetic field, has fallen below 10% of rated.",
        parents: [magnet.dumpEventId ?? magnet.quenchEventId],
      });
    }
    return magnet.dumping ? 0 : releasedJ / dt;
  }

  /* ==================================================================================== *
   * A. Plasma
   * ==================================================================================== */

  #solvePlasma(dt: Seconds): void {
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const plasma = node.plasma;
      const spec = node.spec?.plasma;
      if (plasma === undefined || spec === undefined) continue;
      if (plasma.state === "off" || plasma.state === "disrupted") continue;

      const magnetNode = this.#nodes.get(spec.magnetComponentId);
      const field = magnetNode?.magnet?.currentFraction ?? 1;
      const loop =
        node.spec?.cooledLoad !== undefined
          ? this.#loops.get(node.spec.cooledLoad.loopId)
          : undefined;
      const flow =
        loop === undefined
          ? 1
          : loop.inventoryKg > loop.spec.minimumInventoryFraction * loop.spec.inventoryKg
            ? loop.flowFraction
            : 0;

      // Confinement lost before the control system could act: disruption.
      if (field < spec.minimumFieldFraction) {
        this.#disrupt(node, spec, plasma, [
          magnetNode?.magnet?.fieldCollapsedEventId ?? magnetNode?.magnet?.quenchEventId,
        ]);
        continue;
      }

      const control = spec.controlledShutdown;
      if (plasma.state === "burning" && control !== undefined) {
        let trigger: string | undefined;
        let reason = "";
        if (
          control.onCoolantFlowFractionBelow !== undefined &&
          flow < control.onCoolantFlowFractionBelow
        ) {
          trigger = loop?.flowCauseEventId;
          reason = `coolant flow fell to ${(flow * 100).toFixed(0)}% of rated`;
        } else if (
          control.onFieldFractionBelow !== undefined &&
          field < control.onFieldFractionBelow
        ) {
          trigger = magnetNode?.magnet?.quenchEventId;
          reason = `the confining field fell to ${(field * 100).toFixed(0)}% of rated`;
        } else if (
          control.onWallTemperatureAboveK !== undefined &&
          node.shell.temperatureK > control.onWallTemperatureAboveK
        ) {
          trigger = this.#causeOf(node.shell);
          reason = `the wall reached ${formatTemperature(node.shell.temperatureK)}`;
        }
        if (reason !== "") {
          plasma.state = "ramping-down";
          plasma.rampRateJps = plasma.energyJ / control.rampDownSec;
          plasma.endEventId = this.#record({
            kind: "plasma-controlled-shutdown",
            family: "plasma",
            node,
            description: `The plasma control system began a controlled ramp-down because ${reason}.`,
            parents: [trigger],
          });
        }
      }

      if (plasma.state === "ramping-down") {
        plasma.energyJ = Math.max(plasma.energyJ - plasma.rampRateJps * dt, 0);
        if (plasma.energyJ <= 0) plasma.state = "off";
      }
      const fraction = plasma.energyJ / spec.storedThermalEnergyJ;
      node.shell.generationW += spec.wallHeatingW * fraction;
    }
  }

  #disrupt(
    node: NodeRuntime,
    spec: NonNullable<CascadeNodeSpec["plasma"]>,
    plasma: PlasmaRuntime,
    parents: readonly (string | undefined)[],
  ): void {
    const energy = plasma.energyJ;
    plasma.state = "disrupted";
    plasma.energyJ = 0;
    const wettedM2 = Math.max(node.surfaceAreaM2 * spec.disruptionWettedAreaFraction, 1e-6);
    const fluxWm2 = energy / (wettedM2 * spec.thermalQuenchDurationSec);
    const surfaceK =
      node.shell.temperatureK +
      semiInfiniteSurfaceRiseK(fluxWm2, spec.thermalQuenchDurationSec, node.material);
    const id = this.#record({
      kind: "plasma-disruption",
      family: "plasma",
      node,
      description:
        `Confinement is lost. ${formatQuantity(energy, "J")} of plasma thermal energy hits ` +
        `${formatQuantity(wettedM2, "m^2")} of wall in ${formatQuantity(spec.thermalQuenchDurationSec, "s")} ` +
        `(${formatQuantity(fluxWm2, "W/m^2")}), raising the wetted surface to about ${formatTemperature(surfaceK)}.`,
      parents,
      failure: { measured: fluxWm2, limit: 0, unit: "W/m^2" },
    });
    this.#graph.addEnergy(id, energy);
    plasma.endEventId = id;
    node.shell.externalW += energy / this.#dtFallback();
    node.shell.ledger.add(id, energy);
    node.exposure.plasmaHeatFluxWm2 = fluxWm2;
    this.#pendingHazards.push(
      this.#hazard({
        kind: "plasma-wall-heat",
        node,
        causalEventId: id,
        originM: node.centerM,
        radiantPowerW: 0,
        convectivePowerW: 0,
        reachM: 0,
        sourceRadiusM: halfDiagonal(node.box),
        substance: "plasma",
        ignitionSource: false,
        durationSec: spec.thermalQuenchDurationSec,
      }),
    );
    if (surfaceK >= node.material.meltingPointK) {
      this.#record({
        kind: "first-wall-melted",
        family: "plasma",
        node,
        description:
          `The disruption heat load melts the ${node.material.name} first wall locally: the surface reaches ` +
          `${formatTemperature(surfaceK)} against a ${formatTemperature(node.material.meltingPointK)} melting point. ` +
          `Only a thin layer melts; the bulk of the component stays solid.`,
        parents: [id],
        failure: { measured: surfaceK, limit: node.material.meltingPointK, unit: "K" },
      });
    }
  }

  #lastDt = 1 / 60;
  #dtFallback(): number {
    return this.#lastDt;
  }

  /* ==================================================================================== *
   * B. Hazard emissions from state
   * ==================================================================================== */

  #deriveHazards(dt: Seconds): HazardEmission[] {
    this.#lastDt = dt;
    const hazards: HazardEmission[] = [...this.#pendingHazards];
    this.#pendingHazards = [];

    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const top = vec3(node.centerM.x, node.box.maxM.y, node.centerM.z);

      // Hot surfaces radiate. Barriers radiate from their unexposed face.
      const radiating = node.barrier !== undefined ? node.barrier.back : node.shell;
      const surfaceK = radiating.temperatureK;
      if (surfaceK - this.#ambientK > RADIANT_SURFACE_THRESHOLD_K) {
        const area =
          node.barrier !== undefined ? node.barrier.back.ambientAreaM2 : node.surfaceAreaM2;
        const power =
          node.material.emissivity *
          STEFAN_BOLTZMANN_W_M2K4 *
          area *
          (surfaceK ** 4 - this.#ambientK ** 4);
        hazards.push(
          this.#hazard({
            kind: "radiant-surface",
            node,
            causalEventId: this.#causeOf(radiating),
            originM: node.centerM,
            radiantPowerW: power,
            convectivePowerW: 0,
            reachM: radiantReach(power),
            sourceRadiusM: halfDiagonal(node.box) / 2,
            substance: node.material.id,
            // A hot surface ignites only gas that touches it; that is handled by the
            // enclosure's surface-ignition check, not by radiating at things nearby.
            ignitionSource: false,
            gasTemperatureK: surfaceK,
          }),
        );
      }

      // Burning combustibles: flame with radiant and plume parts.
      const comb = node.combustible;
      if (comb?.state === "burning") this.#burnCombustible(node, comb, top, dt, hazards);
      const insulation =
        node.electrical?.conductor !== undefined ? this.#insulationFuel(node) : undefined;
      if (insulation?.state === "burning")
        this.#burnCombustible(node, insulation, top, dt, hazards);

      // Arcs.
      const conductor = node.electrical?.conductor;
      if (conductor?.arcing === true) {
        const sourceSpec = this.#arcSourceSpec(node);
        const powerW =
          sourceSpec === undefined ? 0 : sourceSpec.arcVoltageV * sourceSpec.arcingFaultCurrentA;
        let radiant = ARC_RADIANT_FRACTION * powerW;
        if (node.closedShell) {
          // An arc inside a closed cabinet radiates into the cabinet's own walls.
          node.shell.externalW += radiant;
          node.shell.ledger.add(conductor.arcEventId, radiant * dt);
          radiant = 0;
        }
        hazards.push(
          this.#hazard({
            kind: "electric-arc",
            node,
            causalEventId: conductor.arcEventId,
            originM: node.centerM,
            radiantPowerW: radiant,
            convectivePowerW: 0,
            reachM: Math.max(radiantReach(radiant), PILOT_CONTACT_M),
            sourceRadiusM: 0.2,
            substance: conductor.material.id,
            ignitionSource: true,
          }),
        );
      }

      // Battery venting and runaway.
      if (node.battery !== undefined) this.#batteryEmissions(node, top, dt, hazards);

      // Pipe breach jets.
      const pipe = node.pipe;
      if (pipe?.breached === true && pipe.pressurePa > STANDARD_ATMOSPHERE_PA) {
        const loop = this.#loops.get(pipe.loopId);
        if (loop !== undefined && loop.inventoryKg > 0) {
          const spec = node.spec!.pipe!;
          const dp = pipe.pressurePa - STANDARD_ATMOSPHERE_PA;
          const velocity = Math.sqrt((2 * dp) / WATER.densityKgM3);
          const mdot =
            (spec.dischargeCoefficient ?? 0.61) * spec.breachAreaM2 * WATER.densityKgM3 * velocity;
          const steamK = Math.min(
            node.shell.temperatureK,
            waterSaturationTemperatureK(pipe.pressurePa),
          );
          hazards.push(
            this.#hazard({
              kind: "fluid-jet",
              node,
              causalEventId: pipe.breachEventId,
              originM: node.centerM,
              directionM: pipe.breachDirection,
              radiantPowerW: 0,
              convectivePowerW:
                mdot * WATER.specificHeatJkgK * Math.max(steamK - this.#ambientK, 0),
              reachM: Math.min(velocity * 0.5, 15),
              sourceRadiusM: Math.sqrt(spec.breachAreaM2 / Math.PI),
              substance: "steam",
              ignitionSource: false,
              gasTemperatureK: steamK,
              massFlowKgPerSec: mdot,
              jetForceN: mdot * velocity,
            }),
          );
        }
      }

      // Burning plasma radiates neutrons and gammas.
      const plasma = node.plasma;
      const plasmaSpec = node.spec?.plasma;
      if (
        plasma !== undefined &&
        plasmaSpec?.radiationPowerW !== undefined &&
        plasma.state !== "off" &&
        plasma.state !== "disrupted"
      ) {
        const power =
          plasmaSpec.radiationPowerW * (plasma.energyJ / plasmaSpec.storedThermalEnergyJ);
        hazards.push(
          this.#hazard({
            kind: "radiation-heating",
            node,
            causalEventId: undefined,
            originM: node.centerM,
            radiantPowerW: power,
            convectivePowerW: 0,
            reachM: radiantReach(power),
            sourceRadiusM: halfDiagonal(node.box) / 2,
            substance: "neutron",
            ignitionSource: false,
          }),
        );
      }

      // Cryogenic boil-off.
      if (node.cryostat !== undefined && node.exposure.cryogenicExposureW > 0) {
        hazards.push(
          this.#hazard({
            kind: "cryogenic-gas",
            node,
            causalEventId: node.cryostat.refrigerationLostEventId ?? node.magnet?.quenchEventId,
            originM: vec3(node.centerM.x, node.box.minM.y, node.centerM.z),
            radiantPowerW: 0,
            convectivePowerW: -node.exposure.cryogenicExposureW,
            reachM: halfDiagonal(node.box) + 2,
            sourceRadiusM: halfDiagonal(node.box) / 2,
            substance: "helium",
            ignitionSource: false,
            gasTemperatureK: HELIUM.normalBoilingPointK,
          }),
        );
      }
    }
    return hazards;
  }

  #insulationFuel(node: NodeRuntime): CombustibleRuntime | undefined {
    return node.electrical?.conductor?.insulationFuel;
  }

  #arcSourceSpec(node: NodeRuntime): Extract<ElectricalSpec, { role: "source" }> | undefined {
    // Walk electrical links to the nearest source (the arc's supply).
    const seen = new Set<ComponentId>([node.componentId]);
    const queue = [node.componentId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const current = this.#nodes.get(id)!;
      if (current.electrical?.spec.role === "source") return current.electrical.spec;
      for (const c of current.component.connections) {
        if (c.type !== "electrical") continue;
        const other = c.from.componentId === id ? c.to.componentId : c.from.componentId;
        if (seen.has(other) || this.#nodes.get(other)?.electrical === undefined) continue;
        seen.add(other);
        queue.push(other);
      }
    }
    return undefined;
  }

  #burnCombustible(
    node: NodeRuntime,
    comb: CombustibleRuntime,
    top: Vec3,
    dt: Seconds,
    hazards: HazardEmission[],
  ): void {
    const rate = Math.min(
      comb.data.massBurningRateKgM2s * comb.burningAreaM2,
      comb.remainingKg / dt,
    );
    comb.remainingKg -= rate * dt;
    comb.heatReleaseRateW = rate * comb.data.heatOfCombustionJkg;
    this.#graph.addEnergy(comb.ignitionEventId, comb.heatReleaseRateW * dt);
    this.#releaseGas(top, "smoke", comb.data.smokeYield * rate * dt, comb.ignitionEventId);
    const radiant = comb.data.radiativeFraction * comb.heatReleaseRateW;
    const flameRadius = Math.sqrt(comb.burningAreaM2 / Math.PI);
    hazards.push(
      this.#hazard({
        kind: "flame",
        node,
        causalEventId: comb.ignitionEventId,
        originM: top,
        radiantPowerW: radiant,
        convectivePowerW: comb.heatReleaseRateW - radiant,
        reachM: Math.max(radiantReach(radiant), plumeReach(comb.heatReleaseRateW - radiant)),
        sourceRadiusM: flameRadius,
        substance: comb.data.name,
        ignitionSource: true,
        gasTemperatureK: this.#ambientK + CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K,
      }),
    );
    hazards.push(
      this.#hazard({
        kind: "smoke",
        node,
        causalEventId: comb.ignitionEventId,
        originM: vec3(top.x, top.y + flameRadius, top.z),
        radiantPowerW: 0,
        convectivePowerW: 0,
        reachM: 0,
        sourceRadiusM: flameRadius,
        substance: "smoke",
        ignitionSource: false,
        massFlowKgPerSec: comb.data.smokeYield * rate,
      }),
    );
    // The flame engulfs the burning item itself (EN 1991-1-2 exposure, wetted area).
    const wetted = Math.min(comb.burningAreaM2, node.surfaceAreaM2 / 2);
    const flameK = this.#ambientK + CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K;
    const selfW = Math.max(
      wetted *
        (FIRE_EXPOSED_CONVECTION_W_M2K * (flameK - comb.body.temperatureK) +
          STEFAN_BOLTZMANN_W_M2K4 * (flameK ** 4 - comb.body.temperatureK ** 4)),
      0,
    );
    comb.body.externalW += selfW;
    comb.body.ledger.add(comb.ignitionEventId, selfW * dt);
    if (comb.remainingKg <= 1e-9) {
      comb.state = "burned-out";
      comb.heatReleaseRateW = 0;
      this.#record({
        kind: "burned-out",
        family: "chemical",
        node,
        description: `The ${comb.data.name} has burned out; the fire on this component ends for lack of fuel.`,
        parents: [comb.ignitionEventId],
        bodies: [comb.body],
      });
    }
  }

  #batteryEmissions(node: NodeRuntime, top: Vec3, dt: Seconds, hazards: HazardEmission[]): void {
    const battery = node.battery!;
    const chem = battery.chemistry;
    let gasKg = 0;
    let gasEnthalpyW = 0;
    let gasTemperatureK = this.#ambientK;
    let cause: string | undefined;
    for (const cell of battery.cells) {
      if (cell.state !== "runaway" || cell.ventGasRemainingKg <= 0) continue;
      const rate = (battery.spec.cellMassKg * chem.ventGasMassFraction) / chem.runawayDurationSec;
      const kg = Math.min(rate * dt, cell.ventGasRemainingKg);
      cell.ventGasRemainingKg -= kg;
      gasKg += kg;
      gasEnthalpyW +=
        (kg / dt) *
        chem.ventGasSpecificHeatJkgK *
        Math.max(cell.body.temperatureK - this.#ambientK, 0);
      gasTemperatureK = Math.max(gasTemperatureK, cell.body.temperatureK);
      cause ??= cell.runawayEventId;
    }
    if (gasKg <= 0) return;
    const pilot = node.pilotPresent || this.#nodePilot(node);
    const ignites = gasTemperatureK >= chem.ventGas.autoIgnitionTemperatureK || pilot;
    if (ignites) {
      const hrr = (gasKg / dt) * chem.ventGas.heatOfCombustionJkg;
      const radiant = 0.3 * hrr;
      this.#graph.addEnergy(cause, hrr * dt);
      hazards.push(
        this.#hazard({
          kind: "flame",
          node,
          causalEventId: cause,
          originM: top,
          radiantPowerW: radiant,
          convectivePowerW: hrr - radiant + gasEnthalpyW,
          reachM: Math.max(radiantReach(radiant), plumeReach(hrr - radiant)),
          sourceRadiusM: 0.3,
          substance: chem.ventGas.name,
          ignitionSource: true,
          gasTemperatureK: this.#ambientK + CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K,
          massFlowKgPerSec: gasKg / dt,
        }),
      );
      // A jet fire at the vent plays straight back onto the cabinet.
      node.shell.externalW += 0.3 * hrr;
      node.shell.ledger.add(cause, 0.3 * hrr * dt);
      if (!battery.raised.has("vent-fire")) {
        battery.raised.add("vent-fire");
        this.#record({
          kind: "ignition",
          family: "chemical",
          node,
          description:
            gasTemperatureK >= chem.ventGas.autoIgnitionTemperatureK
              ? `Vent gas leaves the cells at ${formatTemperature(gasTemperatureK)}, above its ${formatTemperature(chem.ventGas.autoIgnitionTemperatureK)} auto-ignition temperature, and burns as a jet fire.`
              : "Vent gas meets an ignition source at the cabinet and burns as a jet fire.",
          parents: [cause, pilot ? node.pilotCauseEventId : undefined],
        });
      }
    } else {
      this.#releaseGas(top, "battery-vent-gas", gasKg, cause);
      hazards.push(
        this.#hazard({
          kind: "hot-gas",
          node,
          causalEventId: cause,
          originM: top,
          radiantPowerW: 0,
          convectivePowerW: gasEnthalpyW,
          reachM: plumeReach(gasEnthalpyW),
          sourceRadiusM: 0.3,
          substance: chem.ventGas.name,
          ignitionSource: false,
          gasTemperatureK,
          massFlowKgPerSec: gasKg / dt,
        }),
      );
    }
  }

  #nodePilot(node: NodeRuntime): boolean {
    for (const hazard of this.#hazards) {
      if (!hazard.ignitionSource || hazard.sourceComponentId === node.componentId) continue;
      if (distanceToAabb(hazard.originM, node.box) <= hazard.sourceRadiusM + PILOT_CONTACT_M) {
        node.pilotCauseEventId ??= hazard.causalEventId;
        return true;
      }
    }
    return false;
  }

  #hazard(params: {
    kind: HazardKind;
    node: NodeRuntime;
    causalEventId: string | undefined;
    originM: Vec3;
    directionM?: Vec3;
    radiantPowerW: number;
    convectivePowerW: number;
    reachM: number;
    sourceRadiusM: number;
    substance: string;
    ignitionSource: boolean;
    gasTemperatureK?: Kelvin;
    massFlowKgPerSec?: number;
    jetForceN?: number;
    overpressurePa?: number;
    durationSec?: Seconds;
  }): HazardEmission {
    const { node, ...rest } = params;
    const contours = REFERENCE_FLUX_LEVELS_WM2.map((fluxWm2) => ({
      fluxWm2,
      radiusM: Math.sqrt(params.radiantPowerW / (4 * Math.PI * fluxWm2)),
    })).filter((c) => c.radiusM > params.sourceRadiusM);
    return Object.freeze({
      ...rest,
      ...(params.radiantPowerW > 0 && contours.length > 0
        ? { radiantContoursM: Object.freeze(contours) }
        : {}),
      id: `${params.kind}:${node.componentId}`,
      family: familyOf(params.kind),
      sourceComponentId: node.componentId,
      causalEventId: params.causalEventId ?? "",
      startTimeSec: this.#timeSec,
    });
  }

  /* ==================================================================================== *
   * C. Spatial propagation
   * ==================================================================================== */

  #propagate(hazards: readonly HazardEmission[], dt: Seconds): void {
    const barriers = this.#sortedIds
      .map((id) => this.#nodes.get(id)!)
      .filter((n) => n.barrier !== undefined && !n.barrier.failed);

    for (const hazard of hazards) {
      const cause = hazard.causalEventId === "" ? undefined : hazard.causalEventId;
      if (
        hazard.kind === "pressure-wave" ||
        hazard.kind === "smoke" ||
        hazard.kind === "plasma-wall-heat"
      ) {
        if (hazard.kind === "pressure-wave") this.#applyPressureWave(hazard);
        continue;
      }
      if (hazard.reachM <= 0) continue;

      for (const targetId of this.#hash.querySphere(hazard.originM, hazard.reachM)) {
        if (targetId === hazard.sourceComponentId) continue;
        const target = this.#nodes.get(targetId)!;

        if (
          hazard.ignitionSource &&
          distanceToAabb(hazard.originM, target.box) <= hazard.sourceRadiusM + PILOT_CONTACT_M
        ) {
          target.pilotPresent = true;
          target.pilotCauseEventId ??= cause;
        }

        const shielded = barriers.some(
          (b) =>
            b.componentId !== targetId &&
            b.componentId !== hazard.sourceComponentId &&
            segmentIntersectsAabb(hazard.originM, target.centerM, b.box),
        );

        // Radiation: point source, Cauchy projected area A/4, gray absorptivity = emissivity.
        if (hazard.radiantPowerW > 0 && !shielded) {
          const d = Math.max(
            distanceToAabb(hazard.originM, target.box),
            hazard.sourceRadiusM,
            MIN_RADIANT_DISTANCE_M,
          );
          const flux = hazard.radiantPowerW / (4 * Math.PI * d * d);
          const absorptivity = hazard.kind === "radiation-heating" ? 1 : target.material.emissivity;
          const intercepted = Math.min(flux * (target.surfaceAreaM2 / 4), hazard.radiantPowerW / 2);
          const absorbed = absorptivity * intercepted;
          if (hazard.kind === "radiation-heating") {
            target.exposure.radiationExposureJ += absorbed * dt;
          } else {
            target.exposure.radiantHeatFluxWm2 += absorptivity * flux;
          }
          this.#deliverHeat(target, absorbed, cause, dt);
        }

        // Buoyant plume / hot gas: only targets above the source, inside the plume.
        if (
          hazard.convectivePowerW > 0 &&
          (hazard.kind === "flame" || hazard.kind === "hot-gas" || hazard.kind === "electric-arc")
        ) {
          const z = target.centerM.y - hazard.originM.y;
          if (z > 0.1) {
            const horizontal = Math.hypot(
              Math.max(
                target.box.minM.x - hazard.originM.x,
                0,
                hazard.originM.x - target.box.maxM.x,
              ),
              Math.max(
                target.box.minM.z - hazard.originM.z,
                0,
                hazard.originM.z - target.box.maxM.z,
              ),
            );
            const plumeRadius = hazard.sourceRadiusM + 0.15 * z;
            if (horizontal <= plumeRadius) {
              const excess = plumeExcessK(hazard.convectivePowerW, z);
              const gasK = this.#ambientK + excess;
              target.exposure.hotGasTemperatureK = Math.max(
                target.exposure.hotGasTemperatureK,
                gasK,
              );
              if (excess >= CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K * 0.9)
                target.exposure.flameExposure = true;
              // Only the part of the target's footprint the plume covers is immersed.
              const width = 2 * plumeRadius;
              const coverX = Math.min(
                1,
                width / Math.max(target.box.maxM.x - target.box.minM.x, 1e-6),
              );
              const coverZ = Math.min(
                1,
                width / Math.max(target.box.maxM.z - target.box.minM.z, 1e-6),
              );
              const immersedM2 = (target.surfaceAreaM2 / 2) * coverX * coverZ;
              // EN 1991-1-2 §3.1 net heat flux to a member in hot gas: convection plus gas
              // radiation with flame emissivity 1 and radiation temperature = gas temperature.
              const ts = target.shell.temperatureK;
              const qConv = FIRE_EXPOSED_CONVECTION_W_M2K * immersedM2 * (gasK - ts);
              const qRad =
                target.material.emissivity *
                STEFAN_BOLTZMANN_W_M2K4 *
                immersedM2 *
                (gasK ** 4 - ts ** 4);
              target.exposure.convectiveHeatW += Math.max(qConv, 0);
              this.#deliverHeat(target, Math.max(qConv + qRad, 0), cause, dt);
            }
          }
        }

        // Jets: momentum load and steam heating inside a 15° cone.
        if (hazard.kind === "fluid-jet" && hazard.directionM !== undefined) {
          const to = Vec3Math.subtract(target.centerM, hazard.originM);
          const d = Vec3Math.length(to);
          const cos = d > 0 ? Vec3Math.dot(to, hazard.directionM) / d : 0;
          if (cos > Math.cos((15 * Math.PI) / 180)) {
            const spot = Math.PI * (d * Math.tan((15 * Math.PI) / 180)) ** 2;
            const share = Math.min(1, target.surfaceAreaM2 / 4 / Math.max(spot, 1e-6));
            target.exposure.fluidJetLoadN += (hazard.jetForceN ?? 0) * share;
            const gasK = hazard.gasTemperatureK ?? this.#ambientK;
            const q =
              FIRE_EXPOSED_CONVECTION_W_M2K *
              (target.surfaceAreaM2 / 2) *
              Math.max(gasK - target.shell.temperatureK, 0) *
              share;
            target.exposure.convectiveHeatW += q;
            this.#deliverHeat(target, q, cause, dt);
          }
        }

        // Cryogenic gas: cooling of nearby surfaces.
        if (hazard.kind === "cryogenic-gas") {
          const d = Math.max(distanceToAabb(hazard.originM, target.box), MIN_RADIANT_DISTANCE_M);
          const share = Math.min(target.surfaceAreaM2 / 4 / (4 * Math.PI * d * d), 0.5);
          const coolingW = -hazard.convectivePowerW * share;
          target.exposure.cryogenicExposureW += coolingW;
          target.shell.externalW -= coolingW;
        }
      }

      if (hazard.kind === "electric-arc" && hazard.sourceComponentId !== undefined) {
        const source = this.#nodes.get(hazard.sourceComponentId)!;
        source.pilotPresent = true;
        source.pilotCauseEventId ??= cause;
      }
    }

    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const enclosure = this.#enclosureAt(node.centerM);
      if (enclosure !== undefined)
        node.exposure.chemicalGasExposure = this.#flammableFraction(enclosure);
    }
  }

  #deliverHeat(target: NodeRuntime, watts: number, cause: string | undefined, dt: Seconds): void {
    if (!(watts > 0)) return;
    target.shell.externalW += watts;
    target.shell.ledger.add(cause, watts * dt);
  }

  #applyPressureWave(hazard: HazardEmission): void {
    for (const id of this.#hash.querySphere(hazard.originM, hazard.reachM)) {
      const target = this.#nodes.get(id)!;
      const p = hazard.overpressurePa ?? 0;
      target.exposure.peakOverpressurePa = Math.max(target.exposure.peakOverpressurePa, p);
      target.exposure.pressureImpulsePaS += p * (hazard.durationSec ?? 0);
      const barrier = target.barrier;
      const capacity = target.spec?.barrier?.overpressureCapacityPa;
      if (barrier !== undefined && !barrier.failed && capacity !== undefined && p > capacity) {
        barrier.failed = true;
        this.#record({
          kind: "barrier-failed",
          family: "pressure",
          node: target,
          description: `An overpressure of ${formatQuantity(p, "Pa")} exceeds the barrier's ${formatQuantity(capacity, "Pa")} rating; it no longer separates the spaces on either side.`,
          parents: [hazard.causalEventId],
          failure: { measured: p, limit: capacity, unit: "Pa" },
        });
      }
    }
  }

  /* ==================================================================================== *
   * D. Hot debris and molten parcels
   * ==================================================================================== */

  #spawnParcel(params: {
    node: NodeRuntime;
    substance: string;
    massKg: number;
    temperatureK: Kelvin;
    liquidFraction: number;
    specificHeatJkgK: number;
    meltingPointK: number;
    latentJkg: number;
    speedMps: number;
    cause: string | undefined;
  }): void {
    if (this.#parcels.length >= MAX_DEBRIS_PARCELS) return;
    this.#parcelCounter += 1;
    // Deterministic launch directions on a golden-angle spiral: no randomness anywhere.
    const angle = this.#parcelCounter * 2.399_963_229_728_653;
    const elevation = 0.35 + 0.3 * ((this.#parcelCounter * 0.618_033_988_75) % 1);
    const horizontal = Math.sqrt(1 - elevation * elevation);
    const direction = vec3(Math.cos(angle) * horizontal, elevation, Math.sin(angle) * horizontal);
    const node = params.node;
    this.#parcels.push({
      id: `debris-${this.#parcelCounter}`,
      substance: params.substance,
      massKg: params.massKg,
      specificHeatJkgK: params.specificHeatJkgK,
      meltingPointK: params.meltingPointK,
      latentJkg: params.latentJkg,
      temperatureK: params.temperatureK,
      liquidFraction: params.liquidFraction,
      positionM: vec3(node.centerM.x, node.box.maxM.y + 0.05, node.centerM.z),
      velocityMps: Vec3Math.scale(direction, params.speedMps),
      sourceComponentId: node.componentId,
      causalEventId: params.cause,
    });
  }

  #moveDebris(ctx: CascadeStepContext, dt: Seconds): void {
    const survivors: Parcel[] = [];
    for (const parcel of this.#parcels) {
      parcel.velocityMps = vec3(
        parcel.velocityMps.x,
        parcel.velocityMps.y - ctx.gravityMps2 * dt,
        parcel.velocityMps.z,
      );
      parcel.positionM = Vec3Math.add(parcel.positionM, Vec3Math.scale(parcel.velocityMps, dt));
      if (parcel.positionM.y <= ctx.groundLevelM) continue;

      const hit = this.#hash
        .querySphere(parcel.positionM, 0.05)
        .find((id) => id !== parcel.sourceComponentId);
      if (hit === undefined) {
        survivors.push(parcel);
        continue;
      }
      const target = this.#nodes.get(hit)!;
      const speed = Vec3Math.length(parcel.velocityMps);
      const impactJ = 0.5 * parcel.massKg * speed * speed;
      target.exposure.debrisImpactEnergyJ += impactJ;
      // Upper bound: the parcel sticks and cools to the target temperature.
      const heatJ =
        Math.max(
          parcel.massKg *
            parcel.specificHeatJkgK *
            (parcel.temperatureK - target.shell.temperatureK),
          0,
        ) +
        parcel.liquidFraction * parcel.massKg * parcel.latentJkg;
      this.#deliverHeat(target, heatJ / dt, parcel.causalEventId, dt);
      if (target.battery !== undefined && impactJ > target.battery.spec.crushToleranceJ) {
        const cell = target.battery.cells[Math.floor(target.battery.cells.length / 2)]!;
        if (cell.storedEnergyJ > 0) {
          const id = this.#record({
            kind: "cell-mechanical-damage",
            family: "mechanical",
            node: target,
            description: `A ${formatQuantity(parcel.massKg, "kg")} fragment strikes the module with ${formatQuantity(impactJ, "J")}, more than the ${formatQuantity(target.battery.spec.crushToleranceJ, "J")} a cell tolerates. An internal short begins.`,
            parents: [parcel.causalEventId],
          });
          this.#startInternalShort(target, cell, id);
        }
      }
    }
    this.#parcels = survivors;
  }

  /* ==================================================================================== *
   * E. Thermal solve
   * ==================================================================================== */

  #linkConduction(connections: readonly Connection[]): void {
    if (this.#geometryChanged) {
      this.#conductionLinks = [];
      for (const connection of connections) {
        const a = this.#nodes.get(connection.from.componentId);
        const b = this.#nodes.get(connection.to.componentId);
        if (a === undefined || b === undefined) continue;
        const pa = socketWorld(a.component, connection.from.connectionPointId);
        const pb = socketWorld(b.component, connection.to.connectionPointId);
        // Parts whose joint has been pulled apart no longer conduct into each other.
        if (pa === undefined || pb === undefined || Vec3Math.distance(pa, pb) > 0.5) continue;
        const k = harmonicMean(
          a.material.thermalConductivityWmK,
          b.material.thermalConductivityWmK,
        );
        const area = Math.min(
          minSectionM2(a.component.geometry),
          minSectionM2(b.component.geometry),
        );
        const length = Math.max(Vec3Math.distance(a.centerM, b.centerM), 0.1);
        this.#conductionLinks.push({ a: a.shell, b: b.shell, g: (k * area) / length });
      }
    }
    for (const { a, b, g } of this.#conductionLinks) {
      a.links.push({ other: b, conductanceWPerK: g });
      b.links.push({ other: a, conductanceWPerK: g });
    }
  }

  /** Model-specific heat: battery chemistry, combustion feedback, pyrolysis, external heaters. */
  #applyModelHeat(dt: Seconds): void {
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      if (node.externalHeatSec !== undefined && this.#timeSec < node.externalHeatSec.untilSec) {
        node.shell.externalW += node.externalHeatSec.powerW;
        node.shell.ledger.add(node.externalHeatSec.eventId, node.externalHeatSec.powerW * dt);
      }
      const battery = node.battery;
      if (battery !== undefined) {
        const chem = battery.chemistry;
        for (const cell of battery.cells) {
          const body = cell.body;
          if (cell.state !== "runaway" && cell.state !== "burned-out") {
            // Self-heating: adiabatic rate A·exp(−B/T) times the cell's heat capacity.
            const selfW =
              body.capacityJK *
              battery.arrheniusA *
              Math.exp(-battery.arrheniusB / body.temperatureK);
            body.generationW += selfW;
            if (body.temperatureK >= chem.selfHeatingOnsetK)
              body.ledger.add(body.lastEventId, selfW * dt);
          }
          if (cell.shortRemainingJ > 0) {
            const e = Math.min(cell.shortPowerW * dt, cell.shortRemainingJ);
            cell.shortRemainingJ -= e;
            body.generationW += e / dt;
            body.ledger.add(body.lastEventId, e);
          }
          if (cell.state === "runaway" && cell.runawayRemainingJ > 0) {
            const total =
              battery.spec.cellMassKg *
              chem.cellSpecificHeatJkgK *
              (chem.runawayMaxK - chem.runawayTriggerK);
            const e = Math.min((total / chem.runawayDurationSec) * dt, cell.runawayRemainingJ);
            cell.runawayRemainingJ -= e;
            body.generationW += e / dt;
            this.#graph.addEnergy(cell.runawayEventId, e);
          }
        }
      }
      // Pyrolysis / evaporation: above decomposition, a share of the absorbed heat gasifies
      // fuel instead of raising temperature, growing linearly to all of it at the auto-
      // ignition temperature. Piloted ignition (lower) stays reachable; without a pilot,
      // fuel approaches but never passes auto-ignition, as evaporation caps it. REDUCED.
      for (const comb of [
        node.combustible,
        node.electrical?.conductor !== undefined ? this.#insulationFuel(node) : undefined,
      ]) {
        if (comb === undefined || comb.state !== "decomposing") continue;
        const d = comb.data;
        const s = clamp01(
          (comb.body.temperatureK - d.decompositionTemperatureK) /
            (d.autoIgnitionTemperatureK - d.decompositionTemperatureK),
        );
        const gasifyW = Math.max(comb.body.externalW, 0) * s;
        const kg = Math.min((gasifyW * dt) / d.heatOfGasificationJkg, comb.remainingKg);
        comb.remainingKg -= kg;
        comb.body.externalW -= (kg * d.heatOfGasificationJkg) / dt;
        this.#releaseGas(node.centerM, "pyrolyzate", kg, comb.body.lastEventId);
      }
    }
  }

  #solveThermal(dt: Seconds): void {
    const bodies: Body[] = [];
    for (const id of this.#sortedIds) bodies.push(...this.#bodiesOf(this.#nodes.get(id)!));
    const ambient = this.#ambientK;

    // Barrier internal conduction through the insulation layer.
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const spec = node.spec?.barrier;
      if (node.barrier === undefined || spec === undefined) continue;
      const g =
        (spec.insulationConductivityWmK * largestFaceAreaM2(node.component.geometry)) /
        spec.insulationThicknessM;
      if (!node.shell.links.some((l) => l.other === node.barrier!.back)) {
        link(node.shell, node.barrier.back, g);
      }
    }

    // Lost cooling is blamed only for heat that actually arrived and would have been carried
    // away: flow cannot remove more than comes in.
    for (const body of bodies) {
      const arriving = Math.max(body.externalW + body.generationW, 0);
      body.ledger.add(body.coolingDeficitCause, Math.min(body.coolingDeficitW, arriving) * dt);
    }

    // Attribute conduction before temperatures change (energy flowing in from a hotter body).
    for (const body of bodies) {
      for (const l of body.links) {
        const flowW = l.conductanceWPerK * (l.other.temperatureK - body.temperatureK);
        if (flowW > 0) {
          body.ledger.add(this.#causeOf(l.other), flowW * dt);
          if (l.other.componentId !== body.componentId) {
            this.#nodes.get(body.componentId)!.exposure.conductiveHeatW += flowW;
          }
        }
      }
    }

    // Implicit in each body's own temperature, explicit in its neighbours': stable for any
    // conductance at the fixed step, because every row is diagonally dominant.
    const next = new Map<Body, number>();
    for (const body of bodies) {
      const t = body.temperatureK;
      const hRad =
        body.emissivity * STEFAN_BOLTZMANN_W_M2K4 * (t * t + ambient * ambient) * (t + ambient);
      const gAmb = body.ambientAreaM2 * (AMBIENT_CONVECTION_W_M2K + hRad);
      let gLinks = 0;
      let linkFlux = 0;
      for (const l of body.links) {
        gLinks += l.conductanceWPerK;
        linkFlux += l.conductanceWPerK * l.other.temperatureK;
      }
      const numerator =
        body.capacityJK * t +
        dt *
          (body.externalW +
            body.generationW +
            linkFlux +
            gAmb * ambient +
            body.coolingWPerK * body.coolantTemperatureK);
      const denominator = body.capacityJK + dt * (gLinks + gAmb + body.coolingWPerK);
      next.set(body, numerator / denominator);
    }
    for (const body of bodies) {
      applyPhaseChange(body, next.get(body)!);
      body.peakTemperatureK = Math.max(body.peakTemperatureK, body.temperatureK);
    }

    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      node.exposure.heatFluxWm2 =
        Math.max(node.shell.externalW, 0) / Math.max(node.surfaceAreaM2, 1e-9);
    }
  }

  /* ==================================================================================== *
   * E. Gas accumulation
   * ==================================================================================== */

  #enclosureAt(point: Vec3): EnclosureRuntime | undefined {
    return this.#enclosures.find(
      (e) =>
        point.x >= e.box.minM.x &&
        point.x <= e.box.maxM.x &&
        point.y >= e.box.minM.y &&
        point.y <= e.box.maxM.y &&
        point.z >= e.box.minM.z &&
        point.z <= e.box.maxM.z,
    );
  }

  #releaseGas(point: Vec3, family: GasFamily, massKg: number, cause: string | undefined): void {
    if (!(massKg > 0)) return;
    const enclosure = this.#enclosureAt(point);
    if (enclosure === undefined) return; // released to open air and dispersed
    enclosure.gasKg[family] += massKg;
    if (GAS_FAMILIES[family].flammable) enclosure.ledger.add(cause, massKg);
  }

  #airMoles(enclosure: EnclosureRuntime): number {
    return (STANDARD_ATMOSPHERE_PA * enclosure.volumeM3) / (GAS_CONSTANT_J_MOLK * this.#ambientK);
  }

  #flammableFraction(enclosure: EnclosureRuntime): number {
    let flammable = 0;
    for (const family of GAS_FAMILY_IDS) {
      if (GAS_FAMILIES[family].flammable)
        flammable += enclosure.gasKg[family] / GAS_FAMILIES[family].molarMassKgMol;
    }
    return flammable / this.#airMoles(enclosure);
  }

  /** Le Chatelier mixing rule for the lower flammability limit of the flammable mixture. */
  #mixtureLfl(enclosure: EnclosureRuntime): number {
    let total = 0;
    let sum = 0;
    for (const family of GAS_FAMILY_IDS) {
      const data = GAS_FAMILIES[family];
      if (!data.flammable) continue;
      const moles = enclosure.gasKg[family] / data.molarMassKgMol;
      total += moles;
      sum += moles / data.lowerFlammabilityLimit;
    }
    return total > 0 && sum > 0 ? total / sum : 1;
  }

  #solveGas(dt: Seconds): void {
    for (const enclosure of this.#enclosures) {
      enclosure.overpressurePa = 0;
      const removal = Math.min((enclosure.spec.airChangesPerHour / 3600) * dt, 1);
      for (const family of GAS_FAMILY_IDS) enclosure.gasKg[family] *= 1 - removal;

      const fraction = this.#flammableFraction(enclosure);
      const lfl = this.#mixtureLfl(enclosure);
      const anchor = this.#sortedIds
        .map((id) => this.#nodes.get(id)!)
        .find((n) => this.#enclosureAt(n.centerM) === enclosure);
      if (anchor === undefined) continue;
      if (fraction < lfl) continue;

      if (enclosure.flammableEventId === undefined) {
        enclosure.flammableEventId = this.#record({
          kind: "gas-flammable",
          family: "chemical",
          node: anchor,
          description:
            `Released gas in enclosure "${enclosure.spec.id}" has reached ${(fraction * 100).toFixed(1)}% by volume, ` +
            `above the mixture's ${(lfl * 100).toFixed(1)}% lower flammability limit. It will burn if it finds an ignition source.`,
          parents: enclosure.ledger.parents(),
        });
      }

      // Ignition sources inside the enclosure: an ignition-capable hazard, or a surface
      // hotter than the gas's auto-ignition temperature.
      let igniter: string | undefined;
      let ignited = false;
      for (const hazard of this.#hazards) {
        if (hazard.ignitionSource && this.#enclosureAt(hazard.originM) === enclosure) {
          ignited = true;
          igniter = hazard.causalEventId || undefined;
          break;
        }
      }
      if (!ignited) {
        for (const id of this.#sortedIds) {
          const node = this.#nodes.get(id)!;
          if (this.#enclosureAt(node.centerM) !== enclosure) continue;
          if (
            node.shell.temperatureK >= GAS_FAMILIES["battery-vent-gas"].autoIgnitionTemperatureK
          ) {
            ignited = true;
            igniter = this.#causeOf(node.shell);
            break;
          }
        }
      }
      if (!ignited) continue;

      let energyJ = 0;
      for (const family of GAS_FAMILY_IDS) {
        const data = GAS_FAMILIES[family];
        if (!data.flammable) continue;
        energyJ += enclosure.gasKg[family] * data.heatOfCombustionJkg;
        enclosure.gasKg[family] = 0;
      }
      // Constant-volume adiabatic combustion in an ideal gas: ΔP = (γ − 1)·E / V.
      const ideal = ((AIR_HEAT_CAPACITY_RATIO - 1) * energyJ) / enclosure.volumeM3;
      const overpressure =
        enclosure.spec.ventReliefPressurePa !== undefined
          ? Math.min(ideal, enclosure.spec.ventReliefPressurePa)
          : ideal;
      enclosure.overpressurePa = overpressure;
      const id = this.#record({
        kind: "deflagration",
        family: "pressure",
        node: anchor,
        description:
          `The flammable mixture in "${enclosure.spec.id}" ignites. ${formatQuantity(energyJ, "J")} released in ` +
          `${formatQuantity(enclosure.volumeM3, "m^3")} gives a constant-volume pressure rise of ${formatQuantity(ideal, "Pa")}` +
          (overpressure < ideal
            ? `, relieved by vent panels to ${formatQuantity(overpressure, "Pa")}.`
            : "."),
        parents: [enclosure.flammableEventId, igniter],
        failure: { measured: overpressure, limit: 0, unit: "Pa" },
      });
      this.#graph.addEnergy(id, energyJ);
      const size = Vec3Math.subtract(enclosure.spec.maxM, enclosure.spec.minM);
      const center = aabbCenter(enclosure.box);
      const reach = Vec3Math.length(size) / 2;
      const durationSec = Math.cbrt(enclosure.volumeM3) / 10;
      const wave = this.#hazard({
        kind: "pressure-wave",
        node: anchor,
        causalEventId: id,
        originM: center,
        radiantPowerW: 0,
        convectivePowerW: 0,
        reachM: reach,
        sourceRadiusM: reach,
        substance: "combustion products",
        ignitionSource: true,
        overpressurePa: overpressure,
        durationSec,
      });
      const fireball = this.#hazard({
        kind: "flame",
        node: anchor,
        causalEventId: id,
        originM: center,
        radiantPowerW: (0.3 * energyJ) / durationSec,
        convectivePowerW: 0,
        reachM: reach,
        sourceRadiusM: Math.cbrt(enclosure.volumeM3) / 2,
        substance: "deflagration",
        ignitionSource: true,
        durationSec,
      });
      this.#pendingHazards.push(wave, fireball);
      this.#applyPressureWave(wave);
    }
  }

  /* ==================================================================================== *
   * F + G. Thresholds
   * ==================================================================================== */

  #evaluateThresholds(): void {
    for (const id of this.#sortedIds) {
      const node = this.#nodes.get(id)!;
      const shell = node.shell;

      // Generic material limits. Melting is solid -> liquid; it never releases gas.
      if (
        !node.raised.has("overheated") &&
        shell.temperatureK > node.material.maxOperatingTemperatureK
      ) {
        node.raised.add("overheated");
        this.#record({
          kind: "overheated",
          family: "thermal",
          node,
          description: `${node.material.name} reached ${formatTemperature(shell.temperatureK)}, above the ${formatTemperature(node.material.maxOperatingTemperatureK)} at which it keeps its room-temperature properties.`,
          parents: shell.ledger.parents(),
        });
      }
      const factor = yieldStrengthFactorAt(node.material, shell.temperatureK);
      const carries =
        node.component.state.support.supportingComponentIds.length > 0 || node.pipe !== undefined;
      if (carries && !node.raised.has("strength-reduced") && factor < 0.5) {
        node.raised.add("strength-reduced");
        this.#record({
          kind: "strength-reduced",
          family: "thermal",
          node,
          description: `At ${formatTemperature(shell.temperatureK)} the ${node.material.name} keeps only ${(factor * 100).toFixed(0)}% of its room-temperature yield strength.`,
          parents: shell.ledger.parents(),
        });
      }
      if (!node.raised.has("melting-began") && shell.liquidFraction > 0) {
        node.raised.add("melting-began");
        this.#record({
          kind: "melting-began",
          family: "thermal",
          node,
          description: `${node.material.name} has reached its ${formatTemperature(node.material.meltingPointK)} melting point and is turning liquid. Melting absorbs latent heat; it produces no gas.`,
          parents: shell.ledger.parents(),
        });
      }
      if (!node.raised.has("melted-through") && shell.liquidFraction >= 1) {
        node.raised.add("melted-through");
        this.#record({
          kind: "melted-through",
          family: "thermal",
          node,
          description: `The component's ${node.material.name} is fully molten and has lost all strength.`,
          parents: [shell.lastEventId],
          failure: { measured: shell.temperatureK, limit: node.material.meltingPointK, unit: "K" },
        });
      }

      // Conductors and their insulation.
      const conductor = node.electrical?.conductor;
      if (conductor !== undefined) {
        const limits = INSULATION_LIMITS[conductor.spec.insulation];
        const t = conductor.body.temperatureK;
        if (conductor.insulationState === "ok" && t > limits.continuousK) {
          conductor.insulationState = "overheated";
          const current = node.electrical!.currentA;
          this.#record({
            kind: "conductor-overheated",
            family: "electrical",
            node,
            description:
              `Carrying ${formatQuantity(current, "A")}` +
              (conductor.addedResistanceOhm > 0
                ? ` through a joint with ${formatQuantity(conductor.addedResistanceOhm, "ohm")} of extra resistance`
                : "") +
              `, the conductor reached ${formatTemperature(t)}, above the ${formatTemperature(limits.continuousK)} continuous rating of its ${conductor.spec.insulation.toUpperCase()} insulation.`,
            parents: conductor.body.ledger.parents(),
            bodies: [conductor.body],
          });
        }
        if (conductor.insulationState !== "broken" && t >= limits.shortCircuitK) {
          this.#breakInsulation(node, conductor, [
            conductor.body.lastEventId,
            ...conductor.body.ledger.parents(),
          ]);
        }
        if (!node.raised.has("conductor-melted") && conductor.body.liquidFraction >= 1) {
          node.raised.add("conductor-melted");
          const el = node.electrical!;
          el.open = true;
          el.openEventId = this.#record({
            kind: "melted-through",
            family: "electrical",
            node,
            description: "The conductor has melted through; the circuit is open.",
            parents: conductor.body.ledger.parents(),
            bodies: [conductor.body],
          });
        }
      }

      // Combustibles: decomposition and ignition.
      for (const comb of [
        node.combustible,
        conductor !== undefined ? this.#insulationFuel(node) : undefined,
      ]) {
        if (comb === undefined) continue;
        const t = comb.body.temperatureK;
        const d = comb.data;
        if (comb.state === "intact" && t >= d.decompositionTemperatureK) {
          comb.state = "decomposing";
          this.#record({
            kind: "decomposition",
            family: "chemical",
            node,
            description: `${d.name} reached ${formatTemperature(t)} and has begun to decompose, releasing smoke and combustible vapour.`,
            parents: comb.body.ledger.parents(),
            bodies: [comb.body],
          });
        }
        const pilot = node.pilotPresent;
        if (
          (comb.state === "intact" || comb.state === "decomposing") &&
          comb.remainingKg > 0 &&
          ((pilot && t >= d.pilotedIgnitionTemperatureK) || t >= d.autoIgnitionTemperatureK)
        ) {
          comb.state = "burning";
          comb.ignitionEventId = this.#record({
            kind: "ignition",
            family: "chemical",
            node,
            description:
              pilot && t < d.autoIgnitionTemperatureK
                ? `${d.name} at ${formatTemperature(t)} is above its ${formatTemperature(d.pilotedIgnitionTemperatureK)} piloted ignition temperature and a flame or arc is in contact. It ignites.`
                : `${d.name} at ${formatTemperature(t)} is above its ${formatTemperature(d.autoIgnitionTemperatureK)} auto-ignition temperature. It ignites.`,
            parents: [...comb.body.ledger.parents(), pilot ? node.pilotCauseEventId : undefined],
            failure: {
              measured: t,
              limit: pilot ? d.pilotedIgnitionTemperatureK : d.autoIgnitionTemperatureK,
              unit: "K",
            },
            bodies: [comb.body],
          });
        }
      }

      if (node.battery !== undefined) this.#batteryThresholds(node);
      if (node.pipe !== undefined) this.#pipeThresholds(node);

      // Barriers: EN 1363-1 insulation criterion, average unexposed rise of 140 K.
      const barrier = node.barrier;
      if (barrier !== undefined) {
        if (!barrier.insulationFailedRaised && barrier.back.temperatureK - this.#ambientK > 140) {
          barrier.insulationFailedRaised = true;
          this.#record({
            kind: "barrier-failed",
            family: "thermal",
            node,
            description: `The unexposed face of the barrier has risen ${formatQuantity(barrier.back.temperatureK - this.#ambientK, "K")} above ambient, past the 140 K insulation criterion (EN 1363-1). Heat now passes through.`,
            parents: shell.ledger.parents(),
            failure: {
              measured: barrier.back.temperatureK - this.#ambientK,
              limit: 140,
              unit: "K",
            },
            bodies: [barrier.back],
          });
        }
        if (!barrier.failed && shell.liquidFraction >= 1) barrier.failed = true;
      }
    }
  }

  #batteryThresholds(node: NodeRuntime): void {
    const battery = node.battery!;
    const chem = battery.chemistry;
    battery.cells.forEach((cell, index) => {
      const t = cell.body.temperatureK;
      const label = `cell ${index + 1} of ${battery.cells.length}`;
      if (cell.state === "normal" && t > chem.maxOperatingTemperatureK) {
        cell.state = "heated";
        if (!battery.raised.has("heated")) {
          battery.raised.add("heated");
          this.#record({
            kind: "battery-heated",
            family: "thermal",
            node,
            description: `${chem.name} ${label} reached ${formatTemperature(t)}, above its ${formatTemperature(chem.maxOperatingTemperatureK)} operating limit.`,
            parents: cell.body.ledger.parents(),
            bodies: [cell.body],
          });
        }
      }
      if (
        (cell.state === "normal" || cell.state === "heated") &&
        t >= chem.ventOpeningTemperatureK
      ) {
        cell.state = "venting";
        this.#releaseGas(
          node.centerM,
          "battery-vent-gas",
          battery.spec.cellMassKg * chem.ventOpeningGasMassFraction,
          cell.body.lastEventId,
        );
        if (!battery.raised.has("vent")) {
          battery.raised.add("vent");
          this.#record({
            kind: "battery-vent-opened",
            family: "chemical",
            node,
            description: `The safety vent of ${label} opened at ${formatTemperature(t)}, releasing electrolyte vapour. This is not yet thermal runaway.`,
            parents: cell.body.ledger.parents(),
            bodies: [cell.body],
          });
        }
      }
      if (
        cell.state !== "runaway" &&
        cell.state !== "burned-out" &&
        t >= chem.selfHeatingOnsetK &&
        !battery.raised.has(`self-${index}`)
      ) {
        battery.raised.add(`self-${index}`);
        if (!battery.raised.has("self")) {
          battery.raised.add("self");
          this.#record({
            kind: "battery-self-heating",
            family: "chemical",
            node,
            description: `${label} passed ${formatTemperature(chem.selfHeatingOnsetK)} (T1): its own decomposition reactions now generate heat faster than 0.02 K/min.`,
            parents: cell.body.ledger.parents(),
            bodies: [cell.body],
          });
        }
      }
      if (cell.state !== "runaway" && cell.state !== "burned-out" && t >= chem.runawayTriggerK) {
        cell.state = "runaway";
        // T3 is measured on charged cells, so it already includes the electrochemical
        // energy. Whatever an internal short had not yet released is part of the runaway.
        cell.shortRemainingJ = 0;
        cell.storedEnergyJ = 0;
        cell.runawayRemainingJ =
          battery.spec.cellMassKg *
          chem.cellSpecificHeatJkgK *
          (chem.runawayMaxK - chem.runawayTriggerK);
        cell.ventGasRemainingKg = battery.spec.cellMassKg * chem.ventGasMassFraction;
        const first = battery.cells.every((c) => c === cell || c.runawayEventId === undefined);
        cell.runawayEventId = this.#record({
          kind: first ? "thermal-runaway" : "runaway-propagated",
          family: "thermal",
          node,
          description: first
            ? `${label} reached ${formatTemperature(t)} (T2): self-heating now exceeds 1 K/s. Thermal runaway will drive it toward ${formatTemperature(chem.runawayMaxK)}, venting flammable gas.`
            : `Heat from neighbouring cells drove ${label} past ${formatTemperature(chem.runawayTriggerK)}: runaway has propagated.`,
          parents:
            cell.body.ledger.parents().length > 0
              ? cell.body.ledger.parents()
              : [cell.body.lastEventId],
          failure: { measured: t, limit: chem.runawayTriggerK, unit: "K" },
          bodies: [cell.body],
        });
        const ejectaKg = battery.spec.cellMassKg * chem.ejectaMassFraction;
        if (ejectaKg >= DEBRIS_PARCEL_MASS_KG / 4) {
          this.#spawnParcel({
            node,
            substance: "battery-ejecta",
            massKg: ejectaKg,
            temperatureK: chem.runawayMaxK,
            liquidFraction: 0,
            specificHeatJkgK: chem.cellSpecificHeatJkgK,
            meltingPointK: Infinity,
            latentJkg: 0,
            speedMps: 8,
            cause: cell.runawayEventId,
          });
        }
      }
      if (cell.state === "runaway" && cell.runawayRemainingJ <= 0 && cell.ventGasRemainingKg <= 0) {
        cell.state = "burned-out";
      }
    });
    if (!battery.raised.has("burned-out") && battery.cells.every((c) => c.state === "burned-out")) {
      battery.raised.add("burned-out");
      this.#record({
        kind: "battery-burned-out",
        family: "thermal",
        node,
        description: "Every cell in the module has gone through runaway. The module is spent.",
        parents: [battery.cells[battery.cells.length - 1]!.runawayEventId],
      });
    }
  }

  /** Converts heat above `saturationK` into steam while water remains. */
  #boilOff(node: NodeRuntime, saturationK: Kelvin, toRoom: boolean): void {
    const pipe = node.pipe!;
    if (pipe.waterKg <= 0 || node.shell.temperatureK <= saturationK) return;
    const excessJ = (node.shell.temperatureK - saturationK) * node.shell.capacityJK;
    const steamKg = Math.min(excessJ / WATER.latentHeatOfVaporizationJkg, pipe.waterKg);
    pipe.waterKg -= steamKg;
    node.shell.capacityJK = Math.max(node.shell.capacityJK - steamKg * WATER.specificHeatJkgK, 1);
    node.shell.temperatureK =
      steamKg * WATER.latentHeatOfVaporizationJkg >= excessJ
        ? saturationK
        : saturationK +
          (excessJ - steamKg * WATER.latentHeatOfVaporizationJkg) / node.shell.capacityJK;
    if (toRoom) this.#releaseGas(node.centerM, "steam", steamKg, node.shell.lastEventId);
  }

  #pipeThresholds(node: NodeRuntime): void {
    const pipe = node.pipe!;
    const spec = node.spec!.pipe!;
    const geometry = node.component.geometry;
    if (pipe.breached || geometry.kind !== "cylinder" || geometry.wallThicknessM === undefined) {
      pipe.hoopUtilization = 0;
      return;
    }
    // An open line cannot exceed loop pressure: water above saturation boils off into the
    // loop, taking latent heat with it, until the section is dry.
    if (spec.blockedIn !== true) {
      this.#boilOff(node, waterSaturationTemperatureK(pipe.pressurePa), false);
    }
    // Relief: holds pressure at the set point by venting steam; venting removes the
    // energy that would otherwise raise the water temperature further.
    if (spec.reliefSetPressurePa !== undefined && pipe.pressurePa > spec.reliefSetPressurePa) {
      this.#boilOff(node, waterSaturationTemperatureK(spec.reliefSetPressurePa), true);
      pipe.pressurePa = spec.reliefSetPressurePa;
      if (!pipe.reliefOpen) {
        pipe.reliefOpen = true;
        this.#record({
          kind: "relief-valve-opened",
          family: "pressure",
          node,
          description: `Heated water raised the pressure past the ${formatQuantity(spec.reliefSetPressurePa, "Pa")} relief setting; the valve lifts and vents steam, capping the pressure.`,
          parents: node.shell.ledger.parents(),
        });
      }
    }
    const t = geometry.wallThicknessM;
    const meanRadius = geometry.radiusM - t / 2;
    const hoopPa = (pipe.pressurePa * meanRadius) / t;
    const allowable =
      node.material.yieldStrengthPa * yieldStrengthFactorAt(node.material, node.shell.temperatureK);
    pipe.hoopUtilization = allowable > 0 ? hoopPa / allowable : Infinity;
    if (pipe.hoopUtilization > 1) {
      pipe.breached = true;
      // The wall opens on the side facing whatever heated it.
      const heatSource = this.#hazards.find(
        (h) => h.causalEventId === node.shell.ledger.dominant(),
      );
      pipe.breachDirection =
        heatSource !== undefined
          ? Vec3Math.normalize(Vec3Math.subtract(heatSource.originM, node.centerM))
          : vec3(0, -1, 0);
      pipe.breachEventId = this.#record({
        kind: "pipe-ruptured",
        family: "pressure",
        node,
        description:
          `At ${formatTemperature(node.shell.temperatureK)} the ${node.material.name} wall keeps ` +
          `${formatQuantity(allowable, "Pa")} of yield strength, but ${formatQuantity(pipe.pressurePa, "Pa")} of internal ` +
          `pressure puts ${formatQuantity(hoopPa, "Pa")} of hoop stress (P·r/t) on it. The wall ruptures.`,
        parents: node.shell.ledger.parents(),
        failure: { measured: hoopPa, limit: allowable, unit: "Pa" },
      });
    }
  }

  /* ==================================================================================== *
   * Snapshot helpers
   * ==================================================================================== */

  #nodeState(node: NodeRuntime): CascadeNodeState {
    const conditions: string[] = [];
    const comb = node.combustible;
    const insulation =
      node.electrical?.conductor !== undefined ? this.#insulationFuel(node) : undefined;
    if (comb?.state === "burning" || insulation?.state === "burning") conditions.push("burning");
    if (comb?.state === "decomposing" || insulation?.state === "decomposing")
      conditions.push("smoking");
    if (node.electrical?.conductor?.arcing === true) conditions.push("arcing");
    if (node.battery?.cells.some((c) => c.state === "runaway") === true) conditions.push("runaway");
    if (node.battery?.cells.some((c) => c.state === "venting") === true) conditions.push("venting");
    if (node.pipe?.breached === true) conditions.push("breached");
    if (node.pipe?.reliefOpen === true) conditions.push("relieving");
    if (node.magnet?.quenched === true) conditions.push("quenched");
    if (node.cryostat !== undefined && node.cryostat.heliumKg < node.cryostat.initialHeliumKg)
      conditions.push("boiling-off");
    if (node.plasma !== undefined) conditions.push(`plasma-${node.plasma.state}`);
    if (node.shell.liquidFraction > 0) conditions.push("molten");
    if (node.shell.temperatureK > celsiusToKelvin(525)) conditions.push("incandescent");

    const state: CascadeNodeState = {
      componentId: node.componentId,
      temperatureK: node.shell.temperatureK,
      peakTemperatureK: node.shell.peakTemperatureK,
      liquidFraction: node.shell.liquidFraction,
      yieldStrengthFactor: yieldStrengthFactorAt(node.material, node.shell.temperatureK),
      conditions: Object.freeze(conditions),
      ...(node.battery !== undefined
        ? {
            battery: Object.freeze({
              cellTemperaturesK: Object.freeze(node.battery.cells.map((c) => c.body.temperatureK)),
              cellStates: Object.freeze(node.battery.cells.map((c) => c.state)),
            }),
          }
        : {}),
      ...(comb !== undefined || insulation !== undefined
        ? {
            combustible: Object.freeze({
              state: (comb ?? insulation)!.state,
              remainingMassKg: (comb ?? insulation)!.remainingKg,
              heatReleaseRateW: (comb?.heatReleaseRateW ?? 0) + (insulation?.heatReleaseRateW ?? 0),
            }),
          }
        : {}),
      ...(node.electrical !== undefined
        ? {
            electrical: Object.freeze({
              energized: node.electrical.energized,
              currentA: node.electrical.currentA,
              arcing: node.electrical.conductor?.arcing ?? false,
              open: node.electrical.open,
            }),
          }
        : {}),
      ...(node.pipe !== undefined
        ? {
            pipe: Object.freeze({
              pressurePa: node.pipe.pressurePa,
              hoopUtilization: node.pipe.hoopUtilization,
              breached: node.pipe.breached,
              reliefOpen: node.pipe.reliefOpen,
            }),
          }
        : {}),
      ...(node.pump !== undefined
        ? {
            pump: Object.freeze({
              powered: node.electrical?.powered ?? true,
              flowFraction: node.pump.flowFraction,
            }),
          }
        : {}),
      ...(node.cryostat !== undefined
        ? {
            cryostat: Object.freeze({
              heliumKg: node.cryostat.heliumKg,
              coldMassTemperatureK: node.cryostat.coldTemperatureK,
            }),
          }
        : {}),
      ...(node.magnet !== undefined
        ? {
            magnet: Object.freeze({
              currentFraction: node.magnet.currentFraction,
              quenched: node.magnet.quenched,
            }),
          }
        : {}),
      ...(node.plasma !== undefined
        ? {
            plasma: Object.freeze({
              state: node.plasma.state,
              energyFraction: node.plasma.energyJ / (node.spec!.plasma!.storedThermalEnergyJ || 1),
            }),
          }
        : {}),
      ...(node.barrier !== undefined
        ? {
            barrier: Object.freeze({
              unexposedFaceTemperatureK: node.barrier.back.temperatureK,
              failed: node.barrier.failed,
            }),
          }
        : {}),
    };
    return Object.freeze(state);
  }

  #enclosureState(enclosure: EnclosureRuntime): EnclosureState {
    return Object.freeze({
      id: enclosure.spec.id,
      minM: enclosure.spec.minM,
      maxM: enclosure.spec.maxM,
      volumeM3: enclosure.volumeM3,
      gasMassKg: Object.freeze({ ...enclosure.gasKg }),
      flammableVolumeFraction: this.#flammableFraction(enclosure),
      lowerFlammabilityLimit: this.#mixtureLfl(enclosure),
      overpressurePa: enclosure.overpressurePa,
    });
  }

  /** Read-only access for tests: the cascade's current view of a component's temperature. */
  temperatureOf(componentId: ComponentId): Kelvin | undefined {
    return this.#nodes.get(componentId)?.shell.temperatureK;
  }

  /** Mass of each gas family in an enclosure. */
  enclosureGas(enclosureId: string): Readonly<Record<GasFamily, number>> | undefined {
    const e = this.#enclosures.find((x) => x.spec.id === enclosureId);
    return e === undefined ? undefined : { ...e.gasKg };
  }

  /** Average flammable gas volume fraction of the air in an enclosure. */
  enclosureFlammableFraction(enclosureId: string): number {
    const e = this.#enclosures.find((x) => x.spec.id === enclosureId);
    return e === undefined ? 0 : this.#flammableFraction(e);
  }
}

/* ====================================================================================== *
 * Free helpers
 * ====================================================================================== */

function makeBody(params: {
  id: string;
  componentId: ComponentId;
  capacityJK: number;
  meltMassKg: number;
  material: MaterialDefinition | undefined;
  temperatureK: Kelvin;
  ambientAreaM2: number;
}): Body {
  return {
    id: params.id,
    componentId: params.componentId,
    capacityJK: params.capacityJK,
    meltMassKg: params.meltMassKg,
    meltingPointK: params.material?.meltingPointK ?? Infinity,
    latentJkg: params.material?.latentHeatOfFusionJkg ?? 0,
    liquidFraction: 0,
    temperatureK: params.temperatureK,
    peakTemperatureK: params.temperatureK,
    ambientAreaM2: params.ambientAreaM2,
    emissivity: params.material?.emissivity ?? 0.8,
    externalW: 0,
    generationW: 0,
    coolingWPerK: 0,
    coolantTemperatureK: params.temperatureK,
    coolingDeficitW: 0,
    coolingDeficitCause: undefined,
    links: [],
    ledger: new AttributionLedger(),
    lastEventId: undefined,
  };
}

function link(a: Body, b: Body, conductanceWPerK: number): void {
  if (!(conductanceWPerK > 0)) return;
  a.links.push({ other: b, conductanceWPerK });
  b.links.push({ other: a, conductanceWPerK });
}

/**
 * Enthalpy-method phase change. A body crossing its melting point holds there while latent
 * heat is absorbed, and only continues heating once fully liquid. Cooling reverses it.
 */
function applyPhaseChange(body: Body, proposedK: Kelvin): void {
  const tm = body.meltingPointK;
  if (body.meltMassKg <= 0 || !Number.isFinite(tm)) {
    body.temperatureK = proposedK;
    return;
  }
  const latentTotal = body.meltMassKg * body.latentJkg;
  const start = body.temperatureK;
  const crossingUp = start < tm && proposedK > tm && body.liquidFraction < 1;
  const inPlateau = body.liquidFraction > 0 && body.liquidFraction < 1;
  const crossingDown = start > tm && proposedK < tm && body.liquidFraction > 0;
  if (!crossingUp && !inPlateau && !crossingDown) {
    body.temperatureK = proposedK;
    return;
  }
  const reference = crossingUp || crossingDown ? tm : start;
  const energyJ = (proposedK - reference) * body.capacityJK;
  let liquid = body.liquidFraction + energyJ / latentTotal;
  if (liquid >= 1) {
    const overflow = (liquid - 1) * latentTotal;
    body.liquidFraction = 1;
    body.temperatureK = tm + overflow / body.capacityJK;
  } else if (liquid <= 0) {
    const underflow = liquid * latentTotal;
    body.liquidFraction = 0;
    body.temperatureK = tm + underflow / body.capacityJK;
  } else {
    liquid = Math.max(liquid, 1e-12);
    body.liquidFraction = liquid;
    body.temperatureK = tm;
  }
}

function emptyExposure(componentId: ComponentId): MutableExposure {
  return {
    componentId,
    heatFluxWm2: 0,
    radiantHeatFluxWm2: 0,
    conductiveHeatW: 0,
    convectiveHeatW: 0,
    hotGasTemperatureK: 0,
    flameExposure: false,
    fluidJetLoadN: 0,
    pressureImpulsePaS: 0,
    peakOverpressurePa: 0,
    debrisImpactEnergyJ: 0,
    electricalFaultExposureW: 0,
    chemicalGasExposure: 0,
    cryogenicExposureW: 0,
    plasmaHeatFluxWm2: 0,
    radiationExposureJ: 0,
  };
}

function emptyGas(): Record<GasFamily, number> {
  return { "battery-vent-gas": 0, helium: 0, pyrolyzate: 0, smoke: 0, steam: 0 };
}

function familyOf(kind: HazardKind): HazardFamily {
  switch (kind) {
    case "radiant-surface":
    case "flame":
    case "hot-gas":
      return "thermal";
    case "electric-arc":
      return "electrical";
    case "fluid-jet":
    case "pressure-wave":
      return "pressure";
    case "smoke":
      return "chemical";
    case "cryogenic-gas":
      return "cryogenic";
    case "plasma-wall-heat":
      return "plasma";
    case "radiation-heating":
      return "radiation";
  }
}

/** Heskestad centreline excess temperature, capped at the continuous-flame value. */
export function plumeExcessK(convectivePowerW: number, heightM: number): number {
  const qKw = Math.max(convectivePowerW, 0) / 1000;
  const z = Math.max(heightM, 0.1);
  return Math.min(
    HESKESTAD_PLUME_COEFFICIENT * qKw ** (2 / 3) * z ** (-5 / 3),
    CONTINUOUS_FLAME_EXCESS_TEMPERATURE_K,
  );
}

function plumeReach(convectivePowerW: number): number {
  // Height at which the excess temperature falls to the negligible threshold.
  const qKw = Math.max(convectivePowerW, 0) / 1000;
  if (qKw <= 0) return 0;
  return ((HESKESTAD_PLUME_COEFFICIENT * qKw ** (2 / 3)) / NEGLIGIBLE_PLUME_EXCESS_K) ** (3 / 5);
}

function radiantReach(powerW: number): number {
  if (!(powerW > 0)) return 0;
  return Math.sqrt(powerW / (4 * Math.PI * NEGLIGIBLE_FLUX_WM2));
}

function halfDiagonal(box: Aabb): number {
  return Vec3Math.distance(box.minM, box.maxM) / 2;
}

/** Outer surface area of a primitive, m². */
export function geometrySurfaceAreaM2(geometry: ComponentGeometry): number {
  if (geometry.kind === "box") {
    const { x, y, z } = geometry.sizeM;
    return 2 * (x * y + y * z + x * z);
  }
  const r = geometry.radiusM;
  return 2 * Math.PI * r * geometry.heightM + 2 * Math.PI * r * r;
}

function largestFaceAreaM2(geometry: ComponentGeometry): number {
  if (geometry.kind === "box") {
    const { x, y, z } = geometry.sizeM;
    return Math.max(x * y, y * z, x * z);
  }
  return 2 * geometry.radiusM * geometry.heightM;
}

function minSectionM2(geometry: ComponentGeometry): number {
  return Math.min(
    sectionAreaPerpendicularToLocalAxis(geometry, "x"),
    sectionAreaPerpendicularToLocalAxis(geometry, "y"),
    sectionAreaPerpendicularToLocalAxis(geometry, "z"),
  );
}

function harmonicMean(a: number, b: number): number {
  return (2 * a * b) / (a + b);
}

function socketWorld(component: SimulationComponent, socketId: string): Vec3 | undefined {
  const socket = component.connectionPoints.find((p) => p.id === socketId);
  return socket === undefined
    ? undefined
    : localPointToWorld(currentTransform(component), socket.localPosition);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function formatTemperature(kelvin: Kelvin): string {
  return `${kelvin.toFixed(1)} K (${kelvinToCelsius(kelvin).toFixed(1)} °C)`;
}

function describeFault(fault: InducedFaultSpec): string {
  switch (fault.kind) {
    case "high-resistance-joint":
      return `A bolted joint has degraded and added ${formatQuantity(fault.addedResistanceOhm, "ohm")} of resistance to the conductor. Nothing else has changed.`;
    case "insulation-breakdown":
      return "Insulation on this conductor has failed (induced fault).";
    case "external-heat":
      return `An external heat input of ${formatQuantity(fault.powerW, "W")} is applied for ${formatQuantity(fault.durationSec, "s")}.`;
    case "pilot-flame":
      return `A small flame or spark is in contact with this component for ${formatQuantity(fault.durationSec, "s")}.`;
    case "cell-internal-short":
      return `Cell ${fault.cellIndex + 1} develops an internal short circuit (induced fault).`;
    case "loss-of-power":
      return "Supply to this element is lost (induced fault).";
  }
}
