import { computeAssemblyMassProperties, type SimulationComponent } from "@forgelab/sim-core";
import type { Vec3 } from "@forgelab/shared";

/**
 * What a set of parts weighs and where that weight goes, read from sim-core's own
 * structural solution (support modes, carried loads and the reaction into each support).
 * Presentation only: nothing is recomputed here except sums and maxima.
 */
export interface LoadSummary {
  readonly count: number;
  readonly totalMassKg: number;
  /** Mass-weighted centre, or null when there is no mass. */
  readonly centreOfMassM: Vec3 | null;
  /** Load passed into the ground or anchors by the parts that stand on them, N. */
  readonly groundLoadN: number;
  /** The largest single reaction a part passes to what holds it up. */
  readonly largestReaction: {
    readonly fromId: string;
    /** The part it bears on, or "ground" for the floor or an anchor. */
    readonly ontoId: string;
    readonly loadN: number;
  } | null;
  readonly heaviest: { readonly id: string; readonly massKg: number } | null;
}

export function loadSummary(components: readonly SimulationComponent[]): LoadSummary {
  const assembly = computeAssemblyMassProperties(components);
  let groundLoadN = 0;
  let largest: LoadSummary["largestReaction"] = null;
  let heaviest: LoadSummary["heaviest"] = null;
  const consider = (fromId: string, ontoId: string, loadN: number) => {
    if (loadN > 0 && (largest === null || loadN > largest.loadN))
      largest = { fromId, ontoId, loadN };
  };
  for (const c of components) {
    const support = c.state.support;
    if (support.mode === "grounded" || support.mode === "anchored") {
      groundLoadN += support.totalLoadN;
      consider(c.id, "ground", support.totalLoadN);
    }
    for (const r of support.reactions) consider(c.id, r.otherComponentId, r.loadN);
    if (heaviest === null || c.massKg > heaviest.massKg) heaviest = { id: c.id, massKg: c.massKg };
  }
  return {
    count: components.length,
    totalMassKg: assembly.totalMassKg,
    centreOfMassM: assembly.totalMassKg > 0 ? assembly.centerOfMassM : null,
    groundLoadN,
    largestReaction: largest,
    heaviest,
  };
}
