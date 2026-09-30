import { PlantConstants, type VesselState } from "@forgelab/sim-core";
import type { PlantReading } from "./reading.js";

/**
 * Activation stages, observed — never driven.
 *
 * ACTIVATE starts the simulation clock and nothing else. Each stage below is marked
 * reached when the state the solver published satisfies it; the thresholds for vacuum
 * and field are the solver's own breakdown constants. A stage that the physics does not
 * reach stalls, and the explanation shown is the solver's own sentence where it has one.
 */
export type StageId =
  "electrical" | "cooling" | "cryogenics" | "vacuum" | "magnets" | "fuel" | "ignition" | "fusion";

export const STAGE_LABELS: Readonly<Record<StageId, string>> = Object.freeze({
  electrical: "Power",
  cooling: "Cooling",
  cryogenics: "Cryo",
  vacuum: "Vacuum",
  magnets: "Magnets",
  fuel: "Fuel & heat",
  ignition: "Ignition",
  fusion: "Fusion",
});

const ORDER: readonly StageId[] = [
  "electrical",
  "cooling",
  "cryogenics",
  "vacuum",
  "magnets",
  "fuel",
  "ignition",
  "fusion",
];

export interface StageCheck {
  readonly id: StageId;
  /** The design has something this stage applies to. */
  readonly applicable: boolean;
  readonly met: boolean;
  /** Measured state in words: what is holding it, or how it stands. */
  readonly detail: string;
}

const pct = (x: number) => `${Math.round(100 * Math.max(0, x))} %`;
const PLASMA_ACTIVE = new Set(["ramp-up", "flat-top", "shutdown", "ended", "disrupted"]);

function plasmaVessels(r: PlantReading): Array<[string, VesselState]> {
  return Object.entries(r.vessels).filter(([, v]) => v.plasma.configuration !== "none");
}

/** Which stages the current published state satisfies. Pure. */
export function checkStages(r: PlantReading): StageCheck[] {
  const vessels = plasmaVessels(r);
  const hasPlasma = vessels.length > 0;
  const waiting = vessels.find(([, v]) => v.plasma.phase === "off")?.[1].plasma.statusText;

  // Electrical: every island with demand is supplied.
  const demanding = r.islands.filter((i) => i.demandW > 0);
  const worstIsland = demanding.reduce<(typeof demanding)[number] | null>(
    (w, i) => (w === null || i.supplyFraction < w.supplyFraction ? i : w),
    null,
  );
  const electrical: StageCheck = {
    id: "electrical",
    applicable: demanding.length > 0,
    met: demanding.length > 0 && demanding.every((i) => i.supplyFraction >= 0.95),
    detail:
      worstIsland === null
        ? "Nothing draws power."
        : `Network supplies ${pct(worstIsland.supplyFraction)} of ${fmtW(worstIsland.demandW)} demand.`,
  };

  // Cooling: every pumped loop is closed and carries at least half its rated flow.
  const pumped = r.loops.filter((l) => l.ratedMassFlowKgS > 0);
  const worstLoop = pumped.reduce<(typeof pumped)[number] | null>(
    (w, l) =>
      w === null || l.massFlowKgS / l.ratedMassFlowKgS < w.massFlowKgS / w.ratedMassFlowKgS ? l : w,
    null,
  );
  const cooling: StageCheck = {
    id: "cooling",
    applicable: pumped.length > 0,
    met:
      pumped.length > 0 &&
      pumped.every((l) => l.closed && l.massFlowKgS >= 0.5 * l.ratedMassFlowKgS),
    detail:
      worstLoop === null
        ? "No pumped coolant loop."
        : !worstLoop.closed
          ? "A coolant loop is open: flow has no return path."
          : `Coolant flow ${pct(worstLoop.massFlowKgS / worstLoop.ratedMassFlowKgS)} of rated.`,
  };

  // Cryogenics: superconducting coils cold, cryoplant powered.
  const sc = r.components.filter((c) => c.superconducting);
  const warm = sc.find(
    (c) => c.disabled || c.supplyFraction < 0.95 || c.temperatureK >= c.limitTemperatureK,
  );
  const cryogenics: StageCheck = {
    id: "cryogenics",
    applicable: sc.length > 0,
    met: sc.length > 0 && warm === undefined,
    detail:
      warm === undefined
        ? sc.length > 0
          ? `Coils at ${sc[0]!.temperatureK.toFixed(1)} K.`
          : "No superconducting coils."
        : warm.disabled
          ? `Coil "${warm.id}" is out of service.`
          : warm.supplyFraction < 0.95
            ? `Cryoplant of "${warm.id}" receives ${pct(warm.supplyFraction)} of its power.`
            : `Coil "${warm.id}" at ${warm.temperatureK.toFixed(1)} K, limit ${warm.limitTemperatureK.toFixed(1)} K.`,
  };

  // The solver only breaks a plasma down once vacuum, field and fuel are all satisfied, so
  // a plasma that has started proves them even though fuelling raises the pressure after.
  const started = vessels.some(([, v]) => PLASMA_ACTIVE.has(v.plasma.phase));
  const maxPressure = Math.max(0, ...vessels.map(([, v]) => v.pressurePa));
  const vacuum: StageCheck = {
    id: "vacuum",
    applicable: hasPlasma,
    met: hasPlasma && (started || maxPressure <= PlantConstants.BREAKDOWN_MAX_PRESSURE_PA),
    detail: !hasPlasma
      ? "No vacuum vessel."
      : started
        ? `Pumped down for breakdown; ${maxPressure.toExponential(1)} Pa with fuel gas.`
        : `${maxPressure.toExponential(1)} Pa (breakdown needs ≤ ${PlantConstants.BREAKDOWN_MAX_PRESSURE_PA} Pa).`,
  };

  const fieldShort = vessels.find(([, v]) => v.plasma.fieldT < breakdownField(v));
  const magnets: StageCheck = {
    id: "magnets",
    applicable: hasPlasma,
    met: hasPlasma && (started || fieldShort === undefined),
    detail:
      fieldShort === undefined
        ? hasPlasma
          ? `Field ${vessels[0]![1].plasma.fieldT.toFixed(2)} T at the plasma.`
          : "No vessel to confine."
        : `Field ${fieldShort[1].plasma.fieldT.toFixed(2)} T (breakdown needs ${breakdownField(fieldShort[1])} T).`,
  };

  const feeders = r.components.filter(
    (c) => c.role === "fuel-injector" || c.role === "plasma-heater",
  );
  const unfed = feeders.find((c) => c.disabled || c.supplyFraction <= 0.5);
  const fuel: StageCheck = {
    id: "fuel",
    applicable: hasPlasma,
    met:
      hasPlasma &&
      (started || (feeders.some((c) => c.role === "fuel-injector") && unfed === undefined)),
    detail:
      unfed !== undefined
        ? `"${unfed.id}" has ${pct(unfed.supplyFraction)} of its power.`
        : feeders.some((c) => c.role === "fuel-injector")
          ? "Injectors and heaters powered."
          : "No fuel injector.",
  };

  const ignition: StageCheck = {
    id: "ignition",
    applicable: hasPlasma,
    met: started,
    detail: waiting ?? vessels[0]?.[1].plasma.statusText ?? "No vessel.",
  };

  const burning = vessels.find(
    ([, v]) => v.plasma.phase === "flat-top" && v.plasma.fusionPowerW > 0,
  );
  const fusion: StageCheck = {
    id: "fusion",
    applicable: hasPlasma,
    met: burning !== undefined,
    detail:
      burning !== undefined
        ? `${fmtW(burning[1].plasma.fusionPowerW)} fusion, Q ${fmtQ(burning[1].plasma.gainQ)}.`
        : (vessels[0]?.[1].plasma.statusText ?? "No vessel."),
  };

  return [electrical, cooling, cryogenics, vacuum, magnets, fuel, ignition, fusion];
}

