import type { Radians } from "./units.js";
import { type Vec3, normalize as normalizeVec3, vec3 } from "./vec3.js";

/**
 * Immutable unit quaternion (x, y, z, w) representing a rotation in ForgeLab's
 * right-handed Y-up world frame. Stored rather than Euler angles so that repeated
 * transforms do not accumulate gimbal artefacts and so serialization is unambiguous.
 */
export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export function quaternion(x: number, y: number, z: number, w: number): Quaternion {
  return Object.freeze({ x, y, z, w });
}

export const QUATERNION_IDENTITY: Quaternion = quaternion(0, 0, 0, 1);

export function fromAxisAngle(axis: Vec3, angleRad: Radians): Quaternion {
  const unit = normalizeVec3(axis);
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  return quaternion(unit.x * s, unit.y * s, unit.z * s, Math.cos(half));
}

/** Intrinsic Tait-Bryan angles applied in Y (yaw) → X (pitch) → Z (roll) order. */
export function fromEulerYXZ(yawRad: Radians, pitchRad: Radians, rollRad: Radians): Quaternion {
  const cy = Math.cos(yawRad * 0.5);
  const sy = Math.sin(yawRad * 0.5);
  const cp = Math.cos(pitchRad * 0.5);
  const sp = Math.sin(pitchRad * 0.5);
  const cr = Math.cos(rollRad * 0.5);
  const sr = Math.sin(rollRad * 0.5);

  return normalize(
    quaternion(
      cy * sp * cr + sy * cp * sr,
      sy * cp * cr - cy * sp * sr,
      cy * cp * sr - sy * sp * cr,
      cy * cp * cr + sy * sp * sr,
    ),
  );
}

/** Hamilton product: applying `b` first, then `a`. */
export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return quaternion(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function conjugate(q: Quaternion): Quaternion {
  return quaternion(-q.x, -q.y, -q.z, q.w);
}

export function normalize(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) return QUATERNION_IDENTITY;
  const inv = 1 / len;
  return quaternion(q.x * inv, q.y * inv, q.z * inv, q.w * inv);
}

/** Rotates a vector by a quaternion using the standard v' = v + 2w(q×v) + 2q×(q×v) form. */
export function rotateVec3(q: Quaternion, v: Vec3): Vec3 {
  const ux = q.x;
  const uy = q.y;
  const uz = q.z;

  const cx = uy * v.z - uz * v.y;
  const cy = uz * v.x - ux * v.z;
  const cz = ux * v.y - uy * v.x;

  const ccx = uy * cz - uz * cy;
  const ccy = uz * cx - ux * cz;
  const ccz = ux * cy - uy * cx;

  return vec3(v.x + 2 * (q.w * cx + ccx), v.y + 2 * (q.w * cy + ccy), v.z + 2 * (q.w * cz + ccz));
}

/** Rotates a vector by the inverse of a (unit) quaternion. */
export function inverseRotateVec3(q: Quaternion, v: Vec3): Vec3 {
  return rotateVec3(conjugate(q), v);
}

export function equals(a: Quaternion, b: Quaternion, epsilon = 0): boolean {
  if (epsilon === 0) return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon
  );
}

export function toArray(q: Quaternion): [number, number, number, number] {
  return [q.x, q.y, q.z, q.w];
}

export function fromArray(values: readonly [number, number, number, number]): Quaternion {
  return quaternion(values[0], values[1], values[2], values[3]);
}
