import { type Vec3, Vec3Math, localDirectionToWorld, vec3 } from "@forgelab/shared";
import { currentTransform } from "../component.js";
import { numberParameter } from "./roles.js";
import {
  type AxisCoupling,
  centrelineCoupling,
  coilSegments,
  ripple,
  vesselAxisCoupling,
} from "./biotSavart.js";
import type { PlantTopology } from "./topology.js";

/**
 * Geometric field coupling: how coils the analytic models do not recognise still drive a
 * plasma. A coil enclosing a torus vessel (a toroidal-field set) or sitting coaxially round
 * a cylinder (a solenoid) is handled by the exact analytic formulas; any other coil — a
 * player-built ring of circular coils, a tilted solenoid, a mirror pair — has its field
 * computed from its geometry by Biot–Savart (biotSavart.ts) and projected onto the
 * vessel's magnetic axis.
 *
 * The field is linear in current, so each coil gets one coefficient (T per ampere of its
 * current) for the vessel it drives most; the solver multiplies by the live current every
 * step. Coefficients depend only on the layout and are cached per topology.
 *
 * A coil "serves" a vessel geometrically when, at its rated current, it puts at least
 * GEOMETRIC_FIELD_MIN_T on that vessel's axis.
 */
export const GEOMETRIC_FIELD_MIN_T = 1e-3;

export interface GeometricCoupling {
  readonly coilId: string;
  readonly vesselId: string;
  readonly coupling: AxisCoupling;
  /** Peak-to-mean ripple of this coil's field along the axis (0..1). */
  readonly ripple: number;
}

export function geometricCouplings(topology: PlantTopology): Map<string, GeometricCoupling> {
  const out = new Map<string, GeometricCoupling>();
  const vessels = topology.vessels;
  if (vessels.length === 0) return out;
  for (const coilId of topology.orphanCoilIds) {
    const coil = topology.byId.get(coilId)!;
    const segments = coilSegments(coil, "run");
    if (segments.length === 0) continue;
    const rated = numberParameter(coil.parameters, "currentA");
    let best: GeometricCoupling | null = null;
    for (const layout of vessels) {
      // An assembled chamber's axis is its centreline; a single vessel's is analytic.
      const coupling =
        layout.chamber.centreline.length > 0
          ? centrelineCoupling(layout.chamber.centreline, segments)
          : vesselAxisCoupling(topology.byId.get(layout.vesselId)!, segments);
      if (coupling === null) continue;
      if (best === null || Math.abs(coupling.meanTPerA) > Math.abs(best.coupling.meanTPerA))
        best = { coilId, vesselId: layout.vesselId, coupling, ripple: ripple(coupling) };
    }
    if (best !== null && Math.abs(best.coupling.meanTPerA * rated) >= GEOMETRIC_FIELD_MIN_T)
      out.set(coilId, best);
  }
  return out;
}

/**
 * Ripple of the combined geometric field on a vessel's axis: the coils' fields add point by
 * point along the axis (they share the sample points), and the ripple is that sum's
 * (max − min)/(max + min).
 */
export function combinedRipple(
  couplings: readonly GeometricCoupling[],
  currents: readonly number[],
): number {
  if (couplings.length === 0) return 0;
  const n = couplings[0]!.coupling.samplesTPerA.length;
  const total = new Array<number>(n).fill(0);
  couplings.forEach((c, i) => {
    const current = currents[i] ?? 0;
    c.coupling.samplesTPerA.forEach((v, k) => {
      total[k]! += v * current;
    });
  });
  const max = Math.max(...total.map(Math.abs));
  const min = Math.min(...total.map(Math.abs));
  const sameSign = total.every((v) => Math.sign(v) === Math.sign(total[0]!));
  if (!sameSign) return 1;
  return max + min > 0 ? (max - min) / (max + min) : 0;
}

const AXIS: Readonly<Record<"x" | "y" | "z", Vec3>> = {
  x: vec3(1, 0, 0),
  y: vec3(0, 1, 0),
  z: vec3(0, 0, 1),
};

/**
 * A poloidal-field coil or central solenoid: a loop coil or solenoid whose axis runs along
 * a single torus vessel's axis, centred on it. Its field crosses the plasma's toroidal
 * axis; it shapes, holds and drives the plasma in a real machine, which the 0D plasma
 * model does not compute.
 */
export function isPoloidalCoil(topology: PlantTopology, coilId: string): boolean {
  const coil = topology.byId.get(coilId);
  if (coil === undefined) return false;
  const g = coil.geometry;
  if (g.kind !== "torus" && g.kind !== "cylinder") return false;
  const ct = currentTransform(coil);
  const coilAxis = localDirectionToWorld(ct, AXIS[g.axis]);
  return topology.vessels.some((layout) => {
    const vessel = topology.byId.get(layout.vesselId)!;
    if (vessel.geometry.kind !== "torus" || layout.chamber.path !== "single") return false;
    const vt = currentTransform(vessel);
    const axis = localDirectionToWorld(vt, AXIS[vessel.geometry.axis]);
    if (Math.abs(Vec3Math.dot(axis, coilAxis)) < 0.99) return false;
    const offset = Vec3Math.subtract(ct.positionM, vt.positionM);
    const along = Vec3Math.scale(axis, Vec3Math.dot(offset, axis));
    return Vec3Math.length(Vec3Math.subtract(offset, along)) < 0.5;
  });
}
