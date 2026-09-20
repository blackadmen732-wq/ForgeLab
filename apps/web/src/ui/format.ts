/**
 * Display formatting.
 *
 * Every value that arrives here is already in SI units; these helpers only choose how to
 * show it. Nothing converts a unit on the way in, and nothing ever converts on the way
 * back out — the interface has no path to write a number into the simulation except
 * through an explicit command that takes SI.
 */

export function formatMass(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg >= 100_000 ? 0 : 2)} t (${kg.toFixed(0)} kg)`;
  return `${kg.toFixed(kg >= 10 ? 1 : 3)} kg`;
}

export function formatForce(newtons: number): string {
  if (Math.abs(newtons) >= 1e6) return `${(newtons / 1e6).toFixed(3)} MN`;
  if (Math.abs(newtons) >= 1e3) return `${(newtons / 1e3).toFixed(2)} kN`;
  return `${newtons.toFixed(2)} N`;
}

export function formatStress(pascals: number): string {
  if (Math.abs(pascals) >= 1e9) return `${(pascals / 1e9).toFixed(3)} GPa`;
  if (Math.abs(pascals) >= 1e6) return `${(pascals / 1e6).toFixed(2)} MPa`;
  if (Math.abs(pascals) >= 1e3) return `${(pascals / 1e3).toFixed(2)} kPa`;
  return `${pascals.toFixed(2)} Pa`;
}

export function formatLength(meters: number): string {
  return `${meters.toFixed(3)} m`;
}

export function formatArea(squareMeters: number): string {
  return `${squareMeters.toFixed(5)} m²`;
}

export function formatRatio(ratio: number): string {
  return ratio.toFixed(3);
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

export function formatVec3(v: { x: number; y: number; z: number }): string {
  return `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)} m`;
}
