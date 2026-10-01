import {
  VACUUM_PERMEABILITY_H_PER_M,
  type Vec3,
  Vec3Math,
  localDirectionToWorld,
  localPointToWorld,
  vec3,
} from "@forgelab/shared";
import { type SimulationComponent, currentTransform } from "../component.js";
import type { GeometryAxis } from "../geometry.js";
import { numberParameter } from "./roles.js";

/**
 * Magnetic field from coil geometry: the Biot–Savart law over each coil's current path,
 * discretised into straight segments.
 *
 * For a straight segment from a to b carrying current I, the field at p is exact:
 *
 *   B = μ₀I/4π · (r₁ × r₂) (|r₁| + |r₂|) / ( |r₁||r₂| (|r₁||r₂| + r₁·r₂) ),  r₁ = p − a, r₂ = p − b
 *
 * (J. D. Jackson, Classical Electrodynamics, 3rd ed., §5.3; the closed form of the
 * finite-wire integral). The only approximations are the polygonal path (error falls as
 * 1/n² with n segments per turn) and a filament per coil: the winding pack's cross-section
 * is collapsed onto its centreline, so fields within a winding's own thickness are not
 * resolved. Inside a wire's core radius the field is scaled down linearly, as inside a
 * uniform conductor, so it never diverges.
 *
 * Fidelity tiers: "preview" for interactive views (24 segments per turn, 12 discrete
 * toroidal coils) and "run" for the simulation (96 segments, 18 coils). Both are
 * deterministic — the same design always gives the same field.
 */
export type FieldFidelity = "preview" | "run";

/** A straight piece of a coil's current path, carrying `ampereTurnsPerAmp` × the coil current. */
export interface CurrentSegment {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly ampereTurnsPerAmp: number;
  /** Radius inside which the field is softened (half the winding thickness), m. */
  readonly coreRadiusM: number;
}

/** How the current runs in a torus-shaped coil. */
export type TorusWinding = "toroidal" | "loop";

const RESOLUTION: Readonly<
  Record<FieldFidelity, { segments: number; toroidalCoils: number; solenoidLoops: number }>
> = {
  preview: { segments: 24, toroidalCoils: 12, solenoidLoops: 8 },
  run: { segments: 96, toroidalCoils: 18, solenoidLoops: 24 },
};

const AXES: Readonly<Record<GeometryAxis, Vec3>> = {
  x: vec3(1, 0, 0),
  y: vec3(0, 1, 0),
  z: vec3(0, 0, 1),
};

/** Two unit vectors spanning the plane perpendicular to a local axis. */
function planeOf(axis: GeometryAxis): [Vec3, Vec3] {
  if (axis === "x") return [vec3(0, 1, 0), vec3(0, 0, 1)];
  if (axis === "y") return [vec3(0, 0, 1), vec3(1, 0, 0)];
  return [vec3(1, 0, 0), vec3(0, 1, 0)];
}

/** A circle as a closed polygon of `n` points: centre + r (cos t · u + sin t · v). */
function circle(centre: Vec3, u: Vec3, v: Vec3, r: number, n: number): Vec3[] {
  const points: Vec3[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = (2 * Math.PI * k) / n;
    points.push(
      Vec3Math.add(
        centre,
        Vec3Math.add(Vec3Math.scale(u, r * Math.cos(t)), Vec3Math.scale(v, r * Math.sin(t))),
      ),
    );
  }
  return points;
}

function closedSegments(
  points: readonly Vec3[],
  weight: number,
  coreRadiusM: number,
  toWorld: (p: Vec3) => Vec3,
): CurrentSegment[] {
  const world = points.map(toWorld);
  return world.map((a, k) => ({
    a,
    b: world[(k + 1) % world.length]!,
    ampereTurnsPerAmp: weight,
    coreRadiusM,
  }));
}