function breakdownField(v: VesselState): number {
  return v.plasma.configuration === "tokamak"
    ? PlantConstants.BREAKDOWN_MIN_FIELD_TOKAMAK_T
    : PlantConstants.BREAKDOWN_MIN_FIELD_LINEAR_T;
}

export type StageStatus = "pending" | "active" | "done" | "stalled" | "skipped" | "lost";

export interface StageProgress {
  readonly id: StageId;
  readonly label: string;
  readonly status: StageStatus;
  readonly detail: string;
  /** Simulated time the stage was first met, or null. */
  readonly reachedAtSec: number | null;
}

/** Simulated seconds a stage may stay unmet before it is reported as stalled. */
export const STALL_AFTER_SEC = 12;

/**
 * Latches when each stage is first reached and decides which one is in progress. A stage
 * that was reached and is later lost (the network browned out, a pump seized) shows as
 * "lost" — the plant does not re-run its startup, it has a problem.
 */
export class ActivationTracker {
  #reached = new Map<StageId, number>();
  #activeSince = 0;
  #active: StageId | null = null;
  #lastTime = -1;

  reset(): void {
    this.#reached.clear();
    this.#activeSince = 0;
    this.#active = null;
    this.#lastTime = -1;
  }

  update(r: PlantReading): StageProgress[] {
    if (r.timeSec < this.#lastTime) this.reset();
    this.#lastTime = r.timeSec;
    const checks = checkStages(r);
    const plasmaEnded = Object.values(r.vessels).some(
      (v) => v.plasma.phase === "disrupted" || v.plasma.phase === "ended",
    );
    for (const check of checks) {
      if (check.applicable && check.met && !this.#reached.has(check.id))
        this.#reached.set(check.id, r.timeSec);
    }
    const next = checks.find((c) => c.applicable && !this.#reached.has(c.id))?.id ?? null;
    if (next !== this.#active) {
      this.#active = next;
      this.#activeSince = r.timeSec;
    }
    return ORDER.map((id) => {
      const check = checks.find((c) => c.id === id)!;
      const reachedAtSec = this.#reached.get(id) ?? null;
      let status: StageStatus;
      if (!check.applicable) status = "skipped";
      else if (reachedAtSec !== null) status = check.met || isLatched(id) ? "done" : "lost";
      else if (id === next)
        status =
          plasmaEnded || r.timeSec - this.#activeSince > STALL_AFTER_SEC ? "stalled" : "active";
      else status = "pending";
      return { id, label: STAGE_LABELS[id], status, detail: check.detail, reachedAtSec };
    });
  }
}

/** Stages that describe an event (it happened) rather than a condition that must hold. */
function isLatched(id: StageId): boolean {
  return id === "ignition" || id === "fuel" || id === "vacuum" || id === "fusion";
}

/** The stage the plant is working on, or the one it stalled at. */
export function currentStage(stages: readonly StageProgress[]): StageProgress | null {
  return stages.find((s) => s.status === "active" || s.status === "stalled") ?? null;
}

export function fmtW(w: number): string {
  const a = Math.abs(w);
  if (a >= 1e9) return `${(w / 1e9).toFixed(2)} GW`;
  if (a >= 1e6) return `${(w / 1e6).toFixed(1)} MW`;
  if (a >= 1e3) return `${(w / 1e3).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}

function fmtQ(q: number): string {
  return Number.isFinite(q) ? q.toFixed(2) : "∞";
}
