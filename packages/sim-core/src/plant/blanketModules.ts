import { type Vec3, localPointToWorld, worldPointToLocal } from "@forgelab/shared";
import { type SimulationComponent, currentTransform } from "../component.js";
import { geometryOuterSurfaceM2, geometryVolumeM3 } from "../geometry.js";

/**
 * Modular blankets: blanket and shield modules placed one by one around a tokamak (ITER
 * lines its vessel with 440 of them), instead of one blanket torus enclosing it.
 *
 * REDUCED MODEL (confidence: approximate). Neutrons are born in the plasma, represented as
 * a ring of `RING_POINTS` isotropic point sources on the plasma's magnetic axis (the
 * vessel's major radius, in its mid-plane). A module catches, from each source, the share
 * A⊥ / 4πd² of its emission, where A⊥ is the module's area projected across the line to
 * the source (exact for a box) and d the distance to the module's centre; the share from
 * one source never exceeds one half (a plane through it). It absorbs 1 − exp(−ℓ/λ) of what
 * it catches, with ℓ the box's mean chord 4V/S (Cauchy) and λ the same attenuation length
 * as the analytic blanket. Modules do not shadow each other individually; when together
 * they would catch more than the whole flux, their shares are scaled down to fit.
 * Spatial, never a port: a module next to the plasma heats; one across the hall does not.
 */

export const RING_POINTS = 72;
/** Modules further than this beyond the vessel's minor radius are not served by it, m. */
export const MODULE_REACH_M = 3;

/** Source points on the plasma's magnetic axis (vessel major radius, mid-plane). */
export function plasmaRing(vessel: SimulationComponent): Vec3[] {
  const g = vessel.geometry;
  if (g.kind !== "torus") return [];
  const placement = currentTransform(vessel);
  const points: Vec3[] = [];
  for (let k = 0; k < RING_POINTS; k += 1) {
    const phi = ((k + 0.5) / RING_POINTS) * 2 * Math.PI;
    const a = g.majorRadiusM * Math.cos(phi);
    const b = g.majorRadiusM * Math.sin(phi);
    const local =
      g.axis === "x"
        ? { x: 0, y: a, z: b }
        : g.axis === "z"
          ? { x: a, y: b, z: 0 }
          : { x: a, y: 0, z: b };
    points.push(localPointToWorld(placement, local));
  }
  return points;
}

/** A box's area seen along unit direction `u` (world frame), m². */
export function projectedBoxAreaM2(module: SimulationComponent, u: Vec3): number {
  const g = module.geometry;
  if (g.kind !== "box") return 0;
  const placement = currentTransform(module);
  const origin = worldPointToLocal(placement, { x: 0, y: 0, z: 0 });
  const tip = worldPointToLocal(placement, u);
  const l = { x: tip.x - origin.x, y: tip.y - origin.y, z: tip.z - origin.z };
  const { x, y, z } = g.sizeM;
  return Math.abs(l.x) * y * z + Math.abs(l.y) * x * z + Math.abs(l.z) * x * y;
}

export interface ModuleInterception {
  /** Fraction of the plasma's neutron emission arriving at the module. */
  readonly fraction: number;
  /** Fraction of what arrives that it absorbs. */
  readonly absorbed: number;
  /** Inside the vessel's bore: it sees the plasma before the vessel wall does. */
  readonly inside: boolean;
  /** Closest distance from the module's centre to the plasma axis, m. */
  readonly distanceToAxisM: number;
}

export function moduleInterception(
  module: SimulationComponent,
  ring: readonly Vec3[],
  vessel: SimulationComponent,
  attenuationLengthM: number,
): ModuleInterception | null {
  if (module.geometry.kind !== "box" || ring.length === 0 || vessel.geometry.kind !== "torus")
    return null;
  const centre = currentTransform(module).positionM;
  let fraction = 0;
  let nearest = Infinity;
  for (const p of ring) {
    const d = { x: centre.x - p.x, y: centre.y - p.y, z: centre.z - p.z };
    const r = Math.hypot(d.x, d.y, d.z);
    nearest = Math.min(nearest, r);
    if (r <= 1e-9) {
      fraction += 0.5;
      continue;
    }
    const u = { x: d.x / r, y: d.y / r, z: d.z / r };
    fraction += Math.min(0.5, projectedBoxAreaM2(module, u) / (4 * Math.PI * r * r));
  }
  const bore = vessel.geometry.minorRadiusM - (vessel.geometry.wallThicknessM ?? 0);
  if (nearest > vessel.geometry.minorRadiusM + MODULE_REACH_M) return null;
  const meanChordM =
    (4 * geometryVolumeM3(module.geometry)) / geometryOuterSurfaceM2(module.geometry);
  return {
    fraction: fraction / ring.length,
    absorbed: 1 - Math.exp(-meanChordM / attenuationLengthM),
    inside: nearest < bore,
    distanceToAxisM: nearest,
  };
}

/** Scales shares that together exceed the whole flux (modules shading each other). */
export function fitShares(fractions: readonly number[], available = 1): number {
  const total = fractions.reduce((sum, f) => sum + f, 0);
  return total > available && total > 0 ? available / total : 1;
}