/** The winding of a torus coil (`magnet-coil` parameter `winding`, default toroidal). */
export function torusWinding(coil: SimulationComponent): TorusWinding {
  const value = coil.parameters["winding"];
  return value === "loop" ? "loop" : "toroidal";
}

/**
 * A coil's current path as segments in world coordinates, each weighted by the ampere-turns
 * it carries per ampere of coil current. Coils without a geometry the solver understands
 * return no segments.
 */
export function coilSegments(
  coil: SimulationComponent,
  fidelity: FieldFidelity = "run",
): CurrentSegment[] {
  const g = coil.geometry;
  const turns = numberParameter(coil.parameters, "turns");
  const res = RESOLUTION[fidelity];
  const t = currentTransform(coil);
  const toWorld = (p: Vec3) => localPointToWorld(t, p);
  if (g.kind === "torus") {
    const axis = AXES[g.axis];
    const [u, v] = planeOf(g.axis);
    if (torusWinding(coil) === "loop") {
      // Current around the ring: a circular coil of radius R.
      const core = Math.max(1e-3, g.minorRadiusM);
      return closedSegments(
        circle(vec3(0, 0, 0), u, v, g.majorRadiusM, res.segments),
        turns,
        core,
        toWorld,
      );
    }
    // Current around the tube: discrete coils in meridian planes, sharing the turns,
    // run so the field circulates right-handed about the axis (+φ, the plasma's direction).
    const coils = res.toroidalCoils;
    const out: CurrentSegment[] = [];
    const core = Math.max(1e-3, (g.wallThicknessM ?? g.minorRadiusM * 0.1) / 2);
    const minor = g.minorRadiusM - (g.wallThicknessM ?? 0) / 2;
    for (let k = 0; k < coils; k += 1) {
      const phi = (2 * Math.PI * k) / coils;
      const radial = Vec3Math.add(
        Vec3Math.scale(u, Math.cos(phi)),
        Vec3Math.scale(v, Math.sin(phi)),
      );
      const centre = Vec3Math.scale(radial, g.majorRadiusM);
      out.push(
        ...closedSegments(
          circle(centre, axis, radial, minor, res.segments),
          turns / coils,
          core,
          toWorld,
        ),
      );
    }
    return out;
  }
  if (g.kind === "cylinder") {
    // A solenoid: loops stacked along the axis, sharing the turns.
    const axis = AXES[g.axis];
    const [u, v] = planeOf(g.axis);
    const wall = g.wallThicknessM ?? 0;
    const radius = g.radiusM - wall / 2;
    const loops = res.solenoidLoops;
    const core = Math.max(1e-3, wall / 2);
    const out: CurrentSegment[] = [];
    for (let k = 0; k < loops; k += 1) {
      const z = -g.heightM / 2 + ((k + 0.5) * g.heightM) / loops;
      out.push(
        ...closedSegments(
          circle(Vec3Math.scale(axis, z), u, v, radius, res.segments),
          turns / loops,
          core,
          toWorld,
        ),
      );
    }
    return out;
  }
  return [];
}

const MU0_OVER_4PI = VACUUM_PERMEABILITY_H_PER_M / (4 * Math.PI);

/** Field of one segment at `p`, per ampere of coil current, T/A. */
export function segmentFieldPerAmp(s: CurrentSegment, p: Vec3): Vec3 {
  const r1 = Vec3Math.subtract(p, s.a);
  const r2 = Vec3Math.subtract(p, s.b);
  const l1 = Vec3Math.length(r1);
  const l2 = Vec3Math.length(r2);
  const denom = l1 * l2 * (l1 * l2 + Vec3Math.dot(r1, r2));
  if (!(denom > 0)) return vec3(0, 0, 0);
  const c = Vec3Math.cross(r1, r2);
  let k = (MU0_OVER_4PI * s.ampereTurnsPerAmp * (l1 + l2)) / denom;
  // Inside the winding's core radius the field falls linearly to zero on the centreline.
  const length = Vec3Math.distance(s.a, s.b);
  const d = length > 0 ? Vec3Math.length(c) / length : 0;
  if (d < s.coreRadiusM) k *= (d * d) / (s.coreRadiusM * s.coreRadiusM);
  return Vec3Math.scale(c, k);
}

