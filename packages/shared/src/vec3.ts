import type { Meters } from "./units.js";

/**
 * Immutable 3-vector.
 *
 * ForgeLab's world axes: +X right, +Y up, +Z toward the viewer (right-handed, Y-up).
 * Gravity therefore acts along -Y. Vectors are frozen plain objects so that simulation
 * state can be structurally compared, hashed and serialized without defensive copying.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return Object.freeze({ x, y, z });
}

export const VEC3_ZERO: Vec3 = vec3(0, 0, 0);
export const VEC3_ONE: Vec3 = vec3(1, 1, 1);
export const AXIS_X: Vec3 = vec3(1, 0, 0);
export const AXIS_Y: Vec3 = vec3(0, 1, 0);
export const AXIS_Z: Vec3 = vec3(0, 0, 1);

/** Unit vector pointing the way gravity pulls in ForgeLab's world frame. */
export const DOWN: Vec3 = vec3(0, -1, 0);
/** Unit vector opposing gravity. */
export const UP: Vec3 = AXIS_Y;

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const subtract = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (v: Vec3, s: number): Vec3 => vec3(v.x * s, v.y * s, v.z * s);
export const negate = (v: Vec3): Vec3 => vec3(-v.x, -v.y, -v.z);
export const multiplyComponents = (a: Vec3, b: Vec3): Vec3 => vec3(a.x * b.x, a.y * b.y, a.z * b.z);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const lengthSquared = (v: Vec3): number => v.x * v.x + v.y * v.y + v.z * v.z;
export const length = (v: Vec3): number => Math.sqrt(lengthSquared(v));

export const distance = (a: Vec3, b: Vec3): Meters => length(subtract(a, b));

/** Returns the zero vector unchanged rather than producing NaN. */
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) return VEC3_ZERO;
  return scale(v, 1 / len);
}

export function abs(v: Vec3): Vec3 {
  return vec3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
}

export function minComponents(a: Vec3, b: Vec3): Vec3 {
  return vec3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
}

export function maxComponents(a: Vec3, b: Vec3): Vec3 {
  return vec3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function equals(a: Vec3, b: Vec3, epsilon = 0): boolean {
  if (epsilon === 0) return a.x === b.x && a.y === b.y && a.z === b.z;
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.z - b.z) <= epsilon
  );
}

export function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function toArray(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export function fromArray(values: readonly [number, number, number]): Vec3 {
  return vec3(values[0], values[1], values[2]);
}
