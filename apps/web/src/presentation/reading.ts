import {
  geometryLocalHalfExtentsM,
  geometryVolumeM3,
  type CoolantLoopSummary,
  type ElectricalIslandSummary,
  type PlantMetrics,
  type PlantRole,
  type SimulationComponent,
  type VesselState,
} from "@forgelab/sim-core";
import { frameScalar, type SessionFrame } from "@forgelab/sim-runner";

/**
 * One frame of published simulation state, flattened for the presentation layer. Built
 * from a `SessionFrame` and the design's component list; every number is a value the
 * simulation published. Nothing here is computed physics.
 */
export interface ComponentReading {
  readonly id: string;
  readonly type: string;
  readonly role: PlantRole;
  readonly materialId: string;
  readonly superconducting: boolean;
  readonly position: readonly [number, number, number];
  /** Rough half-size of the part (bounding radius), m — for effect placement only. */
  readonly radiusM: number;
  /** Envelope volume, m³ — for effect scaling only. */
  readonly volumeM3: number;
  readonly temperatureK: number;
  readonly limitTemperatureK: number;
  readonly utilization: number;
  readonly supplyFraction: number;
  readonly powerW: number;
  readonly massFlowKgS: number;
  readonly fieldT: number;
  readonly heatW: number;
  readonly disabled: boolean;
  readonly free: boolean;
  /** Whether this part draws power (a load) by role. */
  readonly isLoad: boolean;
  /** Pipes: pressure held by the wall, Pa (0 when not a pipe). */
  readonly internalPressurePa: number;
  /** Pipe wall or magnet casing: stress ÷ yield. */
  readonly hoopUtilization: number;
  /** Pumps: head left by cavitation (1 when not cavitating). */
  readonly headFraction: number;
  /** Magnets: ½ L I², J. */
  readonly storedEnergyJ: number;
  /** Magnets: power into the dump resistor, W. */
  readonly dumpPowerW: number;
  /** Superconducting magnets: helium boil-off, kg/s. */
  readonly heliumBoilOffKgS: number;
  /** Magnets: seconds since the quench began (−1 if none). */
  readonly quenchAgeS: number;
  /** Net heat received through space (radiant and flame), W. */
  readonly spatialHeatInW: number;
  /** Its fire's heat release rate, W (0 when not burning). */
  readonly heatReleaseW: number;
  /** Burnable fuel left ÷ fuel at start; −1 when nothing in it burns. */
  readonly fuelFraction: number;
  readonly burning: boolean;
}

export interface PlantReading {
  readonly timeSec: number;
  readonly tick: number;
  readonly running: boolean;
  readonly metrics: PlantMetrics;
  readonly islands: readonly ElectricalIslandSummary[];
  readonly loops: readonly CoolantLoopSummary[];
  readonly vessels: Readonly<Record<string, VesselState>>;
  readonly components: readonly ComponentReading[];
}

const LOAD_ROLES: ReadonlySet<PlantRole> = new Set([
  "magnet-coil",
  "fuel-injector",
  "plasma-heater",
  "vacuum-pump",
  "coolant-pump",
  "controller",
  "sensor",
]);

export function readingFromFrame(
  frame: SessionFrame,
  components: readonly SimulationComponent[],
): PlantReading {
  const byId = new Map(components.map((c) => [c.id, c]));
  const out: ComponentReading[] = [];
  frame.ids.forEach((id, i) => {
    const c = byId.get(id);
    if (c === undefined) return;
    const t = frame.transforms;
    const o = i * 7;
    out.push({
      ...staticPart(c),
      position: [t[o]!, t[o + 1]!, t[o + 2]!],
      temperatureK: frameScalar(frame, i, "temperatureK"),
      limitTemperatureK: frameScalar(frame, i, "limitTemperatureK"),
      utilization: frameScalar(frame, i, "utilization"),
      supplyFraction: frameScalar(frame, i, "supplyFraction"),
      powerW: frameScalar(frame, i, "electricalPowerW"),
      massFlowKgS: frameScalar(frame, i, "massFlowKgS"),
      fieldT: frameScalar(frame, i, "fieldT"),
      heatW: frameScalar(frame, i, "heatGeneratedW"),
      disabled: frameScalar(frame, i, "disabled") > 0,
      free: frameScalar(frame, i, "free") > 0,
      internalPressurePa: frameScalar(frame, i, "internalPressurePa"),
      hoopUtilization: frameScalar(frame, i, "hoopUtilization"),
      headFraction: frameScalar(frame, i, "headFraction"),
      storedEnergyJ: frameScalar(frame, i, "storedEnergyJ"),
      dumpPowerW: frameScalar(frame, i, "dumpPowerW"),
      heliumBoilOffKgS: frameScalar(frame, i, "heliumBoilOffKgS"),
      quenchAgeS: frameScalar(frame, i, "quenchAgeS"),
      spatialHeatInW: frameScalar(frame, i, "spatialHeatInW"),
      heatReleaseW: frameScalar(frame, i, "heatReleaseW"),
      fuelFraction: frameScalar(frame, i, "fuelFraction"),
      burning: frameScalar(frame, i, "burning") > 0,
    });
  });
  return {
    timeSec: frame.timeSec,
    tick: frame.tick,
    running: frame.speed !== 0,
    metrics: frame.plant.metrics,
    islands: frame.plant.islands,
    loops: frame.plant.loops,
    vessels: frame.vessels,
    components: out,
  };
}

function staticPart(c: SimulationComponent) {
  const h = geometryLocalHalfExtentsM(c.geometry);
  return {
    id: c.id,
    type: c.type,
    role: c.role,
    materialId: c.materialId,
    superconducting: c.role === "magnet-coil" && c.parameters["superconducting"] === true,
    radiusM: Math.hypot(h.x, h.y, h.z),
    volumeM3: Math.max(0, geometryVolumeM3(c.geometry)),
    isLoad: LOAD_ROLES.has(c.role),
  };
}

/** Plant centre in the horizontal plane, from the parts' positions. */
export function plantCentre(reading: PlantReading): [number, number, number] {
  const n = reading.components.length;
  if (n === 0) return [0, 0, 0];
  let x = 0;
  let z = 0;
  for (const c of reading.components) {
    x += c.position[0];
    z += c.position[2];
  }
  return [x / n, 0, z / n];
}
