import type { Meters } from "./units.js";
import { type Vec3, vec3 } from "./vec3.js";

/**
 * Grid snapping used by the construction workspace.
 *
 * This is an *authoring* convenience, not physics: it only ever adjusts a transform
 * before that transform is handed to the simulation. The simulation itself has no
 * concept of a grid and produces identical results for snapped and unsnapped placements.
 */
export const DEFAULT_SNAP_SIZE_M: Meters = 0.25;

export function snapScalar(value: number, snapSizeM: Meters): number {
  if (!(snapSizeM > 0)) return value;
  return Math.round(value / snapSizeM) * snapSizeM;
}

export function snapVec3(v: Vec3, snapSizeM: Meters): Vec3 {
  if (!(snapSizeM > 0)) return v;
  return vec3(snapScalar(v.x, snapSizeM), snapScalar(v.y, snapSizeM), snapScalar(v.z, snapSizeM));
}

/** Snaps an angle in radians to the nearest multiple of `stepRad`. */
export function snapAngle(angleRad: number, stepRad: number): number {
  if (!(stepRad > 0)) return angleRad;
  return Math.round(angleRad / stepRad) * stepRad;
}
