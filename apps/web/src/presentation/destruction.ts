import { failureKey, type FailureEvent } from "@forgelab/sim-core";
import { plantCentre, type ComponentReading, type PlantReading } from "./reading.js";

/**
 * Turning a simulated failure into something to show.
 *
 * Input: a `FailureEvent` the simulation raised, plus the published state around it.
 * Output: a `DestructionEvent` that tells effects where, how big, and which family. The
 * energy estimate scales effects only; it never leaves the presentation layer and nothing
 * here can create, prevent or alter a failure.
 */
export type FailureFamily =
  | "electrical"
  | "brownout"
  | "coolant"
  | "flow"
  | "cryogenic"
  | "quench"
  | "structural"
  | "disruption"
  | "thermal"
  | "plasma"
  | "control";

export type StructuralState = "intact" | "damaged" | "severe" | "fractured";

export interface DestructionEvent {
  readonly eventId: string;
  readonly simulationTime: number;
  readonly componentId: string;
  /**
   * Where the effect happens, when that is not the failed part itself: a loop's boiling is
   * attributed to its pump, but steam vents where the loop is hottest.
   */
  readonly siteComponentId: string;
  readonly worldPosition: readonly [number, number, number];
  readonly worldDirection: readonly [number, number, number];
  readonly failureType: string;
  readonly family: FailureFamily;
  /** 0..1, drives effect budgets within the family. */
  readonly severity: number;
  /** Presentation estimate from published values, J. */
  readonly estimatedEnergy: number;
  readonly temperature: number;
  readonly pressure: number | null;
  readonly electricalState: "energised" | "de-energised" | "none";
  readonly structuralState: StructuralState;
  readonly fluidType?: string;
  readonly affectedComponentIds: readonly string[];
  readonly causalFailureId?: string;
  /** Radius of the failed part, m (placement only). */
  readonly radiusM: number;
  readonly summary: string;
  /** Whether a plausible combustible is present at the site (cable insulation, oil). */
  readonly combustible: boolean;
}

const MU0 = 4e-7 * Math.PI;

const STRUCTURAL_TYPES = new Set([
  "yield_exceeded",
  "buckling",
  "bending_yield",
  "connection_overload",
  "magnetic_overstress",
]);

/** Which family a raised failure belongs to. Pure. */
export function familyOf(failure: FailureEvent, part: ComponentReading | undefined): FailureFamily {
  const t = failure.failureType;
  if (STRUCTURAL_TYPES.has(t)) return "structural";
  switch (t) {
    case "disruption":
      return "disruption";
    case "quench":
      return "quench";
    case "coolant_boiling":
      return "coolant";
    case "loss_of_flow":
      return "flow";
    case "interlock_trip":
      return "control";
    case "supply_shortfall":
      return part?.superconducting === true ? "cryogenic" : "brownout";
    case "over_temperature":
      if (part?.role === "conductor" || part?.role === "power-supply" || part?.role === "switch")
        return "electrical";
      return "thermal";
    default:
      return failure.system === "plasma"
        ? "plasma"
        : failure.system === "electrical"
          ? "brownout"
          : "thermal";
  }
}

/** Presentation-only energy estimate, J (see docs/SHOWROOM.md). */
export function estimateEnergyJ(
  family: FailureFamily,
  part: ComponentReading | undefined,
  previous: PlantReading | null,
  failure: FailureEvent,
): number {
  switch (family) {
    case "disruption": {
      const v = previous?.vessels[failure.componentId];
      return Math.max(v?.plasma.thermalEnergyJ ?? 0, 1e4);
    }
    case "quench":
    case "cryogenic": {
      const b = part?.fieldT ?? 0;
      const vol = part?.volumeM3 ?? 1;
      return Math.max(((b * b) / (2 * MU0)) * vol, 1e4);
    }
    case "electrical":
    case "brownout":
      return Math.max((part?.powerW ?? 0) * 0.05, 1e3);
    case "coolant":
    case "flow":
      return Math.max((part?.heatW ?? 0) * 1, 1e4);
    case "structural":
      return Math.max(1e4 * (failure.utilization || 1) * Math.max(1, part?.volumeM3 ?? 1), 1e4);
    default:
      return Math.max(part?.heatW ?? 0, 1e3);
  }
}

