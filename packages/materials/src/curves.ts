import type { Curve } from "./schema.js";

/**
 * Value of a tabulated property at a temperature: linear between points, held at the end
 * values outside the table (never extrapolated). Pure and deterministic.
 */
export function curveValue(curve: Curve, temperatureK: number): number {
  const points = curve.points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (!(temperatureK > first[0])) return first[1];
  if (temperatureK >= last[0]) return last[1];
  for (let i = 1; i < points.length; i += 1) {
    const [t1, v1] = points[i]!;
    if (temperatureK <= t1) {
      const [t0, v0] = points[i - 1]!;
      return v0 + ((v1 - v0) * (temperatureK - t0)) / (t1 - t0);
    }
  }
  return last[1];
}
