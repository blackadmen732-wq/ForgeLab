import type { Ratio } from "./units.js";

/**
 * Default absolute tolerance for geometric comparisons, in metres.
 *
 * One micrometre: far below any dimension ForgeLab models, far above the rounding noise
 * of double-precision arithmetic on metre-scale coordinates.
 */
export const GEOMETRIC_EPSILON_M = 1e-6;

/** Generic tolerance for comparing dimensionless quantities. */
export const NUMERIC_EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function approxEquals(a: number, b: number, epsilon = NUMERIC_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Relative comparison, falling back to absolute comparison near zero.
 * Used by test helpers and by determinism checks where magnitudes vary widely.
 */
export function approxEqualsRelative(a: number, b: number, relativeTolerance = 1e-9): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= relativeTolerance * scale;
}

/**
 * Division that yields 0 instead of NaN/Infinity when the denominator is (near) zero.
 * Used for utilization ratios where a zero-area or zero-strength member is meaningless
 * rather than infinitely stressed; callers are expected to have validated inputs first.
 */
export function safeRatio(numerator: number, denominator: number): Ratio {
  if (!Number.isFinite(denominator) || Math.abs(denominator) < Number.MIN_VALUE) return 0;
  return numerator / denominator;
}

export function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, received ${String(value)}`);
  }
  return value;
}

export function assertPositive(value: number, label: string): number {
  assertFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero, received ${String(value)}`);
  }
  return value;
}

export function assertNonNegative(value: number, label: string): number {
  assertFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must not be negative, received ${String(value)}`);
  }
  return value;
}