/** Field per ampere of coil current at `p` from a set of segments, T/A. */
export function fieldPerAmp(segments: readonly CurrentSegment[], p: Vec3): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const s of segments) {
    const b = segmentFieldPerAmp(s, p);
    x += b.x;
    y += b.y;
    z += b.z;
  }
  return vec3(x, y, z);
}

/** Field at `p` from several coils at their present currents (A per turn), T. */
export function fieldAt(
  coils: readonly { readonly segments: readonly CurrentSegment[]; readonly currentA: number }[],
  p: Vec3,
): Vec3 {
  let total = vec3(0, 0, 0);
  for (const coil of coils)
    if (coil.currentA !== 0)
      total = Vec3Math.add(total, Vec3Math.scale(fieldPerAmp(coil.segments, p), coil.currentA));
  return total;
}

/**
 * How strongly a coil drives the field a vessel's plasma needs, per ampere of coil current:
 * the field component along the vessel's magnetic axis direction, sampled on that axis.
 *  - torus vessel: the toroidal component (around its symmetry axis, right-handed), on the
 *    circle at its major radius;
 *  - cylinder vessel: the axial component, on the central half of its axis.
 * `mean` drives the plasma model; `min`/`max` give the ripple along the axis.
 */
export interface AxisCoupling {
  /** The field component at each sample point along the axis, T per ampere. */
  readonly samplesTPerA: readonly number[];
  readonly meanTPerA: number;
  readonly minTPerA: number;
  readonly maxTPerA: number;
}

export function vesselAxisCoupling(
  vessel: SimulationComponent,
  segments: readonly CurrentSegment[],
  samples = 36,
): AxisCoupling | null {
  const g = vessel.geometry;
  const t = currentTransform(vessel);
  const values: number[] = [];
  if (g.kind === "torus") {
    const axis = localDirectionToWorld(t, AXES[g.axis]);
    const [u, v] = planeOf(g.axis);
    for (let k = 0; k < samples; k += 1) {
      const phi = (2 * Math.PI * k) / samples;
      const radialLocal = Vec3Math.add(
        Vec3Math.scale(u, Math.cos(phi)),
        Vec3Math.scale(v, Math.sin(phi)),
      );
      const p = localPointToWorld(t, Vec3Math.scale(radialLocal, g.majorRadiusM));
      const radial = localDirectionToWorld(t, radialLocal);
      const toroidal = Vec3Math.normalize(Vec3Math.cross(axis, radial));
      values.push(Vec3Math.dot(fieldPerAmp(segments, p), toroidal));
    }
  } else if (g.kind === "cylinder") {
    const axis = localDirectionToWorld(t, AXES[g.axis]);
    for (let k = 0; k < samples; k += 1) {
      const z = -g.heightM / 4 + ((k + 0.5) * (g.heightM / 2)) / samples;
      const p = localPointToWorld(t, Vec3Math.scale(AXES[g.axis], z));
      values.push(Vec3Math.dot(fieldPerAmp(segments, p), axis));
    }
  } else return null;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  return {
    samplesTPerA: values,
    meanTPerA: mean,
    minTPerA: Math.min(...values),
    maxTPerA: Math.max(...values),
  };
}

/** Peak-to-mean ripple of a field along an axis: (max − min)/(max + min), 0 for none. */
export function ripple(c: AxisCoupling): number {
  const sum = Math.abs(c.maxTPerA) + Math.abs(c.minTPerA);
  return sum > 0 && Math.sign(c.maxTPerA) === Math.sign(c.minTPerA)
    ? (Math.abs(c.maxTPerA) - Math.abs(c.minTPerA)) / sum
    : sum > 0
      ? 1
      : 0;
}
