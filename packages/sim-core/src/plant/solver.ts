import { criticalTemperatureK, findFluid, getMaterial, getSubstance } from "@forgelab/materials";
import {
  BOLTZMANN_J_PER_K,
  STANDARD_ATMOSPHERE_PA,
  STANDARD_GRAVITY_MPS2,
  STEFAN_BOLTZMANN_W_M2_K4,
  Vec3Math,
  amperesToMegaamperes,
  localPointToWorld,
} from "@forgelab/shared";
import {
  type SimulationComponent,
  componentHeatCapacityJK,
  currentTransform,
} from "../component.js";
import type { Connection } from "../connections.js";
import { type CausalLink, type FailureEvent, failureKey, formatQuantity } from "../failure.js";
import {
  type ComponentGeometry,
  dominantLocalAxis,
  geometryInteriorSurfaceM2,
  geometryInteriorVolumeM3,
  geometryOuterSurfaceM2,
  sectionAreaPerpendicularToLocalAxis,
} from "../geometry.js";
import type { SimulationSettings } from "../settings.js";
import { deratingNote, resistivityAt, thermalDerating } from "../materialsAt.js";
import { extentAlongAxis } from "../systems/members.js";
import { assessConfidence } from "./confidence.js";
import {
  AMBIENT_CONVECTION_W_M2K,
  BREAKDOWN_CURRENT_FRACTION,
  BREAKDOWN_DENSITY_M3,
  BREAKDOWN_MAX_PRESSURE_PA,
  BREAKDOWN_MIN_FIELD_LINEAR_T,
  BREAKDOWN_MIN_FIELD_TOKAMAK_T,
  BREAKDOWN_TEMPERATURE_KEV,
  COPPER_RESISTIVITY_OHM_M,
  DISRUPTION_PRESSURE_PA,
  DT_ION_MASS_AMU,
  FUELING_FEEDBACK_GAIN,
  IMPLICIT_CABLE_AREA_M2,
  IMPLICIT_HOSE_DIAMETER_M,
  LOSS_OF_FLOW_FRACTION,
  NEUTRON_ATTENUATION_LENGTH_M,
  NODE_RESISTANCE_OHM,
  PARTICLE_TO_ENERGY_CONFINEMENT_RATIO,
  PLASMA_SUBSTEPS,
  SHUTDOWN_GREENWALD_FRACTION,
  SUPPLY_SHORTFALL_FRACTION,
  SURFACE_EMISSIVITY,
  THERMAL_SUBSTEPS,
  UNDERVOLTAGE_FRACTION,
} from "./constants.js";
import { type NetworkEdge, type NetworkNode, solveIsland } from "./electrical.js";
import {
  type CoolantFluid,
  effectivenessUniformTemperature,
  getCoolantFluid,
  hydraulicResistance,
  lameHoopStressPa,
  loopPressurePa,
  npshAvailableM,
  pumpCurve,
  seriesPumpOperatingPoint,
  waterSaturationPressurePa,
} from "./fluids.js";
import { dtFusionPower } from "./fusion.js";
import {
  coaxialRelation,
  magneticHoopStressPa,
  solenoidInductanceH,
  toroidalInductanceH,
  magneticPressurePa,
  solenoidOnAxisFieldT,
  toroidalCoilTensionStressPa,
  toroidalFieldT,
  loopHoopStressPa,
  loopInductanceH,
  loopPeakFieldT,
} from "./magnetics.js";
import { torusWinding } from "./biotSavart.js";
import { type GeometricCoupling, geometricCouplings } from "./fieldCoupling.js";
import {
  LOW_Q_KINK_LIMIT,
  TROYON_BETA_N_LIMIT,
  bohmConfinementTimeS,
  bremsstrahlungPowerW,
  cylindricalPlasmaVolumeM3,
  edgeSafetyFactor,
  greenwaldDensityLimitM3,
  ipb98y2ConfinementTimeS,
  normalisedBeta,
  ohmicHeatingW,
  plasmaBeta,
  plasmaInductanceH,
  plasmaTemperatureKeV,
  plasmaThermalEnergyJ,
  toroidalPlasmaVolumeM3,
} from "./plasma.js";
import {
  COOLED_ROLES,
  type ComponentParameters,
  booleanParameter,
  numberParameter,
  stringParameter,
} from "./roles.js";
import {
  AMBIENT_TEMPERATURE_K,
  type ComponentPlantState,
  type CoolantLoopSummary,
  type ElectricalIslandSummary,
  type ElectricalState,
  type MagnetState,
  type PlantMetrics,
  type PlantSummary,
  type PlasmaPhase,
  type PlasmaState,
  type VesselState,
} from "./state.js";
import {
  type PlantLink,
  type PlantTopology,
  type VesselLayout,
  buildTopology,
  groupsOver,
  neighbours,
} from "./topology.js";

/* ------------------------------------------------------------------------------------ *
 * Runtime state (mutable, private to the solver)
 * ------------------------------------------------------------------------------------ */

interface ComponentRuntime {
  temperatureK: number;
  disabled: boolean;
  disabledReason: string;
  coilCurrentA: number;
  quenched: boolean;
  /** Simulated time the coil quenched, s (−1: never). */
  quenchedAtSec: number;
  /** Helium boiled off in the last step, kg/s (superconducting coils). */
  heliumBoilOffKgS: number;
  generatorOutputW: number;
}

interface VesselRuntime {
  pressurePa: number;
  phase: PlasmaPhase;
  densityM3: number;
  energyJ: number;
  plasmaCurrentA: number;
  deuteriumFraction: number;
  statusText: string;
  /** Exhaust particle flux from the previous tick, for the vacuum gas load. */
  exhaustPerS: number;
}

interface LoopRuntime {
  temperatureK: number;
}

export interface PlantStepInput {
  readonly components: readonly SimulationComponent[];
  readonly connections: readonly Connection[];
  readonly settings: SimulationSettings;
  /** 0 evaluates the current state without integrating in time. */
  readonly dtSec: number;
  readonly tick: number;
  readonly timeSec: number;
  /**
   * When given, topology and other static data are reused while it is unchanged. The
   * world passes a counter that increments on every design edit and every body movement.
   */
  readonly topologyRevision?: number;
}

export interface PlantStepResult {
  readonly states: ReadonlyMap<string, ComponentPlantState>;
  readonly summary: PlantSummary;
  /** New events this step (each key is raised at most once per run). */
  readonly events: readonly FailureEvent[];
  readonly diagnostics: readonly string[];
}

/* ------------------------------------------------------------------------------------ *
 * Per-step working data
 * ------------------------------------------------------------------------------------ */

interface Work {
  readonly topology: PlantTopology;
  readonly settings: SimulationSettings;
  readonly dt: number;
  readonly tick: number;
  readonly timeSec: number;
  readonly ambientK: number;
  heatW: Map<string, number>;
  heatToCoolantW: Map<string, number>;
  heatToAmbientW: Map<string, number>;
  electrical: Map<string, ElectricalState>;
  supply: Map<string, number>;
  magnets: Map<string, MagnetState>;
  vessels: Map<string, VesselState>;
  loopOf: Map<string, CoolantLoopSummary>;
  outputs: Map<string, Record<string, number>>;
  warnings: Map<string, string[]>;
  commandedOff: Set<string>;
  heatingOff: Set<string>;
  openedSwitches: Set<string>;
  islands: ElectricalIslandSummary[];
  loops: CoolantLoopSummary[];
  events: FailureEvent[];
  diagnostics: string[];
  vesselField: Map<string, number>;
}

/**
 * The V0.1 plant solver: electrical, vacuum, magnetics, plasma, neutronics, coolant,
 * thermal, power conversion and controls. See docs/ARCHITECTURE.md §12 for the model and
 * every approximation it makes.
 *
 * It is deterministic: every collection is walked in id order and there is no randomness.
 * The world calls `step()` once per fixed timestep (and with dt = 0 to evaluate a design
 * while paused); `reset()` returns every state to its initial condition.
 */
export class PlantSolver {
  #components = new Map<string, ComponentRuntime>();
  #vessels = new Map<string, VesselRuntime>();
  #loops = new Map<string, LoopRuntime>();
  #tripped = new Set<string>();
  #raised = new Map<string, FailureEvent>();
  #chains = new Map<string, readonly CausalLink[]>();
  #readings = new Map<string, number>();
  #lastStates = new Map<string, ComponentPlantState>();
  #cache:
    | {
        revision: number;
        topology: PlantTopology;
        loops: LoopGroups;
        sorted: SimulationComponent[];
      }
    | undefined;

  reset(): void {
    this.#cache = undefined;
    this.#components.clear();
    this.#vessels.clear();
    this.#loops.clear();
    this.#tripped.clear();
    this.#raised.clear();
    this.#chains.clear();
    this.#readings.clear();
    this.#lastStates.clear();
  }

  /** The causal chain recorded for a raised event, root cause first. */
  chainFor(key: string): readonly CausalLink[] {
    return this.#chains.get(key) ?? [];
  }

