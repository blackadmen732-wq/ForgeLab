import type { DestructionEvent } from "./destruction.js";
import type { PlantReading } from "./reading.js";

/**
 * The run report: what this run achieved and how close it came to its limits, summarised
 * from published state as the run goes (constant memory, however long the run).
 *
 * Every figure is a value the simulation published or a time integral of one. Nothing is
 * scored by the presentation layer — "best" means the largest published value seen.
 */
export interface Margin {
  readonly componentId: string;
  /** measured / limit at the worst moment (1 = at the limit). */
  readonly fraction: number;
  readonly atSec: number;
}

export interface RunReport {
  readonly runtimeSec: number;
  /** Simulated seconds with a plasma in ramp-up or flat-top. */
  readonly plasmaSec: number;
  /** Simulated seconds burning (flat-top with fusion power). */
  readonly burnSec: number;
  readonly peakFusionW: number;
  /** Largest finite plasma gain seen. */
  readonly peakGainQ: number;
  readonly peakGrossElectricW: number;
  /** Mean house load while burning (or over the run with no burn). */
  readonly meanHouseLoadW: number;
  /** Mean net electric while burning (gross − house load); null without a burn. */
  readonly meanNetElectricBurnW: number | null;
  readonly peakNetElectricW: number;
  /** Closest any part came to its temperature limit (superconductors excluded). */
  readonly thermalMargin: Margin | null;
  /** Closest any part came to its structural limit. */
  readonly structuralMargin: Margin | null;
  readonly failureCount: number;
  /** The failure the chain started from, if any. */
  readonly rootFailure: {
    readonly componentId: string;
    readonly summary: string;
    readonly atSec: number;
  } | null;
  /** The run ended with the plant intact and burning or shut down cleanly. */
  readonly clean: boolean;
}

export class RunAccumulator {
  #start = 0;
  #last: number | null = null;
  #plasma = 0;
  #burn = 0;
  #peakFusion = 0;
  #peakQ = 0;
  #peakGross = 0;
  #peakNet = -Infinity;
  #houseIntegral = 0;
  #houseTime = 0;
  #houseBurnIntegral = 0;
  #netBurnIntegral = 0;
  #thermal: Margin | null = null;
  #structural: Margin | null = null;

  reset(): void {
    this.#start = 0;
    this.#last = null;
    this.#plasma = 0;
    this.#burn = 0;
    this.#peakFusion = 0;
    this.#peakQ = 0;
    this.#peakGross = 0;
    this.#peakNet = -Infinity;
    this.#houseIntegral = 0;
    this.#houseTime = 0;
    this.#houseBurnIntegral = 0;
    this.#netBurnIntegral = 0;
    this.#thermal = null;
    this.#structural = null;
  }

  add(r: PlantReading): void {
    if (this.#last === null) {
      this.#start = r.timeSec;
      this.#last = r.timeSec;
    }
    const dt = Math.max(0, r.timeSec - this.#last);
    this.#last = r.timeSec;
    const vessels = Object.values(r.vessels);
    const plasma = vessels.some(
      (v) => v.plasma.phase === "ramp-up" || v.plasma.phase === "flat-top",
    );
    const burning = vessels.some((v) => v.plasma.phase === "flat-top" && v.plasma.fusionPowerW > 0);
    const m = r.metrics;
    if (plasma) this.#plasma += dt;
    if (burning) {
      this.#burn += dt;
      this.#houseBurnIntegral += m.houseLoadW * dt;
      this.#netBurnIntegral += m.netElectricW * dt;
    }
    this.#houseIntegral += m.houseLoadW * dt;
    this.#houseTime += dt;
    this.#peakFusion = Math.max(this.#peakFusion, m.fusionPowerW);
    if (Number.isFinite(m.plasmaGainQ)) this.#peakQ = Math.max(this.#peakQ, m.plasmaGainQ);
    this.#peakGross = Math.max(this.#peakGross, m.grossElectricW);
    this.#peakNet = Math.max(this.#peakNet, m.netElectricW);
    for (const c of r.components) {
      if (c.limitTemperatureK > 0 && !c.superconducting) {
        const f = c.temperatureK / c.limitTemperatureK;
        if (this.#thermal === null || f > this.#thermal.fraction)
          this.#thermal = { componentId: c.id, fraction: f, atSec: r.timeSec };
      }
      if (c.utilization > 0 && Number.isFinite(c.utilization)) {
        if (this.#structural === null || c.utilization > this.#structural.fraction)
          this.#structural = { componentId: c.id, fraction: c.utilization, atSec: r.timeSec };
      }
    }
  }

  report(destructions: readonly DestructionEvent[], root: DestructionEvent | null): RunReport {
    const runtime = this.#last === null ? 0 : this.#last - this.#start;
    const burn = this.#burn;
    return {
      runtimeSec: runtime,
      plasmaSec: this.#plasma,
      burnSec: burn,
      peakFusionW: this.#peakFusion,
      peakGainQ: this.#peakQ,
      peakGrossElectricW: this.#peakGross,
      meanHouseLoadW:
        burn > 0
          ? this.#houseBurnIntegral / burn
          : this.#houseTime > 0
            ? this.#houseIntegral / this.#houseTime
            : 0,
      meanNetElectricBurnW: burn > 0 ? this.#netBurnIntegral / burn : null,
      peakNetElectricW: Number.isFinite(this.#peakNet) ? this.#peakNet : 0,
      thermalMargin: this.#thermal,
      structuralMargin: this.#structural,
      failureCount: destructions.filter((d) => d.family !== "control").length,
      rootFailure:
        root === null
          ? null
          : { componentId: root.componentId, summary: root.summary, atSec: root.simulationTime },
      clean: destructions.every((d) => d.family === "control"),
    };
  }
}

/* ------------------------------------------------------------------------------------ *
 * Personal bests (per design, per browser)
 * ------------------------------------------------------------------------------------ */

export interface Bests {
  readonly peakFusionW: number;
  readonly peakGainQ: number;
  readonly longestBurnSec: number;
  /** Best mean net electric over a burn; null until a run has burned. */
  readonly bestMeanNetW: number | null;
}

export const NO_BESTS: Bests = Object.freeze({
  peakFusionW: 0,
  peakGainQ: 0,
  longestBurnSec: 0,
  bestMeanNetW: null,
});

export type BestKey = keyof Bests;

/** Which figures this run improved, and the updated bests. Pure. */
export function mergeBests(
  previous: Bests,
  report: RunReport,
): { bests: Bests; improved: readonly BestKey[] } {
  const improved: BestKey[] = [];
  const better = (key: BestKey, value: number, old: number) => {
    if (!(value > old)) return old;
    improved.push(key);
    return value;
  };
  const bests: Bests = {
    peakFusionW: better("peakFusionW", report.peakFusionW, previous.peakFusionW),
    peakGainQ: better("peakGainQ", report.peakGainQ, previous.peakGainQ),
    longestBurnSec: better("longestBurnSec", report.burnSec, previous.longestBurnSec),
    bestMeanNetW:
      report.meanNetElectricBurnW === null
        ? previous.bestMeanNetW
        : previous.bestMeanNetW === null || report.meanNetElectricBurnW > previous.bestMeanNetW
          ? (improved.push("bestMeanNetW"), report.meanNetElectricBurnW)
          : previous.bestMeanNetW,
  };
  return { bests, improved };
}
