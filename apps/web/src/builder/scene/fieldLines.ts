import { Vec3Math, vec3, type Vec3 } from "@forgelab/shared";
import {
  coilSegments,
  fieldAt,
  type CurrentSegment,
  type SimulationComponent,
} from "@forgelab/sim-core";

/**
 * Field lines for the Magnetic view: streamlines of the field ForgeLab computes from the
 * coils' geometry (sim-core Biot–Savart, preview fidelity), traced with a midpoint
 * (second-order Runge–Kutta) step along the unit field direction. Engineering
 * visualisation, not something you could see: the lines show the field's topology —
 * which way it runs, where it closes, where it leaks — and their colour its strength.
 */
export interface FieldCoil {
  readonly id: string;
  readonly segments: readonly CurrentSegment[];
  /** Current per turn, A. */
  readonly currentA: number;
}

export interface FieldLine {
  readonly points: readonly Vec3[];
  /** |B| at each point, T. */
  readonly fieldT: readonly number[];
}

export function fieldCoils(
  components: readonly SimulationComponent[],
  currentOf: (c: SimulationComponent) => number,
): FieldCoil[] {
  return components
    .filter((c) => c.role === "magnet-coil")
    .map((c) => ({ id: c.id, segments: coilSegments(c, "preview"), currentA: currentOf(c) }))
    .filter((c) => c.segments.length > 0 && c.currentA !== 0);
}

/** Where to start lines: in the plasma region of each vessel, else inside each coil. */
export function seedPoints(
  components: readonly SimulationComponent[],
  coils: readonly FieldCoil[],
): Vec3[] {
  const seeds: Vec3[] = [];
  const centroid = (s: readonly CurrentSegment[]) =>
    Vec3Math.scale(
      s.reduce((acc, x) => Vec3Math.add(acc, x.a), vec3(0, 0, 0)),
      1 / Math.max(1, s.length),
    );
  for (const c of components) {
    if (c.role !== "vacuum-vessel") continue;
    const p = c.transform.positionM;
    const g = c.geometry;
    if (g.kind === "torus") {
      // On the magnetic axis and just inside it, at a few toroidal angles.
      for (let k = 0; k < 4; k += 1) {
        const phi = (Math.PI / 2) * k + Math.PI / 8;
        for (const dr of [0, 0.45]) {
          const r = g.majorRadiusM + dr * g.minorRadiusM * (k % 2 === 0 ? 1 : -1);
          seeds.push(
            vec3(
              p.x + r * Math.cos(phi),
              p.y + (dr > 0 ? 0.2 * g.minorRadiusM : 0),
              p.z - r * Math.sin(phi),
            ),
          );
        }
      }
    } else if (g.kind === "cylinder") {
      for (const f of [0, 0.4]) seeds.push(vec3(p.x + f * g.radiusM, p.y, p.z));
    }
  }
  if (seeds.length === 0)
    for (const coil of coils.slice(0, 12)) {
      const c = centroid(coil.segments);
      const r = Vec3Math.distance(c, coil.segments[0]!.a);
      const toward = Vec3Math.normalize(Vec3Math.subtract(coil.segments[0]!.a, c));
      for (const f of [0, 0.5]) seeds.push(Vec3Math.add(c, Vec3Math.scale(toward, f * r)));
    }
  return seeds.slice(0, 32);
}

/**
 * Traces one line through `seed` in both directions. Stops where the field vanishes,
 * where the line leaves the bounding sphere, or where it closes on itself.
 */
export function traceLine(
  coils: readonly FieldCoil[],
  seed: Vec3,
  options: { stepM: number; maxSteps: number; centre: Vec3; radiusM: number },
): FieldLine {
  const field = (p: Vec3) => fieldAt(coils, p);
  const half = (sign: 1 | -1) => {
    const points: Vec3[] = [];
    const magnitudes: number[] = [];
    let p = seed;
    for (let i = 0; i < options.maxSteps; i += 1) {
      const b = field(p);
      const m = Vec3Math.length(b);
      if (!(m > 1e-9)) break;
      points.push(p);
      magnitudes.push(m);
      const mid = Vec3Math.add(p, Vec3Math.scale(b, (sign * 0.5 * options.stepM) / m));
      const bm = field(mid);
      const mm = Vec3Math.length(bm);
      if (!(mm > 1e-9)) break;
      p = Vec3Math.add(p, Vec3Math.scale(bm, (sign * options.stepM) / mm));
      if (Vec3Math.distance(p, options.centre) > options.radiusM) break;
      // Closed: back at the seed after going somewhere.
      if (i > 8 && Vec3Math.distance(p, seed) < options.stepM * 0.75) {
        points.push(seed);
        magnitudes.push(magnitudes[0]!);
        return { points, magnitudes, closed: true };
      }
    }
    return { points, magnitudes, closed: false };
  };
  const forward = half(1);
  if (forward.closed) return { points: forward.points, fieldT: forward.magnitudes };
  const back = half(-1);
  return {
    points: [...back.points.slice(1).reverse(), ...forward.points],
    fieldT: [...back.magnitudes.slice(1).reverse(), ...forward.magnitudes],
  };
}

/** Lines for a whole design, sized to the coils' extent. */
export function traceFieldLines(
  components: readonly SimulationComponent[],
  coils: readonly FieldCoil[],
): FieldLine[] {
  if (coils.length === 0) return [];
  const points = coils.flatMap((c) => c.segments.map((s) => s.a));
  const centre = Vec3Math.scale(
    points.reduce((a, p) => Vec3Math.add(a, p), vec3(0, 0, 0)),
    1 / points.length,
  );
  const extent = Math.max(1, ...points.map((p) => Vec3Math.distance(p, centre)));
  const options = { stepM: extent / 60, maxSteps: 700, centre, radiusM: extent * 2.5 };
  return seedPoints(components, coils)
    .map((seed) => traceLine(coils, seed, options))
    .filter((line) => line.points.length > 3);
}