  step(input: PlantStepInput): PlantStepResult {
    const cached =
      input.topologyRevision !== undefined && this.#cache?.revision === input.topologyRevision
        ? this.#cache
        : undefined;
    const topology = cached?.topology ?? buildTopology(input.components, input.connections);
    const ambientK = input.settings.ambientTemperatureK;
    const work: Work = {
      topology,
      settings: input.settings,
      dt: input.dtSec,
      tick: input.tick,
      timeSec: input.timeSec,
      ambientK,
      heatW: new Map(),
      heatToCoolantW: new Map(),
      heatToAmbientW: new Map(),
      electrical: new Map(),
      supply: new Map(),
      magnets: new Map(),
      vessels: new Map(),
      loopOf: new Map(),
      outputs: new Map(),
      warnings: new Map(),
      commandedOff: new Set(),
      heatingOff: new Set(),
      openedSwitches: new Set(),
      islands: [],
      loops: [],
      events: [],
      diagnostics: [],
      vesselField: new Map(),
    };

    const sorted =
      cached?.sorted ??
      [...input.components].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const loopGroups = cached?.loops ?? this.#coolantGroups(topology, sorted);
    if (input.topologyRevision !== undefined && cached === undefined) {
      this.#cache = { revision: input.topologyRevision, topology, loops: loopGroups, sorted };
    }
    this.#syncRuntime(sorted, topology, loopGroups, input.settings);

    this.#controls(work, sorted);
    this.#electrical(work, sorted);
    this.#magnets(work, sorted);
    for (const layout of topology.vessels) this.#vessel(work, layout);
    this.#neutronics(work);
    const cycleHeat = this.#coolantAndThermal(work, sorted, loopGroups);
    const conversion = this.#powerConversion(work, sorted, cycleHeat);
    this.#thermalFailures(work, sorted);

    const states = new Map<string, ComponentPlantState>();
    for (const component of sorted) states.set(component.id, this.#publish(work, component));
    this.#lastStates = states;
    this.#recordReadings(work, sorted, states);

    const metrics = this.#metrics(work, sorted, states, conversion);
    const confidence = assessConfidence({
      topology,
      components: sorted,
      work,
      metrics,
      geometric: this.#geometricCouplings(topology),
    });

    return {
      states,
      summary: Object.freeze({
        metrics,
        islands: Object.freeze(work.islands),
        loops: Object.freeze(work.loops),
        confidence,
      }),
      events: work.events,
      diagnostics: work.diagnostics,
    };
  }

  /* ---------------------------------------------------------------------------------- *
   * Initial conditions
   * ---------------------------------------------------------------------------------- */

  #syncRuntime(
    components: readonly SimulationComponent[],
    topology: PlantTopology,
    loops: LoopGroups,
    settings: SimulationSettings,
  ): void {
    const ids = new Set(components.map((c) => c.id));
    for (const id of [...this.#components.keys()]) if (!ids.has(id)) this.#components.delete(id);
    for (const id of [...this.#vessels.keys()]) if (!ids.has(id)) this.#vessels.delete(id);

    // Hot standby: a loop that feeds a turbine starts at that turbine's steam temperature.
    const standbyK = new Map<string, number>();
    loops.groups.forEach((group, i) => {
      const id = loopId(group);
      let target = settings.ambientTemperatureK;
      if (settings.initialThermalState === "hot-standby") {
        for (const member of group) {
          if (topology.byId.get(member)?.role !== "heat-exchanger") continue;
          for (const turbineId of neighbours(topology, "steam", member)) {
            const turbine = topology.byId.get(turbineId);
            if (turbine?.role !== "turbine") continue;
            target = Math.max(target, numberParameter(turbine.parameters, "steamTemperatureK"));
          }
        }
      }
      standbyK.set(id, target);
      if (!this.#loops.has(id)) this.#loops.set(id, { temperatureK: target });
      void i;
    });
    for (const id of [...this.#loops.keys()]) if (!standbyK.has(id)) this.#loops.delete(id);

    for (const component of components) {
      if (this.#components.has(component.id)) continue;
      const loop = loops.loopOfComponent.get(component.id);
      const superconducting =
        component.role === "magnet-coil" &&
        booleanParameter(component.parameters, "superconducting");
      const temperatureK = superconducting
        ? numberParameter(component.parameters, "operatingTemperatureK")
        : loop !== undefined
          ? (standbyK.get(loop) ?? settings.ambientTemperatureK)
          : settings.ambientTemperatureK;
      this.#components.set(component.id, {
        temperatureK,
        disabled: false,
        disabledReason: "",
        coilCurrentA: 0,
        quenched: false,
        quenchedAtSec: -1,
        heliumBoilOffKgS: 0,
        generatorOutputW: 0,
      });
    }

    for (const layout of topology.vessels) {
      if (this.#vessels.has(layout.vesselId)) continue;
      const vessel = topology.byId.get(layout.vesselId)!;
      let pressurePa = STANDARD_ATMOSPHERE_PA;
      if (settings.initialVacuumState === "pumped-down") {
        const speed = layout.pumpIds.reduce((sum, id) => {
          const pump = topology.byId.get(id)!;
          return (
            sum +
            (booleanParameter(pump.parameters, "enabled")
              ? numberParameter(pump.parameters, "pumpingSpeedM3PerS")
              : 0)
          );
        }, 0);
        if (speed > 0) pressurePa = baseGasLoad(vessel) / speed;
      }
      this.#vessels.set(layout.vesselId, {
        pressurePa,
        phase: "off",
        densityM3: 0,
        energyJ: 0,
        plasmaCurrentA: 0,
        deuteriumFraction: 0.5,
        statusText: "No plasma.",
        exhaustPerS: 0,
      });
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Controls: sensors read the previous step; tripped controllers latch
   * ---------------------------------------------------------------------------------- */

  #controls(work: Work, components: readonly SimulationComponent[]): void {
    const { topology } = work;
    for (const controller of components) {
      if (controller.role !== "controller") continue;
      const linked = neighbours(topology, "control", controller.id);
      const sensors = linked.filter((id) => topology.byId.get(id)?.role === "sensor");
      const actuators = linked.filter((id) => topology.byId.get(id)?.role !== "sensor");
      if (sensors.length === 0)
        addWarning(work, controller.id, "No sensor is linked to this controller.");
      if (actuators.length === 0)
        addWarning(work, controller.id, "No actuator is linked to this controller.");

      if (!this.#tripped.has(controller.id) && work.dt > 0) {
        const setpoint = numberParameter(controller.parameters, "setpoint");
        const above = stringParameter(controller.parameters, "comparison") !== "below";
        for (const sensorId of sensors) {
          const reading = this.#readings.get(sensorId);
          if (reading === undefined) continue;
          if (above ? reading > setpoint : reading < setpoint) {
            this.#tripped.add(controller.id);
            const sensor = topology.byId.get(sensorId)!;
            const quantity = stringParameter(sensor.parameters, "quantity");
            const action = stringParameter(controller.parameters, "action");
            this.#raise(work, {
              componentId: controller.id,
              system: "control",
              failureType: "interlock_trip",
              unit: sensorUnit(quantity),
              measuredValue: reading,
              limitValue: setpoint,
              summary: `Interlock "${controller.id}" tripped`,
              cause:
                `Controller "${controller.id}" tripped: sensor "${sensorId}" read ${formatQuantity(reading, sensorUnit(quantity))}, ` +
                `${above ? "above" : "below"} its setpoint of ${formatQuantity(setpoint, sensorUnit(quantity))}. ` +
                (action === "open-breakers"
                  ? "It opened every breaker linked to it."
                  : action === "stop-heating"
                    ? "It switched off the heaters linked to it; the plasma continues on alpha heating if it can."
                    : "It commanded a controlled plasma shutdown: heating and fuelling off, current ramped down."),
              causeKeys: [],
            });
            break;
          }
        }
      }

      if (this.#tripped.has(controller.id)) {
        const action = stringParameter(controller.parameters, "action");
        for (const id of actuators) {
          const role = topology.byId.get(id)?.role;
          if (action === "open-breakers" && role === "switch") work.openedSwitches.add(id);
          if (action === "stop-heating" && role === "plasma-heater") work.heatingOff.add(id);
          if (
            action === "shutdown-plasma" &&
            (role === "plasma-heater" || role === "fuel-injector")
          ) {
            work.commandedOff.add(id);
          }
        }
        work.outputs.set(controller.id, {
          ...(work.outputs.get(controller.id) ?? {}),
          trippedFlag: 1,
        });
      }
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Electrical network
   * ---------------------------------------------------------------------------------- */

  #demandW(work: Work, component: SimulationComponent): number {
    const p = component.parameters;
    const runtime = this.#components.get(component.id)!;
    if (runtime.disabled) return 0;
    switch (component.role) {
      case "plasma-heater": {
        if (
          !booleanParameter(p, "enabled") ||
          work.commandedOff.has(component.id) ||
          work.heatingOff.has(component.id)
        )
          return 0;
        const vesselId = neighbours(work.topology, "port", component.id).find(
          (id) => work.topology.byId.get(id)?.role === "vacuum-vessel",
        );
        const vessel = vesselId === undefined ? undefined : this.#vessels.get(vesselId);
        if (vessel === undefined || !isRunning(vessel.phase) || vessel.phase === "shutdown")
          return 0;
        return numberParameter(p, "heatingPowerW") / numberParameter(p, "wallPlugEfficiency");
      }
      case "fuel-injector": {
        if (!booleanParameter(p, "enabled") || work.commandedOff.has(component.id)) return 0;
        return numberParameter(p, "electricalPowerW");
      }
      case "vacuum-pump":
        return booleanParameter(p, "enabled") ? numberParameter(p, "electricalPowerW") : 0;
      case "coolant-pump":
        return booleanParameter(p, "enabled")
          ? (STANDARD_GRAVITY_MPS2 *
              numberParameter(p, "ratedHeadM") *
              numberParameter(p, "ratedMassFlowKgS")) /
              numberParameter(p, "efficiency")
          : 0;
      case "magnet-coil": {
        if (!booleanParameter(p, "enabled")) return 0;
        if (booleanParameter(p, "superconducting")) {
          const tOp = numberParameter(p, "operatingTemperatureK");
          return (
            (numberParameter(p, "cryoCapacityW") * (work.ambientK / tOp - 1)) /
            numberParameter(p, "cryoFractionOfCarnot")
          );
        }
        if (runtime.quenched) return 0;
        const current = numberParameter(p, "currentA");
        return current * current * resistiveCoilOhm(component, runtime.temperatureK);
      }
      default:
        return 0;
    }
  }

  #electrical(work: Work, components: readonly SimulationComponent[]): void {
    const { topology } = work;
    const electricalRoles = new Set([
      "plasma-heater",
      "fuel-injector",
      "vacuum-pump",
      "coolant-pump",
      "magnet-coil",
      "power-supply",
      "generator",
      "conductor",
      "switch",
    ]);
    const members = components.filter(
      (c) => electricalRoles.has(c.role) && !this.#components.get(c.id)!.disabled,
    );
    const memberIds = members.map((c) => c.id);
    const isOpen = (id: string) => {
      const component = topology.byId.get(id);
      return (
        component?.role === "switch" &&
        (!booleanParameter(component.parameters, "closed") || work.openedSwitches.has(id))
      );
    };

    const halfResistance = (id: string): number => this.#halfResistance(topology, id);
    const { groups, linksByGroup } = groupsOver(
      topology,
      memberIds,
      ["electrical"],
      (link) => !isOpen(link.a) && !isOpen(link.b),
    );

    const nodes = new Map<string, NetworkNode>();
    for (const component of members) {
      const p = component.parameters;
      const runtime = this.#components.get(component.id)!;
      if (component.role === "power-supply") {
        nodes.set(component.id, {
          id: component.id,
          demandW: 0,
          ...(booleanParameter(p, "enabled")
            ? {
                sourceVoltageV: numberParameter(p, "voltageV"),
                sourceResistanceOhm: numberParameter(p, "internalResistanceOhm"),
                sourceCapacityW: numberParameter(p, "maxPowerW"),
                sourceKind: "grid" as const,
              }
            : {}),
        });
      } else if (component.role === "generator") {
        nodes.set(component.id, {
          id: component.id,
          demandW: 0,
          sourceVoltageV: numberParameter(p, "voltageV"),
          sourceResistanceOhm: numberParameter(p, "internalResistanceOhm"),
          sourceCapacityW: Math.min(runtime.generatorOutputW, numberParameter(p, "ratedPowerW")),
          sourceKind: "generator",
        });
      } else {
        nodes.set(component.id, { id: component.id, demandW: this.#demandW(work, component) });
      }
    }

    groups.forEach((group, i) => {
      const edges: NetworkEdge[] = linksByGroup[i]!.map((link) => ({
        id: link.connection.id,
        a: link.a,
        b: link.b,
        resistanceOhm: halfResistance(link.a) + halfResistance(link.b) + linkResistanceOhm(link),
      }));
      const islandNodes = group.map((id) => nodes.get(id)!);
      const result = solveIsland(islandNodes, edges);
      const islandId = `island:${group[0]}`;
      const hasSource = islandNodes.some((n) => n.sourceVoltageV !== undefined);

      // Conductor loss: sum of the edges touching it, split evenly between its two halves.
      const conductorLoss = new Map<string, number>();
      const conductorCurrent = new Map<string, number>();
      for (const link of linksByGroup[i]!) {
        const edge = result.edges.get(link.connection.id);
        if (edge === undefined) continue;
        for (const id of [link.a, link.b]) {
          if (topology.byId.get(id)?.role !== "conductor") continue;
          const share =
            (halfResistance(id) /
              Math.max(halfResistance(link.a) + halfResistance(link.b), 1e-12)) *
            edge.lossW;
          conductorLoss.set(id, (conductorLoss.get(id) ?? 0) + share);
          conductorCurrent.set(id, Math.max(conductorCurrent.get(id) ?? 0, edge.currentA));
        }
      }

      for (const id of group) {
        const node = nodes.get(id)!;
        const nodeResult = result.nodes.get(id)!;
        const lossW = conductorLoss.get(id) ?? 0;
        const state: ElectricalState = Object.freeze({
          islandId: hasSource || group.length > 1 ? islandId : null,
          voltageV: nodeResult.voltageV,
          currentA: conductorCurrent.get(id) ?? nodeResult.currentA,
          demandW: node.demandW,
          deliveredW: nodeResult.deliveredW,
          suppliedW: nodeResult.suppliedW,
          lossW,
          supplyFraction:
            node.demandW > 0 ? nodeResult.deliveredW / node.demandW : result.supplyFraction,
        });
        work.electrical.set(id, state);
        work.supply.set(
          id,
          node.demandW > 0 ? nodeResult.deliveredW / node.demandW : hasSource ? 1 : 0,
        );
        if (lossW > 0) addHeat(work, id, lossW);
        if (node.demandW > 0 && !hasSource)
          addWarning(work, id, "Not connected to any power source.");
        if (
          node.demandW > 0 &&
          hasSource &&
          nodeResult.voltageV < UNDERVOLTAGE_FRACTION * result.nominalVoltageV
        ) {
          addWarning(
            work,
            id,
            `Under-voltage: ${((100 * nodeResult.voltageV) / result.nominalVoltageV).toFixed(0)} % of nominal. Heavier conductors would cut the drop.`,
          );
        }
      }

      if (hasSource || result.demandW > 0) {
        work.islands.push(
          Object.freeze({
            id: islandId,
            componentIds: Object.freeze(group),
            nominalVoltageV: result.nominalVoltageV,
            demandW: result.demandW,
            deliveredW: result.deliveredW,
            lossW: result.lossW,
            generationW: result.generationW,
            gridImportW: result.gridImportW,
            supplyFraction: result.supplyFraction,
            minVoltageV: result.minVoltageV,
          }),
        );
      }

      if (result.demandW > 0 && result.supplyFraction < SUPPLY_SHORTFALL_FRACTION && work.dt > 0) {
        const consumers = group.filter((id) => (nodes.get(id)?.demandW ?? 0) > 0);
        for (const id of consumers) {
          this.#raise(work, {
            componentId: id,
            system: "electrical",
            failureType: "supply_shortfall",
            unit: "W",
            measuredValue: nodes.get(id)!.demandW * result.supplyFraction,
            limitValue: nodes.get(id)!.demandW,
            summary: `"${id}" lost ${(100 * (1 - result.supplyFraction)).toFixed(0)} % of its power`,
            cause: hasSource
              ? `The network feeding "${id}" can supply ${formatQuantity(result.capacityW, "W")} but its loads ` +
                `demand ${formatQuantity(result.demandW, "W")} plus ${formatQuantity(result.lossW, "W")} of resistive loss, ` +
                `so every load on it receives ${(100 * result.supplyFraction).toFixed(1)} % of what it asks for.`
              : `"${id}" demands ${formatQuantity(nodes.get(id)!.demandW, "W")} but is not connected to any power source.`,
            causeKeys: [],
          });
        }
      }
    });
  }

  /* ---------------------------------------------------------------------------------- *
   * Magnets
   * ---------------------------------------------------------------------------------- */

  #magnets(work: Work, components: readonly SimulationComponent[]): void {
    const { topology, dt } = work;
    for (const coil of components) {
      if (coil.role !== "magnet-coil") continue;
      const p = coil.parameters;
      const runtime = this.#components.get(coil.id)!;
      const supply = work.supply.get(coil.id) ?? 0;
      const superconducting = booleanParameter(p, "superconducting");
      const rated = numberParameter(p, "currentA");
      // A quenched coil keeps its current until protection has detected the quench and
      // opened the dump circuit; then it decays through the dump resistor.
      const quenchAgeS = runtime.quenched ? work.timeSec - runtime.quenchedAtSec : -1;
      const detectionDelayS = numberParameter(p, "quenchDetectionDelayS");
      const dumping = runtime.quenched && quenchAgeS >= detectionDelayS;
      const holding = runtime.quenched && !dumping;
      const energised =
        booleanParameter(p, "enabled") &&
        !runtime.disabled &&
        !runtime.quenched &&
        (work.electrical.get(coil.id)?.islandId ?? null) !== null &&
        (superconducting ? supply > 0 : true);

      let target = 0;
      if (energised) target = superconducting ? rated : rated * Math.sqrt(Math.min(1, supply));
      if (holding) target = runtime.coilCurrentA;
      // Coils are energised instantly at the start of a run (V0.1 does not model charging);
      // de-energising follows the protection dump time constant.
      if (target >= runtime.coilCurrentA || dt === 0) {
        runtime.coilCurrentA =
          dt === 0 && runtime.coilCurrentA > target ? runtime.coilCurrentA : target;
      } else {
        const tau = numberParameter(p, "dumpTimeConstantS");
        runtime.coilCurrentA = target + (runtime.coilCurrentA - target) * Math.exp(-dt / tau);
        if (runtime.coilCurrentA < 1) runtime.coilCurrentA = target;
      }
      if (!superconducting && runtime.coilCurrentA > 0) {
        addHeat(
          work,
          coil.id,
          runtime.coilCurrentA ** 2 * resistiveCoilOhm(coil, runtime.temperatureK),
        );
      }

      const turns = numberParameter(p, "turns");
      const current = runtime.coilCurrentA;
      const geometric = this.#geometricCouplings(topology).get(coil.id);
      const vesselId = topology.coilVessel.get(coil.id) ?? geometric?.vesselId ?? null;
      let fieldAtPlasmaT = 0;
      if (topology.coilVessel.has(coil.id)) {
        const vessel = topology.byId.get(vesselId!)!;
        fieldAtPlasmaT = coilFieldAtVessel(coil, vessel, turns, current);
        work.vesselField.set(vesselId!, (work.vesselField.get(vesselId!) ?? 0) + fieldAtPlasmaT);
      } else if (geometric !== undefined) {
        // Field from the coil's geometry (Biot–Savart), signed along the plasma's axis:
        // coils can reinforce or cancel each other.
        fieldAtPlasmaT = geometric.coupling.meanTPerA * current;
        work.vesselField.set(
          geometric.vesselId,
          (work.vesselField.get(geometric.vesselId) ?? 0) + fieldAtPlasmaT,
        );
      } else {
        addWarning(
          work,
          coil.id,
          "Its field does not reach any vessel's plasma: it neither encloses a torus vessel nor sits round a cylinder, and its geometric field on every vessel's axis is negligible.",
        );
      }

      const { peakFieldT, radiusM, wallM } = coilPeak(coil, turns, current);
      const hoopStressPa =
        current > 0 ? coilStructuralStressPa(coil, turns, current, peakFieldT) : 0;
      const material = getMaterial(coil.materialId);
      const hoopUtilization = hoopStressPa / material.yieldStrengthPa;

      if (hoopUtilization > 1 && !runtime.disabled && dt > 0) {
        runtime.disabled = true;
        runtime.disabledReason =
          "Coil casing overstressed by magnetic forces; protection dumped the coil.";
        this.#raise(work, {
          componentId: coil.id,
          system: "magnetic",
          failureType: "magnetic_overstress",
          unit: "Pa",
          measuredValue: hoopStressPa,
          limitValue: material.yieldStrengthPa,
          summary: `Coil "${coil.id}" casing overstressed by its own field`,
          cause:
            `Coil "${coil.id}" reaches a peak field of ${formatQuantity(peakFieldT, "T")} (magnetic pressure ` +
            `${formatQuantity(magneticPressurePa(peakFieldT), "Pa")}). The electromagnetic forces load its ` +
            `${formatQuantity(wallM, "m")} ${material.name} casing (radius ${formatQuantity(radiusM, "m")}) to ` +
            `${formatQuantity(hoopStressPa, "Pa")}, above the ${formatQuantity(material.yieldStrengthPa, "Pa")} yield strength ` +
            (coil.geometry.kind === "torus"
              ? `(constant-tension toroidal coil estimate). `
              : `(thin-solenoid hoop stress σ = p·r/t). `) +
            `Protection dumped the coil. A thicker casing, a stronger material or fewer ampere-turns would help.`,
          causeKeys: [],
        });
      }

      const inductanceH = coilInductanceH(coil, turns);
      const tau = numberParameter(p, "dumpTimeConstantS");
      work.magnets.set(
        coil.id,
        Object.freeze({
          currentA: current,
          fieldAtPlasmaT,
          servesVesselId: vesselId,
          peakFieldT,
          hoopStressPa,
          hoopUtilization,
          quenched: runtime.quenched,
          tripped: runtime.disabled,
          powerDemandW: work.electrical.get(coil.id)?.demandW ?? 0,
          inductanceH,
          storedEnergyJ: 0.5 * inductanceH * current * current,
          quenchAgeS,
          dumping,
          // LR discharge: the dump resistor R = L / τ takes I² R.
          dumpPowerW: dumping && tau > 0 ? (current * current * inductanceH) / tau : 0,
          heliumBoilOffKgS: runtime.heliumBoilOffKgS,
        }),
      );
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Vacuum and plasma, per vessel
   * ---------------------------------------------------------------------------------- */

  #vessel(work: Work, layout: VesselLayout): void {
    const { topology, dt } = work;
    const vessel = topology.byId.get(layout.vesselId)!;
    const runtime = this.#vessels.get(layout.vesselId)!;
    const vesselThermal = this.#components.get(vessel.id)!;
    const p = vessel.parameters;

    // --- Vacuum -----------------------------------------------------------------------
    const interiorVolumeM3 = geometryInteriorVolumeM3(vessel.geometry);
    let pumpingSpeedM3PerS = 0;
    for (const pumpId of layout.pumpIds) {
      const pump = topology.byId.get(pumpId)!;
      if (!booleanParameter(pump.parameters, "enabled")) continue;
      pumpingSpeedM3PerS +=
        numberParameter(pump.parameters, "pumpingSpeedM3PerS") *
        Math.min(1, work.supply.get(pumpId) ?? 0);
    }
    const exhaustGasPaM3PerS = runtime.exhaustPerS * BOLTZMANN_J_PER_K * vesselThermal.temperatureK;
    const gasLoadPaM3PerS = baseGasLoad(vessel) + exhaustGasPaM3PerS;
    if (dt > 0 && interiorVolumeM3 > 0) {
      if (pumpingSpeedM3PerS > 0) {
        const equilibrium = gasLoadPaM3PerS / pumpingSpeedM3PerS;
        runtime.pressurePa =
          equilibrium +
          (runtime.pressurePa - equilibrium) *
            Math.exp((-pumpingSpeedM3PerS * dt) / interiorVolumeM3);
      } else {
        runtime.pressurePa = Math.min(
          STANDARD_ATMOSPHERE_PA,
          runtime.pressurePa + (gasLoadPaM3PerS * dt) / interiorVolumeM3,
        );
      }
    }
    if (layout.pumpIds.length === 0)
      addWarning(work, vessel.id, "No vacuum pump is linked to this vessel.");

    // --- Plasma geometry and field -------------------------------------------------------
    // Geometric contributions are signed; the plasma model needs the magnitude.
    const fieldT = Math.abs(work.vesselField.get(vessel.id) ?? 0);
    const geometry = plasmaGeometry(vessel);
    const targetCurrentA =
      layout.configuration === "tokamak" ? numberParameter(p, "plasmaCurrentA") : 0;
    const heaterIds = layout.heaterIds.filter((id) => !this.#components.get(id)!.disabled);
    const injectorIds = layout.injectorIds.filter((id) => !this.#components.get(id)!.disabled);
    const auxiliaryHeatingW = heaterIds.reduce((sum, id) => {
      const heater = topology.byId.get(id)!;
      const electrical = work.electrical.get(id);
      const fraction =
        electrical !== undefined && electrical.demandW > 0
          ? electrical.deliveredW / electrical.demandW
          : 0;
      return sum + numberParameter(heater.parameters, "heatingPowerW") * Math.min(1, fraction);
    }, 0);
    const shutdownCommanded = [...layout.heaterIds, ...layout.injectorIds].some((id) =>
      work.commandedOff.has(id),
    );

    // --- Start conditions ---------------------------------------------------------------
    if (runtime.phase === "off" && dt > 0 && layout.configuration !== "none") {
      const minField =
        layout.configuration === "tokamak"
          ? BREAKDOWN_MIN_FIELD_TOKAMAK_T
          : BREAKDOWN_MIN_FIELD_LINEAR_T;
      const fuelling = injectorIds.some((id) => {
        const injector = topology.byId.get(id)!;
        return (
          booleanParameter(injector.parameters, "enabled") &&
          !work.commandedOff.has(id) &&
          (work.supply.get(id) ?? 0) > 0
        );
      });
      const reasons: string[] = [];
      if (layout.coilIds.length === 0) reasons.push("no coil encloses the vessel");
      else if (fieldT < minField)
        reasons.push(
          `field ${fieldT.toFixed(2)} T is below the ${minField} T needed for breakdown`,
        );
      if (runtime.pressurePa > BREAKDOWN_MAX_PRESSURE_PA) {
        reasons.push(
          `pressure ${runtime.pressurePa.toExponential(1)} Pa is above the ${BREAKDOWN_MAX_PRESSURE_PA} Pa breakdown limit`,
        );
      }
      if (!fuelling) reasons.push("no powered fuel injector is linked");
      if (layout.configuration === "tokamak" && !(targetCurrentA > 0))
        reasons.push("plasma current is set to zero");
      if (shutdownCommanded) reasons.push("an interlock is holding the plasma off");
      if (reasons.length === 0) {
        runtime.phase = "ramp-up";
        runtime.densityM3 = BREAKDOWN_DENSITY_M3;
        runtime.plasmaCurrentA = targetCurrentA * BREAKDOWN_CURRENT_FRACTION;
        runtime.energyJ = plasmaThermalEnergyJ(
          runtime.densityM3,
          BREAKDOWN_TEMPERATURE_KEV,
          geometry.volumeM3,
        );
        runtime.statusText = "Breakdown achieved; ramping up.";
      } else {
        runtime.statusText = `Waiting to start: ${reasons.join("; ")}.`;
      }
    }

    if (isRunning(runtime.phase) && shutdownCommanded && runtime.phase !== "shutdown") {
      runtime.phase = "shutdown";
      runtime.statusText = "Controlled shutdown: heating and fuelling off, current ramping down.";
    }

    // --- 0D plasma integration -----------------------------------------------------------
    const plasma = this.#integratePlasma(
      work,
      layout,
      runtime,
      geometry,
      fieldT,
      targetCurrentA,
      auxiliaryHeatingW,
    );

    work.vessels.set(
      vessel.id,
      Object.freeze({
        pressurePa: runtime.pressurePa,
        pumpingSpeedM3PerS,
        gasLoadPaM3PerS,
        interiorVolumeM3,
        plasma,
      }),
    );
  }

  #integratePlasma(
    work: Work,
    layout: VesselLayout,
    runtime: VesselRuntime,
    geometry: PlasmaGeometry,
    fieldT: number,
    targetCurrentA: number,
    auxiliaryHeatingW: number,
  ): PlasmaState {
    const { topology, dt } = work;
    const vessel = topology.byId.get(layout.vesselId)!;
    const p = vessel.parameters;
    const zEff = numberParameter(p, "effectiveCharge");
    const elongation = numberParameter(p, "elongation");
    const V = geometry.volumeM3;
    const tokamak = layout.configuration === "tokamak";

    // Fuel mix: flow-weighted over powered injectors.
    let maxRate = 0;
    let dWeighted = 0;
    let targetDensity = 0;
    for (const id of layout.injectorIds) {
      const injector = topology.byId.get(id)!;
      if (
        this.#components.get(id)!.disabled ||
        !booleanParameter(injector.parameters, "enabled") ||
        work.commandedOff.has(id)
      ) {
        continue;
      }
      const rate =
        numberParameter(injector.parameters, "maxRateParticlesPerS") *
        Math.min(1, work.supply.get(id) ?? 0);
      maxRate += rate;
      dWeighted += rate * numberParameter(injector.parameters, "deuteriumFraction");
      targetDensity = Math.max(
        targetDensity,
        numberParameter(injector.parameters, "targetDensityM3"),
      );
    }
    if (maxRate > 0) runtime.deuteriumFraction = dWeighted / maxRate;

    let fusionW = 0;
    let alphaW = 0;
    let neutronW = 0;
    let ohmicW = 0;
    let bremsW = 0;
    let transportW = 0;
    let fuelingRate = 0;
    let tauE = 0;
    let wallEnergyJ = 0;
    let neutronEnergyJ = 0;
    let exhaust = 0;

    const running = isRunning(runtime.phase);
    if (running) {
      // With dt = 0 this evaluates the instantaneous powers once without integrating.
      const count = dt > 0 ? PLASMA_SUBSTEPS : 1;
      const h = dt / count;
      for (let i = 0; i < count; i += 1) {
        // Current ramp.
        if (tokamak) {
          const rate = numberParameter(p, "plasmaCurrentRampAPerS");
          const goal = runtime.phase === "shutdown" ? 0 : targetCurrentA;
          const delta = goal - runtime.plasmaCurrentA;
          runtime.plasmaCurrentA += Math.sign(delta) * Math.min(Math.abs(delta), rate * h);
          if (runtime.phase === "shutdown") {
            // Density-limited ramp-down: the control system lowers the current only as
            // fast as the density decays, holding n ≤ SHUTDOWN_GREENWALD_FRACTION · n_G.
            const minimumA =
              (runtime.densityM3 * Math.PI * geometry.minorRadiusM ** 2 * 1e6) /
              (1e20 * SHUTDOWN_GREENWALD_FRACTION);
            runtime.plasmaCurrentA = Math.min(
              Math.max(runtime.plasmaCurrentA, minimumA),
              targetCurrentA,
            );
          }
        }
        const n = runtime.densityM3;
        const T = plasmaTemperatureKeV(runtime.energyJ, n, V);
        const fD = runtime.deuteriumFraction;
        const fusion = dtFusionPower({
          deuteriumDensityM3: fD * n,
          tritiumDensityM3: (1 - fD) * n,
          temperatureKeV: T,
          volumeM3: V,
        });
        const pOhm = tokamak
          ? ohmicHeatingW({
              plasmaCurrentA: runtime.plasmaCurrentA,
              temperatureKeV: T,
              effectiveCharge: zEff,
              majorRadiusM: geometry.majorRadiusM,
              minorRadiusM: geometry.minorRadiusM,
              elongation,
            })
          : 0;
        const pBrems = bremsstrahlungPowerW(n, T, zEff, V);
        const pAux = runtime.phase === "shutdown" ? 0 : auxiliaryHeatingW;
        const heatingW = pAux + fusion.alphaPowerW + pOhm;
        tauE = tokamak
          ? ipb98y2ConfinementTimeS({
              plasmaCurrentMA: amperesToMegaamperes(runtime.plasmaCurrentA),
              toroidalFieldT: fieldT,
              lossPowerMW: Math.max(heatingW, 1e3) * 1e-6,
              densityE19: n * 1e-19,
              ionMassAmu: DT_ION_MASS_AMU,
              majorRadiusM: geometry.majorRadiusM,
              inverseAspectRatio: geometry.minorRadiusM / geometry.majorRadiusM,
              elongation,
            })
          : bohmConfinementTimeS(geometry.minorRadiusM, Math.max(T, 1e-3), fieldT);
        const transport = tauE > 0 ? runtime.energyJ / tauE : h > 0 ? runtime.energyJ / h : 0;
        const tauP = tauE * PARTICLE_TO_ENERGY_CONFINEMENT_RATIO;

        // Density feedback: fuel towards the target, ramped with the current.
        let rate = 0;
        if (runtime.phase !== "shutdown" && targetDensity > 0) {
          const currentFraction =
            tokamak && targetCurrentA > 0 ? runtime.plasmaCurrentA / targetCurrentA : 1;
          const goal = targetDensity * Math.min(1, currentFraction);
          const error = (goal - n) / goal;
          rate = maxRate * Math.min(1, Math.max(0, FUELING_FEEDBACK_GAIN * error));
        }
        const particleLoss = tauP > 0 ? (n * V) / tauP : 0;
        const burn = 2 * fusion.reactionRatePerS;

        runtime.energyJ = Math.max(0, runtime.energyJ + (heatingW - pBrems - transport) * h);
        runtime.densityM3 = Math.max(1e16, n + ((rate - particleLoss - burn) / V) * h);

        fusionW += fusion.fusionPowerW / count;
        alphaW += fusion.alphaPowerW / count;
        neutronW += fusion.neutronPowerW / count;
        ohmicW += pOhm / count;
        bremsW += pBrems / count;
        transportW += transport / count;
        fuelingRate += rate / count;
        exhaust += particleLoss / count;
        wallEnergyJ += (pBrems + transport) * h;
        neutronEnergyJ += fusion.neutronPowerW * h;
      }
      if (dt > 0) runtime.exhaustPerS = exhaust;
    } else {
      runtime.exhaustPerS = 0;
    }

    const T = isRunning(runtime.phase)
      ? plasmaTemperatureKeV(runtime.energyJ, runtime.densityM3, V)
      : 0;
    const n = isRunning(runtime.phase) ? runtime.densityM3 : 0;
    const Ip = isRunning(runtime.phase) ? runtime.plasmaCurrentA : 0;
    const ipMA = amperesToMegaamperes(Ip);
    const beta = n > 0 ? plasmaBeta(n, T, fieldT) : 0;
    const betaN =
      tokamak && ipMA > 0 ? normalisedBeta(beta, geometry.minorRadiusM, fieldT, ipMA) : 0;
    const greenwaldM3 = greenwaldDensityLimitM3(ipMA, geometry.minorRadiusM);
    const greenwaldFraction = tokamak && greenwaldM3 > 0 ? n / greenwaldM3 : 0;
    const q95 =
      tokamak && ipMA > 0
        ? edgeSafetyFactor({
            minorRadiusM: geometry.minorRadiusM,
            majorRadiusM: geometry.majorRadiusM,
            fieldT,
            plasmaCurrentMA: ipMA,
            elongation,
          })
        : Infinity;

    // Deposit plasma exhaust and neutrons.
    if (dt > 0) {
      addHeat(work, vessel.id, wallEnergyJ / dt);
      const neutrons = work.outputs.get(vessel.id) ?? {};
      neutrons["neutronPowerW"] = (neutrons["neutronPowerW"] ?? 0) + neutronEnergyJ / dt;
      work.outputs.set(vessel.id, neutrons);
    }

    // --- Termination ---------------------------------------------------------------------
    const shutdownComplete =
      runtime.phase === "shutdown" &&
      (tokamak ? runtime.plasmaCurrentA <= BREAKDOWN_CURRENT_FRACTION * targetCurrentA : T < 0.05);
    if (isRunning(runtime.phase) && dt > 0 && shutdownComplete) {
      runtime.phase = "ended";
      runtime.statusText = "Plasma ended by a controlled shutdown. Reset the run to start again.";
      runtime.energyJ = 0;
      runtime.densityM3 = 0;
      runtime.plasmaCurrentA = 0;
    } else if (isRunning(runtime.phase) && dt > 0) {
      const disruption = this.#checkDisruption(work, layout, runtime, {
        tokamak,
        greenwaldFraction,
        betaN,
        beta,
        q95,
        fieldT,
        targetCurrentA,
      });
      if (disruption !== undefined) {
        const magneticJ = tokamak
          ? 0.5 * plasmaInductanceH(geometry.majorRadiusM, geometry.minorRadiusM) * Ip * Ip
          : 0;
        const dumpedJ = runtime.energyJ + magneticJ;
        addHeat(work, vessel.id, dumpedJ / dt);
        this.#raise(work, {
          componentId: vessel.id,
          system: "plasma",
          failureType: "disruption",
          unit: disruption.unit,
          measuredValue: disruption.measured,
          limitValue: disruption.limit,
          summary: disruption.summary,
          cause:
            `${disruption.cause} The plasma disrupted: its ${formatQuantity(runtime.energyJ, "J")} of thermal energy` +
            (magneticJ > 0 ? ` and ${formatQuantity(magneticJ, "J")} of magnetic energy` : "") +
            ` struck the wall of vessel "${vessel.id}" within milliseconds.`,
          causeKeys: disruption.causeKeys,
        });
        runtime.phase = "disrupted";
        runtime.statusText = `Disrupted: ${disruption.summary}. Reset the run to try again.`;
        runtime.energyJ = 0;
        runtime.densityM3 = 0;
        runtime.plasmaCurrentA = 0;
        runtime.exhaustPerS = 0;
      } else if (
        runtime.phase === "ramp-up" &&
        (!tokamak || runtime.plasmaCurrentA >= targetCurrentA)
      ) {
        runtime.phase = "flat-top";
        runtime.statusText = "Flat-top: current at target.";
      }
    }

    const live = isRunning(runtime.phase);
    const pAux = live ? auxiliaryHeatingW : 0;
    return Object.freeze({
      phase: runtime.phase,
      configuration: layout.configuration,
      densityM3: live ? runtime.densityM3 : 0,
      temperatureKeV: live ? plasmaTemperatureKeV(runtime.energyJ, runtime.densityM3, V) : 0,
      thermalEnergyJ: live ? runtime.energyJ : 0,
      volumeM3: V,
      majorRadiusM: geometry.majorRadiusM,
      minorRadiusM: geometry.minorRadiusM,
      plasmaCurrentA: live ? runtime.plasmaCurrentA : 0,
      fieldT,
      confinementTimeS: live ? tauE : 0,
      fusionPowerW: fusionW,
      alphaPowerW: alphaW,
      neutronPowerW: neutronW,
      auxiliaryHeatingW: pAux,
      ohmicHeatingW: ohmicW,
      bremsstrahlungW: bremsW,
      transportLossW: transportW,
      fuelingRatePerS: fuelingRate,
      deuteriumFraction: runtime.deuteriumFraction,
      gainQ: pAux > 0 ? fusionW / pAux : fusionW > 0 ? Infinity : 0,
      beta,
      normalisedBeta: betaN,
      greenwaldFraction,
      safetyFactorQ95: Number.isFinite(q95) ? q95 : 0,
      statusText: runtime.statusText,
    });
  }

  #checkDisruption(
    work: Work,
    layout: VesselLayout,
    runtime: VesselRuntime,
    values: {
      tokamak: boolean;
      greenwaldFraction: number;
      betaN: number;
      beta: number;
      q95: number;
      fieldT: number;
      targetCurrentA: number;
    },
  ):
    | {
        summary: string;
        cause: string;
        unit: string;
        measured: number;
        limit: number;
        causeKeys: string[];
      }
    | undefined {
    const vesselId = layout.vesselId;
    const coilKeys = this.#activeKeysFor(layout.coilIds, [
      "quench",
      "magnetic_overstress",
      "over_temperature",
      "supply_shortfall",
    ]);
    const vesselRuntime = this.#components.get(vesselId)!;
    const vessel = work.topology.byId.get(vesselId)!;
    const wallLimitK = getMaterial(vessel.materialId).maxOperatingTemperatureK;

    if (vesselRuntime.temperatureK > wallLimitK) {
      return {
        summary: `Overheated wall of "${vesselId}" poisoned the plasma`,
        cause:
          `The wall of vessel "${vesselId}" reached ${formatQuantity(vesselRuntime.temperatureK, "K")}, above its ` +
          `${formatQuantity(wallLimitK, "K")} operating limit. V0.1 treats an overheated first wall as releasing enough ` +
          `impurities to collapse the plasma.`,
        unit: "K",
        measured: vesselRuntime.temperatureK,
        limit: wallLimitK,
        causeKeys: this.#activeKeysFor([vesselId], ["over_temperature"]),
      };
    }
    if (runtime.pressurePa > DISRUPTION_PRESSURE_PA) {
      return {
        summary: `Vacuum in "${vesselId}" lost`,
        cause:
          `Neutral gas pressure in "${vesselId}" rose to ${formatQuantity(runtime.pressurePa, "Pa")}, above the ` +
          `${DISRUPTION_PRESSURE_PA} Pa ForgeLab allows under a burning plasma; the pumps linked to it could not keep up with the gas load.`,
        unit: "Pa",
        measured: runtime.pressurePa,
        limit: DISRUPTION_PRESSURE_PA,
        causeKeys: this.#activeKeysFor(layout.pumpIds, ["supply_shortfall", "over_temperature"]),
      };
    }
    if (values.tokamak) {
      if (values.q95 < LOW_Q_KINK_LIMIT) {
        return {
          summary:
            coilKeys.length > 0
              ? `Field in "${vesselId}" collapsed below the kink limit`
              : `Edge safety factor fell below 2`,
          cause:
            `With ${formatQuantity(values.fieldT, "T")} of toroidal field and ${formatQuantity(runtime.plasmaCurrentA, "A")} of plasma current ` +
            `the edge safety factor q95 is ${values.q95.toFixed(2)}, below the kink limit of ${LOW_Q_KINK_LIMIT}. ` +
            (coilKeys.length > 0
              ? "The field weakened because its coils lost current. "
              : "Raise the field or lower the plasma current. "),
          unit: "",
          measured: values.q95,
          limit: LOW_Q_KINK_LIMIT,
          causeKeys: coilKeys,
        };
      }
      if (values.greenwaldFraction > 1) {
        return {
          summary: `Density exceeded the Greenwald limit`,
          cause:
            `Plasma density ${formatQuantity(runtime.densityM3, "m^-3")} is ${values.greenwaldFraction.toFixed(2)}× the Greenwald limit ` +
            `n_G = I_p / (π a²) for this current and minor radius. Lower the injector's target density or raise the plasma current.`,
          unit: "",
          measured: values.greenwaldFraction,
          limit: 1,
          causeKeys: [],
        };
      }
      if (values.betaN > TROYON_BETA_N_LIMIT) {
        return {
          summary: `Pressure exceeded the Troyon beta limit`,
          cause:
            `Normalised beta β_N = ${values.betaN.toFixed(2)} exceeds the Troyon limit of ${TROYON_BETA_N_LIMIT}: the plasma pressure is ` +
            `too high for its current and field, and an ideal MHD instability ends the discharge.` +
            (coilKeys.length > 0 ? " The field had weakened because its coils lost current." : ""),
          unit: "",
          measured: values.betaN,
          limit: TROYON_BETA_N_LIMIT,
          causeKeys: coilKeys,
        };
      }
    } else if (values.beta > 1) {
      return {
        summary: `Plasma pressure exceeded the magnetic pressure`,
        cause:
          `Plasma beta ${values.beta.toFixed(2)} exceeds 1: the plasma pushes harder than the ${formatQuantity(values.fieldT, "T")} field can hold.` +
          (coilKeys.length > 0 ? " The field had weakened because its coils lost current." : ""),
        unit: "",
        measured: values.beta,
        limit: 1,
        causeKeys: coilKeys,
      };
    }
    // A plasma whose confining field has gone entirely is lost.
    if (values.fieldT <= 1e-6) {
      return {
        summary: `Confining field in "${vesselId}" lost`,
        cause: `The magnetic field confining the plasma in "${vesselId}" fell to zero.`,
        unit: "T",
        measured: values.fieldT,
        limit: 0,
        causeKeys: coilKeys,
      };
    }
    return undefined;
  }

  /* ---------------------------------------------------------------------------------- *
   * Neutronics: where fusion neutrons deposit their energy
   * ---------------------------------------------------------------------------------- */

  #neutronics(work: Work): void {
    const { topology } = work;
    for (const layout of topology.vessels) {
      const outputs = work.outputs.get(layout.vesselId);
      const neutronW = outputs?.["neutronPowerW"] ?? 0;
      if (!(neutronW > 0)) continue;
      const vessel = topology.byId.get(layout.vesselId)!;
      const wallM = vessel.geometry.wallThicknessM ?? 0;
      const throughWall = Math.exp(-wallM / NEUTRON_ATTENUATION_LENGTH_M);
      addHeat(work, vessel.id, neutronW * (1 - throughWall));
      const vesselRecord = work.outputs.get(vessel.id) ?? {};
      vesselRecord["neutronHeatingW"] = neutronW * (1 - throughWall);
      work.outputs.set(vessel.id, vesselRecord);
      let transmitted = neutronW * throughWall;

      for (const blanketId of layout.blanketIds) {
        const blanket = topology.byId.get(blanketId)!;
        const coverage = numberParameter(blanket.parameters, "coverageFraction");
        const multiplication = numberParameter(blanket.parameters, "energyMultiplication");
        const thickness = blanket.geometry.wallThicknessM ?? 0;
        const absorbed = 1 - Math.exp(-thickness / NEUTRON_ATTENUATION_LENGTH_M);
        const entering = transmitted * coverage;
        const depositedW = entering * absorbed * multiplication;
        addHeat(work, blanketId, depositedW);
        const record = work.outputs.get(blanketId) ?? {};
        record["neutronHeatingW"] = depositedW;
        record["neutronsInW"] = entering;
        work.outputs.set(blanketId, record);
        // Uncovered neutrons stream out of ports: V0.1 does not track where they land.
        transmitted = entering * (1 - absorbed);
      }

      for (const coilId of layout.coilIds) {
        addHeat(work, coilId, transmitted / Math.max(1, layout.coilIds.length));
        const record = work.outputs.get(coilId) ?? {};
        record["nuclearHeatingW"] = transmitted / Math.max(1, layout.coilIds.length);
        record["neutronHeatingW"] = record["nuclearHeatingW"];
        work.outputs.set(coilId, record);
      }
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Coolant loops and component temperatures
   * ---------------------------------------------------------------------------------- */

  #coolantGroups(topology: PlantTopology, components: readonly SimulationComponent[]): LoopGroups {
    const loopRoles = new Set(["coolant-pipe", "coolant-pump", ...COOLED_ROLES]);
    const ids = components
      .filter((c) => loopRoles.has(c.role) && !isSuperconductingCoil(c))
      .map((c) => c.id);
    const connected = new Set<string>();
    for (const link of topology.links.get("coolant") ?? []) {
      connected.add(link.a);
      connected.add(link.b);
    }
    const members = ids.filter((id) => connected.has(id));
    const { groups, linksByGroup } = groupsOver(topology, members, ["coolant"]);
    const loopOfComponent = new Map<string, string>();
    for (const group of groups) for (const id of group) loopOfComponent.set(id, loopId(group));
    return { groups, linksByGroup, loopOfComponent };
  }

  #coolantAndThermal(
    work: Work,
    components: readonly SimulationComponent[],
    loops: LoopGroups,
  ): Map<string, number> {
    const { topology, dt, ambientK } = work;
    const cycleHeat = new Map<string, number>();

    interface LoopWork {
      id: string;
      members: string[];
      fluid: CoolantFluid;
      massFlowKgS: number;
      heatCapacityJK: number;
      cooled: string[];
      exchangers: { id: string; sinkK: number; conductanceWK: number; turbineIds: string[] }[];
      pumpHeatW: number;
      closed: boolean;
      rated: number;
      pressureRisePa: number;
      /** Loop pressure from its bulk temperature (saturation or ideal gas). */
      pressurePa: number;
      /** Pumps whose suction head is below their rating: id → [available, required] m. */
      cavitating: Map<string, readonly [number, number]>;
      rupturedPipes: string[];
    }
    const loopWork: LoopWork[] = [];

    loops.groups.forEach((group, i) => {
      const id = loopId(group);
      const links = loops.linksByGroup[i]!;
      const pumps = group.filter((m) => topology.byId.get(m)!.role === "coolant-pump");
      const fluid = getCoolantFluid(
        pumps.length > 0
          ? stringParameter(topology.byId.get(pumps[0]!)!.parameters, "fluid")
          : "pressurized-water",
      );
      const mixed = pumps.some(
        (m) => stringParameter(topology.byId.get(m)!.parameters, "fluid") !== fluid.id,
      );
      if (mixed)
        work.diagnostics.push(`Loop ${id} mixes coolants; V0.1 uses ${fluid.name} throughout.`);
      // A ruptured pipe opens the loop: its coolant blows down and nothing circulates.
      const rupturedPipes = group.filter(
        (m) => topology.byId.get(m)!.role === "coolant-pipe" && this.#components.get(m)!.disabled,
      );
      const closed =
        links.length >= group.length && group.length >= 2 && rupturedPipes.length === 0;
      const loopTemperatureK = this.#loops.get(id)?.temperatureK ?? ambientK;
      const pressurePa = loopPressurePa(fluid, loopTemperatureK);
      const npshA = npshAvailableM(fluid, loopTemperatureK);
      const cavitating = new Map<string, readonly [number, number]>();

      // Inventory.
      let volumeM3 = 0;
      for (const m of group) {
        const component = topology.byId.get(m)!;
        if (component.role === "coolant-pipe")
          volumeM3 += geometryInteriorVolumeM3(component.geometry);
        else if (COOLED_ROLES.has(component.role)) {
          const d = numberParameter(component.parameters, "channelDiameterM");
          volumeM3 +=
            (Math.PI * d * d * numberParameter(component.parameters, "channelLengthM")) / 4;
        }
      }
      for (const link of links) {
        if (link.run) volumeM3 += (Math.PI * IMPLICIT_HOSE_DIAMETER_M ** 2 * link.lengthM) / 4;
      }

      const rated = pumps.reduce((sum, m) => {
        const pp = topology.byId.get(m)!.parameters;
        return (
          sum + (booleanParameter(pp, "enabled") ? numberParameter(pp, "ratedMassFlowKgS") : 0)
        );
      }, 0);
      const curves = pumps
        .filter((m) => {
          const pp = topology.byId.get(m)!.parameters;
          return booleanParameter(pp, "enabled") && !this.#components.get(m)!.disabled;
        })
        .map((m) => {
          const pp = topology.byId.get(m)!.parameters;
          const curve = pumpCurve({
            ratedHeadM: numberParameter(pp, "ratedHeadM"),
            ratedMassFlowKgS: numberParameter(pp, "ratedMassFlowKgS"),
            speedFraction: Math.cbrt(Math.min(1, work.supply.get(m) ?? 0)),
            fluid,
          });
          // Cavitation: below its rated NPSH a pump's head falls, here in proportion to
          // the head available (DOCUMENTED APPROXIMATION — real head-drop curves are
          // steeper and pump-specific). Water at saturation leaves no head at all.
          const required = numberParameter(pp, "npshRequiredM");
          const headFactor = required > 0 ? Math.min(1, npshA / required) : 1;
          const record = work.outputs.get(m) ?? {};
          record["npshAvailableM"] = Number.isFinite(npshA) ? npshA : -1;
          record["headFraction"] = headFactor;
          work.outputs.set(m, record);
          if (headFactor < 1) cavitating.set(m, [npshA, required]);
          return { ...curve, shutoffPressurePa: curve.shutoffPressurePa * headFactor };
        });

      let massFlowKgS = 0;
      if (closed && curves.length > 0) {
        let guess = rated > 0 ? rated : 1;
        for (let iteration = 0; iteration < 4; iteration += 1) {
          guess = seriesPumpOperatingPoint(
            curves,
            loopResistance(topology, group, links, fluid, guess),
          );
          if (!(guess > 0)) break;
        }
        massFlowKgS = guess;
      }
      const resistance = loopResistance(topology, group, links, fluid, Math.max(massFlowKgS, 1e-6));
      const pressureRisePa = resistance * massFlowKgS * massFlowKgS;

      const exchangers = group
        .filter((m) => topology.byId.get(m)!.role === "heat-exchanger")
        .map((m) => {
          const turbines = neighbours(topology, "steam", m).filter(
            (t) => topology.byId.get(t)?.role === "turbine",
          );
          const sinkK =
            turbines.length > 0
              ? Math.max(
                  ...turbines.map((t) =>
                    numberParameter(topology.byId.get(t)!.parameters, "steamTemperatureK"),
                  ),
                )
              : ambientK;
          return {
            id: m,
            sinkK,
            conductanceWK: numberParameter(
              topology.byId.get(m)!.parameters,
              "secondaryConductanceWK",
            ),
            turbineIds: turbines,
          };
        });

      if (!closed)
        for (const m of group)
          addWarning(work, m, "Its coolant loop is not closed, so nothing circulates.");
      else if (pumps.length === 0)
        for (const m of group) addWarning(work, m, "Its coolant loop has no pump.");

      loopWork.push({
        id,
        members: group,
        fluid,
        massFlowKgS,
        heatCapacityJK: Math.max(volumeM3 * fluid.densityKgM3 * fluid.specificHeatJkgK, 1),
        cooled: group.filter((m) => {
          const role = topology.byId.get(m)!.role;
          return role !== "coolant-pipe" && role !== "coolant-pump" && role !== "heat-exchanger";
        }),
        exchangers,
        pumpHeatW: massFlowKgS > 0 ? (massFlowKgS * pressureRisePa) / fluid.densityKgM3 : 0,
        closed,
        rated,
        pressureRisePa,
        pressurePa,
        cavitating,
        rupturedPipes,
      });
    });

    const { capacity, conduction, outerArea, superconducting } = this.#thermalStatic(
      topology,
      components,
    );

    const toCoolant = new Map<string, number>();
    const toAmbient = new Map<string, number>();
    const hxTransferW = new Map<string, number>();
    const loopPickup = new Map<string, number>();
    const loopRejected = new Map<string, number>();
    const substeps = dt > 0 ? THERMAL_SUBSTEPS : 1;
    const h = dt / substeps;

    for (let step = 0; step < substeps; step += 1) {
      const delta = new Map<string, number>();
      const add = (id: string, w: number) => delta.set(id, (delta.get(id) ?? 0) + w);
      const weight = 1 / substeps;

      // Generated heat.
      for (const component of components) {
        const q = work.heatW.get(component.id) ?? 0;
        if (q !== 0) add(component.id, q);
      }

      // Coolant exchange.
      for (const loop of loopWork) {
        const runtime = this.#loops.get(loop.id)!;
        const capacityRate = loop.massFlowKgS * loop.fluid.specificHeatJkgK;
        let loopNet = loop.pumpHeatW;
        for (const m of loop.cooled) {
          const component = topology.byId.get(m)!;
          const ua = numberParameter(component.parameters, "coolantConductanceWK");
          const epsilon = effectivenessUniformTemperature(ua, capacityRate);
          const temperatureK = this.#components.get(m)!.temperatureK;
          let q = epsilon * capacityRate * (temperatureK - runtime.temperatureK);
          q = clampPair(
            q,
            temperatureK,
            runtime.temperatureK,
            capacity.get(m)!,
            loop.heatCapacityJK,
            h,
          );
          add(m, -q);
          loopNet += q;
          toCoolant.set(m, (toCoolant.get(m) ?? 0) + q * weight);
          loopPickup.set(loop.id, (loopPickup.get(loop.id) ?? 0) + q * weight);
        }
        for (const hx of loop.exchangers) {
          const epsilon = effectivenessUniformTemperature(hx.conductanceWK, capacityRate);
          let q = Math.max(0, epsilon * capacityRate * (runtime.temperatureK - hx.sinkK));
          if (h > 0) q = Math.min(q, ((runtime.temperatureK - hx.sinkK) * loop.heatCapacityJK) / h);
          q = Math.max(0, q);
          loopNet -= q;
          hxTransferW.set(hx.id, (hxTransferW.get(hx.id) ?? 0) + q * weight);
          loopRejected.set(loop.id, (loopRejected.get(loop.id) ?? 0) + q * weight);
        }
        if (h > 0) runtime.temperatureK += (loopNet * h) / loop.heatCapacityJK;
      }

      // Conduction through joints.
      for (const path of conduction) {
        const ta = this.#components.get(path.a)!.temperatureK;
        const tb = this.#components.get(path.b)!.temperatureK;
        const q = clampPair(
          path.conductanceWK * (ta - tb),
          ta,
          tb,
          capacity.get(path.a)!,
          capacity.get(path.b)!,
          h,
        );
        add(path.a, -q);
        add(path.b, q);
      }

      // Surroundings, and the cryoplant for superconducting coils.
      for (const component of components) {
        const runtime = this.#components.get(component.id)!;
        const c = capacity.get(component.id)!;
        if (superconducting.has(component.id)) {
          const p = component.parameters;
          const tOp = numberParameter(p, "operatingTemperatureK");
          add(component.id, numberParameter(p, "staticHeatLeakW"));
          const available =
            numberParameter(p, "cryoCapacityW") * Math.min(1, work.supply.get(component.id) ?? 0);
          const heatNow = delta.get(component.id) ?? 0;
          const excess = h > 0 ? ((runtime.temperatureK - tOp) * c) / h : 0;
          const removed = Math.max(0, Math.min(available, heatNow + excess));
          add(component.id, -removed);
          // Heat the refrigeration cannot take boils the helium bath: ṁ = Q / h_fg.
          if (step === 0) runtime.heliumBoilOffKgS = 0;
          runtime.heliumBoilOffKgS +=
            (Math.max(0, heatNow - removed) / HELIUM_LATENT_HEAT_J_PER_KG) * weight;
          continue;
        }
        const area = outerArea.get(component.id)!;
        const t = runtime.temperatureK;
        let q =
          AMBIENT_CONVECTION_W_M2K * area * (t - ambientK) +
          SURFACE_EMISSIVITY * STEFAN_BOLTZMANN_W_M2_K4 * area * (t ** 4 - ambientK ** 4);
        if (h > 0 && Math.abs(q * h) > Math.abs((t - ambientK) * c)) q = ((t - ambientK) * c) / h;
        add(component.id, -q);
        toAmbient.set(component.id, (toAmbient.get(component.id) ?? 0) + q * weight);
      }

      if (h > 0) {
        for (const [id, w] of delta) {
          const runtime = this.#components.get(id)!;
          runtime.temperatureK = Math.max(1, runtime.temperatureK + (w * h) / capacity.get(id)!);
          if (superconducting.has(id)) {
            const component = topology.byId.get(id)!;
            runtime.temperatureK = Math.max(
              runtime.temperatureK,
              numberParameter(component.parameters, "operatingTemperatureK"),
            );
          }
        }
      }
      // Heat-exchanger, pipe and pump bodies ride at their loop temperature: thin walls
      // wetted by the coolant (a ruptured pipe keeps its last temperature).
      for (const loop of loopWork) {
        const t = this.#loops.get(loop.id)!.temperatureK;
        for (const hx of loop.exchangers) this.#components.get(hx.id)!.temperatureK = t;
        for (const m of loop.members) {
          const role = topology.byId.get(m)!.role;
          const runtime = this.#components.get(m)!;
          if ((role === "coolant-pipe" || role === "coolant-pump") && !runtime.disabled)
            runtime.temperatureK = t;
        }
      }
    }

    for (const loop of loopWork) {
      const runtime = this.#loops.get(loop.id)!;
      const summary: CoolantLoopSummary = Object.freeze({
        id: loop.id,
        componentIds: Object.freeze(loop.members),
        fluidId: loop.fluid.id,
        closed: loop.closed,
        massFlowKgS: loop.massFlowKgS,
        ratedMassFlowKgS: loop.rated,
        pressureRisePa: loop.pressureRisePa,
        pressurePa: loopPressurePa(loop.fluid, runtime.temperatureK),
        temperatureK: runtime.temperatureK,
        heatPickupW: loopPickup.get(loop.id) ?? 0,
        heatRejectedW: loopRejected.get(loop.id) ?? 0,
      });
      work.loops.push(summary);
      for (const m of loop.members) work.loopOf.set(m, summary);
      for (const hx of loop.exchangers) {
        const q = hxTransferW.get(hx.id) ?? 0;
        const record = work.outputs.get(hx.id) ?? {};
        record["heatTransferredW"] = q;
        work.outputs.set(hx.id, record);
        if (hx.turbineIds.length === 0) {
          addWarning(
            work,
            hx.id,
            "No turbine on its steam side: heat is rejected to a cooling tower.",
          );
          continue;
        }
        for (const turbineId of hx.turbineIds) {
          cycleHeat.set(turbineId, (cycleHeat.get(turbineId) ?? 0) + q / hx.turbineIds.length);
        }
      }

      this.#pressureBoundaries(
        work,
        loop.id,
        loop.members,
        loop.fluid,
        runtime.temperatureK,
        loop.pressureRisePa,
      );
      if (dt > 0) {
        this.#cavitation(
          work,
          loop.id,
          loop.members,
          loop.fluid,
          runtime.temperatureK,
          loop.cavitating,
        );
        this.#loopFailures(
          work,
          loop.id,
          loop.members,
          loop.massFlowKgS,
          loop.rated,
          loop.closed,
          runtime.temperatureK,
          loop.fluid,
          loop.rupturedPipes,
        );
      }
    }

    for (const [id, q] of toCoolant) work.heatToCoolantW.set(id, q);
    for (const [id, q] of toAmbient) work.heatToAmbientW.set(id, q);
    return cycleHeat;
  }

  #fieldCache: { topology: PlantTopology; couplings: Map<string, GeometricCoupling> } | undefined;

  /** Geometric field coefficients for coils the analytic models do not cover (cached). */
  #geometricCouplings(topology: PlantTopology): Map<string, GeometricCoupling> {
    if (this.#fieldCache?.topology !== topology)
      this.#fieldCache = { topology, couplings: geometricCouplings(topology) };
    return this.#fieldCache.couplings;
  }

  #thermalCache:
    | {
        topology: PlantTopology;
        capacity: Map<string, number>;
        conduction: { a: string; b: string; conductanceWK: number }[];
        outerArea: Map<string, number>;
        superconducting: Set<string>;
      }
    | undefined;

  /** Heat capacities, surface areas and joint conductances: fixed for a given design. */
  #thermalStatic(topology: PlantTopology, components: readonly SimulationComponent[]) {
    if (this.#thermalCache?.topology === topology) return this.#thermalCache;
    const capacity = new Map<string, number>();
    const outerArea = new Map<string, number>();
    const superconducting = new Set<string>();
    for (const component of components) {
      outerArea.set(component.id, geometryOuterSurfaceM2(component.geometry));
      if (isSuperconductingCoil(component)) {
        superconducting.add(component.id);
        capacity.set(
          component.id,
          component.massKg * numberParameter(component.parameters, "coldMassSpecificHeatJkgK"),
        );
      } else {
        capacity.set(component.id, Math.max(componentHeatCapacityJK(component), 1));
      }
    }
    // Conduction paths over load-bearing joints.
    const conduction: { a: string; b: string; conductanceWK: number }[] = [];
    for (const type of ["structural", "mount"] as const) {
      for (const link of topology.links.get(type) ?? []) {
        const a = topology.byId.get(link.a)!;
        const b = topology.byId.get(link.b)!;
        if (superconducting.has(a.id) || superconducting.has(b.id)) continue;
        const socketOf = (component: SimulationComponent) =>
          link.connection.from.componentId === component.id
            ? link.connection.from.connectionPointId
            : link.connection.to.connectionPointId;
        const conductanceWK = jointConductance(a, socketOf(a), b, socketOf(b));
        if (conductanceWK > 0) conduction.push({ a: a.id, b: b.id, conductanceWK });
      }
    }
    this.#thermalCache = { topology, capacity, conduction, outerArea, superconducting };
    return this.#thermalCache;
  }

  #resistanceCache: { topology: PlantTopology; half: Map<string, number> } | undefined;

  /**
   * Half of each electrical node's resistance: conductors R = ρ(T) L / A at their current
   * temperature (a hot copper bus resists more, so it heats faster), others negligible.
   * Only the geometric factor L / A is cached.
   */
  #halfResistance(topology: PlantTopology, id: string): number {
    if (this.#resistanceCache?.topology !== topology) {
      this.#resistanceCache = { topology, half: new Map() };
    }
    const cache = this.#resistanceCache.half;
    const component = topology.byId.get(id)!;
    if (component.role !== "conductor") return NODE_RESISTANCE_OHM / 2;
    let lengthOverArea = cache.get(id);
    if (lengthOverArea === undefined) {
      lengthOverArea = conductorLengthOverArea(component);
      cache.set(id, lengthOverArea);
    }
    const temperatureK = this.#components.get(id)?.temperatureK ?? AMBIENT_TEMPERATURE_K;
    return (resistivityAt(component.materialId, temperatureK) * lengthOverArea) / 2;
  }

  /**
   * Pressure boundary of each coolant pipe: peak hoop stress at the bore (Lamé) under the
   * loop pressure plus the pumps' pressure rise (the highest pressure in the loop, at the
   * pump discharge — a conservative bound), against the pipe material's yield strength at
   * its temperature. Exceeding it is gross yielding of the wall: the pipe ruptures and the
   * loop opens. Yield is used rather than the ultimate strength, so this is the onset of
   * plastic collapse, not a burst prediction.
   */
  #pressureBoundaries(
    work: Work,
    loopId: string,
    members: readonly string[],
    fluid: CoolantFluid,
    temperatureK: number,
    pressureRisePa: number,
  ): void {
    const { topology } = work;
    const loopPa = loopPressurePa(fluid, temperatureK);
    const internalPa = loopPa + pressureRisePa;
    for (const id of members) {
      const pipe = topology.byId.get(id)!;
      if (pipe.role !== "coolant-pipe" || pipe.geometry.kind !== "cylinder") continue;
      const runtime = this.#components.get(id)!;
      const outerM = pipe.geometry.radiusM;
      const wallM = pipe.geometry.wallThicknessM ?? outerM;
      const innerM = Math.max(0, outerM - wallM);
      const material = getMaterial(pipe.materialId);
      const derating = thermalDerating(pipe.materialId, runtime.temperatureK);
      const yieldPa = material.yieldStrengthPa * derating.yieldFactor;
      const ruptured = runtime.disabled;
      const hoopPa = ruptured ? 0 : lameHoopStressPa(internalPa, innerM, outerM);
      const record = work.outputs.get(id) ?? {};
      record["internalPressurePa"] = ruptured ? 101325 : internalPa;
      record["hoopStressPa"] = hoopPa;
      record["hoopUtilization"] = yieldPa > 0 ? hoopPa / yieldPa : Infinity;
      record["ruptured"] = ruptured ? 1 : 0;
      work.outputs.set(id, record);
      if (ruptured || work.dt === 0 || hoopPa <= yieldPa) continue;
      runtime.disabled = true;
      runtime.disabledReason = "Ruptured: the pressure boundary failed and the loop is open.";
      const saturated =
        fluid.pressureModel === "saturating-water" && loopPa > fluid.systemPressurePa;
      const hot = derating.yieldFactor < 1;
      this.#raise(work, {
        componentId: id,
        system: "fluid",
        failureType: "pipe_rupture",
        unit: "Pa",
        measuredValue: hoopPa,
        limitValue: yieldPa,
        summary: `Pipe "${id}" ruptured`,
        cause:
          `Pipe "${id}" (${material.name}, ${formatQuantity(innerM * 2, "m")} bore, ${formatQuantity(wallM, "m")} wall) holds ` +
          `${fluid.name} at ${formatQuantity(internalPa, "Pa")}` +
          (saturated
            ? ` — the water in loop ${loopId} is at ${formatQuantity(temperatureK, "K")}, hotter than saturation at its ` +
              `${formatQuantity(fluid.systemPressurePa, "Pa")} system pressure, so it boils and the loop pressure follows the saturation curve (IAPWS-IF97); this design has no relief valve`
            : fluid.pressureModel === "ideal-gas" && loopPa > fluid.systemPressurePa
              ? ` — the gas in the closed loop has heated to ${formatQuantity(temperatureK, "K")} and its pressure has risen in proportion`
              : "") +
          `. The peak hoop stress at the bore is ${formatQuantity(hoopPa, "Pa")} (Lamé), above the wall's ` +
          `${formatQuantity(yieldPa, "Pa")} yield strength` +
          (hot ? deratingNote(material.name, runtime.temperatureK, derating) : ".") +
          ` The wall yields and tears: coolant blows down through the break and circulation in loop ${loopId} stops.`,
        causeKeys: this.#activeKeysFor(members, [
          "coolant_boiling",
          "loss_of_flow",
          "over_temperature",
        ]),
      });
    }
  }

  /** Pumps cavitating because the water at their inlet is near saturation. */
  #cavitation(
    work: Work,
    loopId: string,
    members: readonly string[],
    fluid: CoolantFluid,
    temperatureK: number,
    cavitating: ReadonlyMap<string, readonly [number, number]>,
  ): void {
    for (const [pump, [available, required]] of cavitating) {
      this.#raise(work, {
        componentId: pump,
        system: "fluid",
        failureType: "pump_cavitation",
        unit: "m",
        measuredValue: available,
        limitValue: required,
        summary: `Pump "${pump}" is cavitating`,
        cause:
          `${fluid.name} in loop ${loopId} is at ${formatQuantity(temperatureK, "K")}, where its vapour pressure is ` +
          `${formatQuantity(waterSaturationPressurePa(temperatureK), "Pa")} (IAPWS-IF97). That leaves pump "${pump}" ` +
          `${formatQuantity(available, "m")} of suction head against the ${formatQuantity(required, "m")} it needs: vapour ` +
          `bubbles form in the impeller eye and collapse against the blades, and the pump's head falls` +
          (available <= 0 ? " to nothing — the water at its inlet is boiling." : "."),
        causeKeys: this.#activeKeysFor(members, ["coolant_boiling", "loss_of_flow"]),
      });
    }
  }

  #loopFailures(
    work: Work,
    id: string,
    members: readonly string[],
    massFlowKgS: number,
    rated: number,
    closed: boolean,
    temperatureK: number,
    fluid: CoolantFluid,
    rupturedPipes: readonly string[],
  ): void {
    const { topology } = work;
    const heated = members.some((m) => (work.heatW.get(m) ?? 0) > 1e3);
    const pumps = members.filter((m) => topology.byId.get(m)!.role === "coolant-pump");
    if (
      heated &&
      (!closed || pumps.length === 0 || massFlowKgS < LOSS_OF_FLOW_FRACTION * rated || rated <= 0)
    ) {
      const pumpId = pumps[0] ?? members[0]!;
      const reasons: string[] = [];
      const causeKeys: string[] = [];
      for (const pipe of rupturedPipes) reasons.push(`pipe "${pipe}" has ruptured`);
      causeKeys.push(...this.#activeKeysFor([...rupturedPipes], ["pipe_rupture"]));
      if (!closed && rupturedPipes.length === 0) reasons.push("the loop is not closed");
      if (pumps.length === 0) reasons.push("the loop has no pump");
      for (const pump of pumps) {
        const component = topology.byId.get(pump)!;
        const supply = work.supply.get(pump) ?? 0;
        if (!booleanParameter(component.parameters, "enabled"))
          reasons.push(`pump "${pump}" is switched off`);
        else if (this.#components.get(pump)!.disabled) reasons.push(`pump "${pump}" has failed`);
        else if (supply < 1) {
          reasons.push(`pump "${pump}" receives only ${(100 * supply).toFixed(0)} % of its power`);
        }
        if (
          topology.byId.get(pump) !== undefined &&
          (work.outputs.get(pump)?.["headFraction"] ?? 1) < 1
        )
          reasons.push(`pump "${pump}" is cavitating`);
        causeKeys.push(
          ...this.#activeKeysFor(
            [pump],
            ["supply_shortfall", "over_temperature", "pump_cavitation"],
          ),
        );
      }
      this.#raise(work, {
        componentId: pumpId,
        system: "fluid",
        failureType: "loss_of_flow",
        unit: "kg/s",
        measuredValue: massFlowKgS,
        limitValue: LOSS_OF_FLOW_FRACTION * rated,
        summary: pumps.length > 0 ? `Pump "${pumpId}" lost flow` : `Loop ${id} has no circulation`,
        cause:
          `Coolant loop ${id} is circulating ${formatQuantity(massFlowKgS, "kg/s")}` +
          (rated > 0
            ? `, under ${(LOSS_OF_FLOW_FRACTION * 100).toFixed(0)} % of its pumps' rated ${formatQuantity(rated, "kg/s")}`
            : "") +
          ` while components on it are generating heat` +
          (reasons.length > 0 ? `: ${reasons.join(", ")}.` : "."),
        causeKeys,
      });
    }
    if (temperatureK > fluid.maxTemperatureK) {
      this.#raise(work, {
        componentId: pumps[0] ?? members[0]!,
        system: "fluid",
        failureType: "coolant_boiling",
        unit: "K",
        measuredValue: temperatureK,
        limitValue: fluid.maxTemperatureK,
        summary: `Coolant in loop ${id} overheated`,
        cause:
          `${fluid.name} in loop ${id} reached ${formatQuantity(temperatureK, "K")}, above the ${formatQuantity(fluid.maxTemperatureK, "K")} ` +
          `limit for ${fluid.state}. The loop is picking up more heat than its heat exchangers reject.`,
        causeKeys: this.#activeKeysFor(members, ["loss_of_flow"]),
      });
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Power conversion
   * ---------------------------------------------------------------------------------- */

  #powerConversion(
    work: Work,
    components: readonly SimulationComponent[],
    cycleHeat: ReadonlyMap<string, number>,
  ): { thermalToCycleW: number; grossElectricW: number } {
    const { topology } = work;
    let thermalToCycleW = 0;
    let grossElectricW = 0;
    for (const turbine of components) {
      if (turbine.role !== "turbine") continue;
      const p = turbine.parameters;
      const heatW = Math.min(
        cycleHeat.get(turbine.id) ?? 0,
        numberParameter(p, "ratedThermalPowerW"),
      );
      const carnot =
        1 - numberParameter(p, "condenserTemperatureK") / numberParameter(p, "steamTemperatureK");
      const efficiency = Math.max(0, numberParameter(p, "fractionOfCarnot") * carnot);
      const shaftW = heatW * efficiency;
      thermalToCycleW += heatW;
      work.outputs.set(turbine.id, {
        ...(work.outputs.get(turbine.id) ?? {}),
        thermalInW: heatW,
        shaftPowerW: shaftW,
        cycleEfficiency: efficiency,
      });
      const generators = neighbours(topology, "shaft", turbine.id).filter(
        (id) => topology.byId.get(id)?.role === "generator",
      );
      if (generators.length === 0 && heatW > 0)
        addWarning(work, turbine.id, "No generator on its shaft: the power is wasted.");
      for (const generatorId of generators) {
        const generator = topology.byId.get(generatorId)!;
        const electricW = Math.min(
          (shaftW / generators.length) * numberParameter(generator.parameters, "efficiency"),
          numberParameter(generator.parameters, "ratedPowerW"),
        );
        const runtime = this.#components.get(generatorId)!;
        if (work.dt > 0) runtime.generatorOutputW = electricW;
        grossElectricW += runtime.generatorOutputW;
        work.outputs.set(generatorId, {
          ...(work.outputs.get(generatorId) ?? {}),
          electricalOutputW: runtime.generatorOutputW,
        });
      }
      if (heatW <= 0)
        addWarning(
          work,
          turbine.id,
          "Receiving no heat: its heat exchanger's coolant is not hotter than the live-steam temperature.",
        );
    }
    return { thermalToCycleW, grossElectricW };
  }

  /* ---------------------------------------------------------------------------------- *
   * Temperature limits
   * ---------------------------------------------------------------------------------- */

  #thermalFailures(work: Work, components: readonly SimulationComponent[]): void {
    if (work.dt === 0) return;
    const { topology } = work;
    for (const component of components) {
      const runtime = this.#components.get(component.id)!;
      if (isSuperconductingCoil(component)) {
        const p = component.parameters;
        const peakFieldT = work.magnets.get(component.id)?.peakFieldT ?? 0;
        const tCrit = coilCriticalTemperatureK(p, peakFieldT);
        if (!runtime.quenched && runtime.temperatureK > tCrit) {
          runtime.quenched = true;
          runtime.quenchedAtSec = work.timeSec;
          const nuclear = work.outputs.get(component.id)?.["nuclearHeatingW"] ?? 0;
          const supply = work.supply.get(component.id) ?? 0;
          const capacity = numberParameter(p, "cryoCapacityW");
          const tOp = numberParameter(p, "operatingTemperatureK");
          const conductor = stringParameter(p, "conductor");
          const catalogued = conductor !== "" && conductor !== "rated";
          const sc = catalogued ? getSubstance(conductor) : null;
          // Field-limited: the conductor cannot be superconducting at this field even at its
          // operating temperature — no amount of refrigeration would have prevented it.
          const fieldLimited = sc !== null && tCrit <= tOp;
          const magnet = work.magnets.get(component.id);
          const protection =
            ` The winding stores ${formatQuantity(magnet?.storedEnergyJ ?? 0, "J")}` +
            ` (½LI², L = ${formatQuantity(magnet?.inductanceH ?? 0, "H")}). Protection opens the dump circuit after` +
            ` its ${formatQuantity(numberParameter(p, "quenchDetectionDelayS"), "s")} detection time and discharges it` +
            ` with a ${formatQuantity(numberParameter(p, "dumpTimeConstantS"), "s")} time constant.`;
          const bc20 = sc?.superconductor?.upperCriticalFieldZeroTemperatureT ?? Infinity;
          this.#raise(work, {
            componentId: component.id,
            system: "magnetic",
            failureType: "quench",
            unit: "K",
            measuredValue: runtime.temperatureK,
            limitValue: tCrit,
            summary: fieldLimited
              ? `Coil "${component.id}" quenched: field too high for ${sc!.name}`
              : `Coil "${component.id}" quenched`,
            cause: fieldLimited
              ? `Superconducting coil "${component.id}" reaches a peak field of ${formatQuantity(peakFieldT, "T")}. ` +
                (peakFieldT >= bc20
                  ? `That is above ${sc!.name}'s ${formatQuantity(bc20, "T")} upper critical field, so it cannot be superconducting at any temperature. `
                  : `At that field ${sc!.name} stays superconducting only below ${formatQuantity(tCrit, "K")}, colder than the coil's ${formatQuantity(tOp, "K")} operating temperature. `) +
                `It quenched as soon as it carried this current.` +
                protection
              : `Superconducting coil "${component.id}" warmed to ${formatQuantity(runtime.temperatureK, "K")}, above its ` +
                `${formatQuantity(tCrit, "K")} critical temperature` +
                (sc !== null
                  ? ` (${sc.name} at its ${formatQuantity(peakFieldT, "T")} peak field)`
                  : "") +
                `, and quenched. Heat reaching the cold mass ` +
                `(${formatQuantity(numberParameter(p, "staticHeatLeakW"), "W")} static leak` +
                (nuclear > 0 ? ` plus ${formatQuantity(nuclear, "W")} of neutron heating` : "") +
                `) exceeded the ${formatQuantity(capacity * Math.min(1, supply), "W")} of refrigeration available` +
                (supply < 1
                  ? ` (the cryoplant receives only ${(100 * supply).toFixed(0)} % of its power)`
                  : "") +
                `.` +
                protection,
            causeKeys: fieldLimited
              ? []
              : this.#activeKeysFor([component.id], ["supply_shortfall"]),
          });
        }
        continue;
      }
      const limit = getMaterial(component.materialId).maxOperatingTemperatureK;
      if (runtime.temperatureK <= limit) continue;
      const loop = work.loopOf.get(component.id);
      const causeKeys =
        loop !== undefined
          ? this.#activeKeysFor(loop.componentIds, ["loss_of_flow", "coolant_boiling"])
          : [];
      const generated = work.heatW.get(component.id) ?? 0;
      let consequence = "";
      if (component.role === "conductor" && !runtime.disabled) {
        runtime.disabled = true;
        runtime.disabledReason = "Burned out: it no longer conducts.";
        consequence = " It burned out and no longer conducts.";
      } else if (component.role === "magnet-coil" && !runtime.disabled) {
        runtime.disabled = true;
        runtime.disabledReason = "Tripped on over-temperature; protection dumped its current.";
        consequence = " Protection tripped the coil and is dumping its current.";
      } else if (component.role === "coolant-pump" && !runtime.disabled) {
        runtime.disabled = true;
        runtime.disabledReason = "Seized on over-temperature.";
        consequence = " The pump seized.";
      }
      const heatSource =
        component.role === "conductor"
          ? `${formatQuantity(generated, "W")} of I²R heating`
          : generated > 0
            ? `${formatQuantity(generated, "W")} of heat`
            : "heat conducted into it";
      this.#raise(work, {
        componentId: component.id,
        system: "thermal",
        failureType: "over_temperature",
        unit: "K",
        measuredValue: runtime.temperatureK,
        limitValue: limit,
        summary: `"${component.id}" exceeded its operating temperature`,
        cause:
          `"${component.id}" reached ${formatQuantity(runtime.temperatureK, "K")}, above the ${formatQuantity(limit, "K")} ` +
          `limit for ${getMaterial(component.materialId).name}. It receives ${heatSource}` +
          (loop === undefined
            ? " and is not on any coolant loop, so only the surrounding air carries heat away."
            : ` and its coolant loop removes ${formatQuantity(work.heatToCoolantW.get(component.id) ?? 0, "W")}.`) +
          consequence,
        causeKeys,
      });
      void topology;
    }
  }

  /* ---------------------------------------------------------------------------------- *
   * Publication
   * ---------------------------------------------------------------------------------- */

  #publish(work: Work, component: SimulationComponent): ComponentPlantState {
    const runtime = this.#components.get(component.id)!;
    const loop = work.loopOf.get(component.id);
    const superconducting = isSuperconductingCoil(component);
    const limit = superconducting
      ? coilCriticalTemperatureK(
          component.parameters,
          work.magnets.get(component.id)?.peakFieldT ?? 0,
        )
      : getMaterial(component.materialId).maxOperatingTemperatureK;
    const warnings = [...(work.warnings.get(component.id) ?? [])];
    if (runtime.disabled) warnings.unshift(runtime.disabledReason);
    if (runtime.quenched) warnings.unshift("Quenched: superconductivity lost.");
    const outputs = { ...(work.outputs.get(component.id) ?? {}) };
    if (component.role === "coolant-pump" && loop !== undefined) {
      outputs["massFlowKgS"] = loop.massFlowKgS;
      outputs["pressureRisePa"] = loop.pressureRisePa;
    }
    return Object.freeze({
      thermal: Object.freeze({
        temperatureK: runtime.temperatureK,
        limitTemperatureK: limit,
        heatGeneratedW: work.heatW.get(component.id) ?? 0,
        heatToCoolantW: work.heatToCoolantW.get(component.id) ?? 0,
        heatToAmbientW: work.heatToAmbientW.get(component.id) ?? 0,
      }),
      electrical: work.electrical.get(component.id) ?? null,
      coolant:
        loop === undefined
          ? null
          : Object.freeze({
              loopId: loop.id,
              massFlowKgS: loop.massFlowKgS,
              coolantTemperatureK: loop.temperatureK,
              pressureDropPa: loop.pressureRisePa,
            }),
      magnet: work.magnets.get(component.id) ?? null,
      vessel: work.vessels.get(component.id) ?? null,
      outputs: Object.freeze(outputs),
      warnings: Object.freeze([...new Set(warnings)]),
      disabled: runtime.disabled,
    });
  }

  #recordReadings(
    work: Work,
    components: readonly SimulationComponent[],
    states: ReadonlyMap<string, ComponentPlantState>,
  ): void {
    const { topology } = work;
    for (const sensor of components) {
      if (sensor.role !== "sensor") continue;
      const target = neighbours(topology, "control", sensor.id).find((id) => {
        const role = topology.byId.get(id)?.role;
        return role !== "controller" && role !== "sensor";
      });
      if (target === undefined) continue;
      const state = states.get(target);
      if (state === undefined) continue;
      const quantity = stringParameter(sensor.parameters, "quantity");
      const reading =
        quantity === "temperature"
          ? state.thermal.temperatureK
          : quantity === "coolant-flow"
            ? (state.coolant?.massFlowKgS ?? 0)
            : quantity === "pressure"
              ? (state.vessel?.pressurePa ?? 0)
              : quantity === "fusion-power"
                ? (state.vessel?.plasma.fusionPowerW ?? 0)
                : (state.magnet?.fieldAtPlasmaT ?? state.vessel?.plasma.fieldT ?? 0);
      this.#readings.set(sensor.id, reading);
      const published = states.get(sensor.id);
      if (published !== undefined) {
        const outputs = { ...published.outputs, reading };
        (states as Map<string, ComponentPlantState>).set(
          sensor.id,
          Object.freeze({ ...published, outputs: Object.freeze(outputs) }),
        );
      }
    }
  }

  #metrics(
    work: Work,
    components: readonly SimulationComponent[],
    states: ReadonlyMap<string, ComponentPlantState>,
    conversion: { thermalToCycleW: number; grossElectricW: number },
  ): PlantMetrics {
    let fusionPowerW = 0;
    let alphaPowerW = 0;
    let neutronPowerW = 0;
    let auxiliaryHeatingW = 0;
    let burning = 0;
    for (const vessel of work.vessels.values()) {
      fusionPowerW += vessel.plasma.fusionPowerW;
      alphaPowerW += vessel.plasma.alphaPowerW;
      neutronPowerW += vessel.plasma.neutronPowerW;
      auxiliaryHeatingW += vessel.plasma.auxiliaryHeatingW;
      if (isRunning(vessel.plasma.phase)) burning += 1;
    }
    let houseLoadW = 0;
    let gridImportW = 0;
    for (const island of work.islands) {
      houseLoadW += island.deliveredW + island.lossW;
      gridImportW += island.gridImportW;
    }
    let peakTemperatureK = work.ambientK;
    for (const component of components) {
      if (isSuperconductingCoil(component)) continue;
      peakTemperatureK = Math.max(peakTemperatureK, states.get(component.id)!.thermal.temperatureK);
    }
    // Generation counts once it reaches a network. On an island with a grid connection a
    // surplus is exported; on an isolated island only what the loads use is counted.
    let grossElectricW = 0;
    for (const island of work.islands) {
      const hasGrid = island.componentIds.some(
        (id) => work.topology.byId.get(id)?.role === "power-supply",
      );
      if (!hasGrid) {
        grossElectricW += island.generationW;
        continue;
      }
      for (const id of island.componentIds) {
        if (work.topology.byId.get(id)?.role === "generator") {
          grossElectricW += this.#components.get(id)?.generatorOutputW ?? 0;
        }
      }
    }
    void conversion.grossElectricW;
    return Object.freeze({
      fusionPowerW,
      alphaPowerW,
      neutronPowerW,
      auxiliaryHeatingW,
      plasmaGainQ:
        auxiliaryHeatingW > 0 ? fusionPowerW / auxiliaryHeatingW : fusionPowerW > 0 ? Infinity : 0,
      thermalPowerToCycleW: conversion.thermalToCycleW,
      grossElectricW,
      houseLoadW,
      netElectricW: grossElectricW - houseLoadW,
      gridImportW,
      engineeringGain: houseLoadW > 0 ? grossElectricW / houseLoadW : 0,
      peakTemperatureK,
      burningVesselCount: burning,
    });
  }

  /* ---------------------------------------------------------------------------------- *
   * Events and causal chains
   * ---------------------------------------------------------------------------------- */

  #activeKeysFor(componentIds: readonly string[], types: readonly string[]): string[] {
    const keys: string[] = [];
    for (const [key, event] of this.#raised) {
      if (componentIds.includes(event.componentId) && types.includes(event.failureType))
        keys.push(key);
    }
    return keys.sort();
  }

  #raise(
    work: Work,
    event: {
      componentId: string;
      system: FailureEvent["system"];
      failureType: string;
      unit: string;
      measuredValue: number;
      limitValue: number;
      summary: string;
      cause: string;
      causeKeys: readonly string[];
    },
  ): void {
    const key = failureKey(event);
    if (this.#raised.has(key)) return;
    const causeKeys = [...new Set(event.causeKeys)].filter((k) => k !== key && this.#raised.has(k));
    const upstream = causeKeys.length > 0 ? (this.#chains.get(causeKeys[0]!) ?? []) : [];
    const chain: CausalLink[] = [
      ...upstream,
      {
        componentId: event.componentId,
        system: event.system,
        failureType: event.failureType,
        summary: event.summary,
      },
    ];
    const failure: FailureEvent = Object.freeze({
      timestampSec: work.timeSec,
      tick: work.tick,
      componentId: event.componentId,
      system: event.system,
      failureType: event.failureType,
      cause: event.cause,
      measuredValue: event.measuredValue,
      limitValue: event.limitValue,
      unit: event.unit,
      utilization: event.limitValue !== 0 ? Math.abs(event.measuredValue / event.limitValue) : 0,
      loadPathComponentIds: Object.freeze([]),
      summary: event.summary,
      causeKeys: Object.freeze(causeKeys),
      causalChain: Object.freeze(chain.map((link) => Object.freeze(link))),
    });
    this.#raised.set(key, failure);
    this.#chains.set(key, failure.causalChain ?? []);
    work.events.push(failure);
  }

  get lastStates(): ReadonlyMap<string, ComponentPlantState> {
    return this.#lastStates;
  }
}

/* ------------------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------------------ */

interface LoopGroups {
  readonly groups: string[][];
  readonly linksByGroup: PlantLink[][];
  readonly loopOfComponent: ReadonlyMap<string, string>;
}

interface PlasmaGeometry {
  readonly volumeM3: number;
  readonly majorRadiusM: number;
  readonly minorRadiusM: number;
}

function loopId(group: readonly string[]): string {
  return `loop:${group[0]}`;
}

function isRunning(phase: PlasmaPhase): boolean {
  return phase === "ramp-up" || phase === "flat-top" || phase === "shutdown";
}

/**
 * The temperature above which a superconducting coil quenches. A Rated conductor uses its
 * fixed parameter; a catalogued conductor uses its critical surface Tc(B) at the coil's
 * peak field (zero current → zero field → Tc0). This is Tc(B), not the lower
 * current-sharing temperature, which would also need Jc(B,T) and the winding's current
 * density — so it is an upper bound on the real margin.
 */
export function coilCriticalTemperatureK(
  parameters: ComponentParameters,
  peakFieldT: number,
): number {
  const conductor = stringParameter(parameters, "conductor");
  if (conductor === "" || conductor === "rated")
    return numberParameter(parameters, "criticalTemperatureK");
  const sc = getSubstance(conductor).superconductor;
  if (sc === undefined) return numberParameter(parameters, "criticalTemperatureK");
  return criticalTemperatureK(sc, Math.abs(peakFieldT));
}

function isSuperconductingCoil(component: SimulationComponent): boolean {
  return (
    component.role === "magnet-coil" && booleanParameter(component.parameters, "superconducting")
  );
}

function addHeat(work: Work, id: string, watts: number): void {
  if (!Number.isFinite(watts) || watts === 0) return;
  work.heatW.set(id, (work.heatW.get(id) ?? 0) + watts);
}

function addWarning(work: Work, id: string, text: string): void {
  const list = work.warnings.get(id) ?? [];
  if (!list.includes(text)) list.push(text);
  work.warnings.set(id, list);
}

function sensorUnit(quantity: string): string {
  switch (quantity) {
    case "temperature":
      return "K";
    case "coolant-flow":
      return "kg/s";
    case "pressure":
      return "Pa";
    case "fusion-power":
      return "W";
    default:
      return "T";
  }
}

/** Gas load from outgassing and leaks, Pa·m³/s. */
function baseGasLoad(vessel: SimulationComponent): number {
  return (
    numberParameter(vessel.parameters, "outgassingPaM3PerSM2") *
      geometryInteriorSurfaceM2(vessel.geometry) +
    numberParameter(vessel.parameters, "leakRatePaM3PerS")
  );
}

function plasmaGeometry(vessel: SimulationComponent): PlasmaGeometry {
  const geometry = vessel.geometry;
  const fill = numberParameter(vessel.parameters, "plasmaFillFraction");
  const t = geometry.wallThicknessM ?? 0;
  if (geometry.kind === "torus") {
    const minorRadiusM = Math.max(0, (geometry.minorRadiusM - t) * fill);
    return {
      majorRadiusM: geometry.majorRadiusM,
      minorRadiusM,
      volumeM3: toroidalPlasmaVolumeM3(
        geometry.majorRadiusM,
        minorRadiusM,
        numberParameter(vessel.parameters, "elongation"),
      ),
    };
  }
  if (geometry.kind === "cylinder") {
    const minorRadiusM = Math.max(0, (geometry.radiusM - t) * fill);
    const lengthM = Math.max(0, geometry.heightM - 2 * t);
    return {
      majorRadiusM: 0,
      minorRadiusM,
      volumeM3: cylindricalPlasmaVolumeM3(minorRadiusM, lengthM),
    };
  }
  return { majorRadiusM: 0, minorRadiusM: 0, volumeM3: 0 };
}

function placement(component: SimulationComponent) {
  return { geometry: component.geometry, placement: currentTransform(component) };
}

function coilFieldAtVessel(
  coil: SimulationComponent,
  vessel: SimulationComponent,
  turns: number,
  currentA: number,
): number {
  if (vessel.geometry.kind === "torus")
    return toroidalFieldT(turns, currentA, vessel.geometry.majorRadiusM);
  if (coil.geometry.kind !== "cylinder") return 0;
  const relation = coaxialRelation(placement(coil), placement(vessel));
  return solenoidOnAxisFieldT({
    turns,
    currentA,
    lengthM: coil.geometry.heightM,
    radiusM: coil.geometry.radiusM - (coil.geometry.wallThicknessM ?? 0) / 2,
    axialOffsetM: relation.axialOffsetM,
  });
}

/** Latent heat of vaporisation of helium at 4.222 K, J/kg (material library). */
const HELIUM_LATENT_HEAT_J_PER_KG = findFluid("helium")!.latentHeatOfVaporization!.value;

/** Self-inductance of a coil's winding from its geometry. */
function coilInductanceH(coil: SimulationComponent, turns: number): number {
  const geometry = coil.geometry;
  if (geometry.kind === "torus" && torusWinding(coil) === "loop")
    return loopInductanceH(turns, geometry.majorRadiusM, geometry.minorRadiusM);
  if (geometry.kind === "torus")
    return toroidalInductanceH(turns, geometry.majorRadiusM, geometry.minorRadiusM);
  if (geometry.kind === "cylinder")
    return solenoidInductanceH(turns, geometry.radiusM, geometry.heightM);
  return 0;
}

/** Peak field on the winding and the casing geometry the magnetic pressure acts on. */
function coilPeak(
  coil: SimulationComponent,
  turns: number,
  currentA: number,
): { peakFieldT: number; radiusM: number; wallM: number } {
  const geometry = coil.geometry;
  const wallM = geometry.wallThicknessM ?? 0;
  if (geometry.kind === "torus" && torusWinding(coil) === "loop")
    return {
      peakFieldT: loopPeakFieldT(turns * currentA, geometry.majorRadiusM, geometry.minorRadiusM),
      radiusM: geometry.majorRadiusM,
      wallM,
    };
  if (geometry.kind === "torus") {
    const innerLegM = Math.max(geometry.majorRadiusM - geometry.minorRadiusM, 1e-3);
    return {
      peakFieldT: toroidalFieldT(turns, currentA, innerLegM),
      radiusM: geometry.minorRadiusM,
      wallM,
    };
  }
  if (geometry.kind === "cylinder") {
    const peakFieldT = solenoidOnAxisFieldT({
      turns,
      currentA,
      lengthM: geometry.heightM,
      radiusM: geometry.radiusM,
      axialOffsetM: 0,
    });
    return { peakFieldT, radiusM: geometry.radiusM, wallM };
  }
  return { peakFieldT: 0, radiusM: 0, wallM };
}

function coilStructuralStressPa(
  coil: SimulationComponent,
  turns: number,
  currentA: number,
  peakFieldT: number,
): number {
  const geometry = coil.geometry;
  const wallM = geometry.wallThicknessM ?? 0;
  if (geometry.kind === "torus" && torusWinding(coil) === "loop") {
    // The casing is the tube's wall (or, without one, the whole winding section).
    const a = geometry.minorRadiusM;
    const inner = Math.max(0, a - wallM);
    return loopHoopStressPa({
      ampereTurns: turns * currentA,
      ringRadiusM: geometry.majorRadiusM,
      windingRadiusM: a,
      casingAreaM2: Math.PI * (a * a - (wallM > 0 ? inner * inner : 0)),
    });
  }
  if (geometry.kind === "torus") {
    return toroidalCoilTensionStressPa({
      ampereTurns: turns * currentA,
      innerLegRadiusM: geometry.majorRadiusM - geometry.minorRadiusM,
      outerLegRadiusM: geometry.majorRadiusM + geometry.minorRadiusM,
      midplaneAreaM2: sectionAreaPerpendicularToLocalAxis(geometry, geometry.axis),
    });
  }
  const radiusM = geometry.kind === "cylinder" ? geometry.radiusM : 0;
  return magneticHoopStressPa(peakFieldT, radiusM, wallM);
}

/**
 * Resistance of a resistive coil: copper winding of N turns, R = ρ(T) N l_turn / A, with
 * copper's tabulated resistivity at the winding temperature.
 */
function resistiveCoilOhm(coil: SimulationComponent, temperatureK: number): number {
  const turns = numberParameter(coil.parameters, "turns");
  const area = numberParameter(coil.parameters, "conductorAreaM2");
  const geometry = coil.geometry;
  const turnLengthM =
    geometry.kind === "torus"
      ? 2 *
        Math.PI *
        (torusWinding(coil) === "loop" ? geometry.majorRadiusM : geometry.minorRadiusM)
      : geometry.kind === "cylinder" || geometry.kind === "arc"
        ? 2 * Math.PI * geometry.radiusM
        : 2 * (geometry.sizeM.x + geometry.sizeM.z);
  return (resistivityAt("copper", temperatureK) * turns * turnLengthM) / area;
}

/** L / A of a conductor part, along its longest axis (R = ρ L / A). */
function conductorLengthOverArea(conductor: SimulationComponent): number {
  const geometry = conductor.geometry;
  const lengthM = Math.max(
    extentAlongAxis(geometry, "x"),
    extentAlongAxis(geometry, "y"),
    extentAlongAxis(geometry, "z"),
  );
  return lengthM / numberParameter(conductor.parameters, "crossSectionM2");
}

function linkResistanceOhm(link: PlantLink): number {
  return link.run ? (COPPER_RESISTIVITY_OHM_M * link.lengthM) / IMPLICIT_CABLE_AREA_M2 : 0;
}

function loopResistance(
  topology: PlantTopology,
  group: readonly string[],
  links: readonly PlantLink[],
  fluid: CoolantFluid,
  massFlowKgS: number,
): number {
  let r = 0;
  for (const id of group) {
    const component = topology.byId.get(id)!;
    if (component.role === "coolant-pipe") {
      const geometry = component.geometry;
      if (geometry.kind !== "cylinder") continue;
      r += hydraulicResistance({
        lengthM: geometry.heightM,
        diameterM: 2 * (geometry.radiusM - (geometry.wallThicknessM ?? 0)),
        lossCoefficient: 0,
        massFlowKgS,
        fluid,
      });
    } else if (COOLED_ROLES.has(component.role)) {
      r += hydraulicResistance({
        lengthM: numberParameter(component.parameters, "channelLengthM"),
        diameterM: numberParameter(component.parameters, "channelDiameterM"),
        lossCoefficient: numberParameter(component.parameters, "channelLossCoefficient"),
        massFlowKgS,
        fluid,
      });
    }
  }
  for (const link of links) {
    if (!link.run) continue;
    r += hydraulicResistance({
      lengthM: link.lengthM,
      diameterM: IMPLICIT_HOSE_DIAMETER_M,
      lossCoefficient: 0,
      massFlowKgS,
      fluid,
    });
  }
  return r;
}

/**
 * Conductance of a bolted/welded joint between two parts, W/K: two lumped conduction
 * resistances in series, each L_i / (k_i A), where A is the smaller of the two member
 * sections at the joint and L_i is the distance from each part's centre to the socket.
 * DOCUMENTED APPROXIMATION: perfect contact, no interface resistance.
 */
function jointConductance(
  a: SimulationComponent,
  socketA: string,
  b: SimulationComponent,
  socketB: string,
): number {
  const section = (component: SimulationComponent, socketId: string) => {
    const socket = component.connectionPoints.find((s) => s.id === socketId);
    if (socket === undefined) return { area: 0, length: 0 };
    const area = sectionAreaPerpendicularToLocalAxis(
      component.geometry,
      dominantLocalAxis(socket.localDirection),
    );
    const world = localPointToWorld(currentTransform(component), socket.localPosition);
    const length = Math.max(Vec3Math.distance(world, component.state.physical.positionM), 0.05);
    return { area, length };
  };
  const sa = section(a, socketA);
  const sb = section(b, socketB);
  const area = Math.min(sa.area, sb.area);
  if (!(area > 0)) return 0;
  const ka = getMaterial(a.materialId).thermalConductivityWmK;
  const kb = getMaterial(b.materialId).thermalConductivityWmK;
  return 1 / (sa.length / (ka * area) + sb.length / (kb * area));
}

/** Limits a pairwise heat flow over one substep so it cannot overshoot equilibrium. */
function clampPair(q: number, ta: number, tb: number, ca: number, cb: number, h: number): number {
  if (!(h > 0)) return q;
  const maxJ = (Math.abs(ta - tb) * ca * cb) / (ca + cb);
  const limit = maxJ / h;
  return Math.max(-limit, Math.min(limit, q));
}

export type { ComponentParameters, ComponentGeometry };