/** Severity 0..1: log-scaled energy, clamped per family. */
export function severityOf(family: FailureFamily, energyJ: number, utilization: number): number {
  const log = Math.log10(Math.max(energyJ, 1));
  const [lo, hi] = RANGES[family];
  const base = Math.min(1, Math.max(0, (log - 3) / 7)); // 1 kJ → 0, 10 GJ → 1
  const over = Number.isFinite(utilization) ? Math.min(0.2, Math.max(0, utilization - 1) * 0.2) : 0;
  return Math.min(hi, Math.max(lo, lo + (hi - lo) * base + over));
}

const RANGES: Readonly<Record<FailureFamily, readonly [number, number]>> = {
  electrical: [0.35, 0.8],
  brownout: [0.05, 0.25],
  coolant: [0.3, 0.8],
  flow: [0.05, 0.25],
  cryogenic: [0.2, 0.6],
  quench: [0.45, 0.95],
  structural: [0.4, 1],
  disruption: [0.5, 1],
  thermal: [0.1, 0.5],
  plasma: [0.15, 0.45],
  control: [0, 0.1],
};

const COMBUSTIBLE_ROLES = new Set([
  "conductor",
  "power-supply",
  "switch",
  "generator",
  "turbine",
  "controller",
]);

/** Builds the presentation event for a raised failure. Pure. */
export function destructionEvent(
  failure: FailureEvent,
  reading: PlantReading,
  previous: PlantReading | null,
): DestructionEvent {
  const failedPart = reading.components.find((c) => c.id === failure.componentId);
  const family = familyOf(failure, failedPart);
  const loopOf = reading.loops.find((l) => l.componentIds.includes(failure.componentId));
  // Coolant releases happen at the hottest part of the loop (published temperatures).
  const site =
    family === "coolant" && loopOf !== undefined
      ? reading.components
          .filter((c) => loopOf.componentIds.includes(c.id))
          .reduce<ComponentReading | undefined>(
            (hot, c) => (hot === undefined || c.temperatureK > hot.temperatureK ? c : hot),
            undefined,
          )
      : failedPart;
  const part = site ?? failedPart;
  const energy = estimateEnergyJ(family, part, previous, failure);
  const severity = severityOf(family, energy, failure.utilization);
  const position = part?.position ?? [0, 1, 0];
  const centre = plantCentre(reading);
  let dx = position[0] - centre[0];
  let dz = position[2] - centre[2];
  const len = Math.hypot(dx, dz);
  if (len > 1e-3) {
    dx /= len;
    dz /= len;
  } else {
    dx = 0;
    dz = 0;
  }
  const up = family === "coolant" || family === "disruption" ? 0.8 : 0.5;
  const norm = Math.hypot(dx, up, dz);
  const loop = reading.loops.find((l) => l.componentIds.includes(failure.componentId));
  const vessel = reading.vessels[failure.componentId];
  const chain = failure.causalChain ?? [];
  const root = chain.length > 1 ? chain[0] : undefined;
  const affected = new Set<string>([
    ...failure.loadPathComponentIds,
    ...chain.map((l) => l.componentId),
  ]);
  affected.delete(failure.componentId);
  const structuralState: StructuralState =
    family === "structural" || family === "disruption" || family === "quench"
      ? severity > 0.75
        ? "fractured"
        : severity > 0.5
          ? "severe"
          : "damaged"
      : family === "electrical" || family === "coolant" || family === "thermal"
        ? "damaged"
        : "intact";
  return {
    eventId: failureKey(failure),
    simulationTime: failure.timestampSec,
    componentId: failure.componentId,
    siteComponentId: part?.id ?? failure.componentId,
    worldPosition: position,
    worldDirection: [dx / norm, up / norm, dz / norm],
    failureType: failure.failureType,
    family,
    severity,
    estimatedEnergy: energy,
    temperature: part?.temperatureK ?? 293.15,
    pressure: vessel?.pressurePa ?? null,
    electricalState:
      part === undefined || (!part.isLoad && part.powerW === 0)
        ? "none"
        : part.powerW > 0 && !part.disabled
          ? "energised"
          : "de-energised",
    structuralState,
    ...(loop !== undefined ? { fluidType: loop.fluidId } : {}),
    affectedComponentIds: [...affected],
    ...(root !== undefined
      ? {
          causalFailureId: failureKey({
            componentId: root.componentId,
            failureType: root.failureType,
          }),
        }
      : {}),
    radiusM: part?.radiusM ?? 1,
    summary: failure.summary ?? failure.failureType.replace(/_/g, " "),
    combustible: part !== undefined && COMBUSTIBLE_ROLES.has(part.role),
  };
}
