import type { ConnectionType, PortSpec } from "@forgelab/sim-core";

/**
 * Cable and pipe routing between two ports. Presentation only: the simulation treats a
 * link as a link, whatever its drawn path.
 *
 * Services leave each port along its normal for a short standoff, drop (or rise) to the
 * tray height for their system, run orthogonally along x then z, and come back up into
 * the other port — the way cable trays and pipe racks are laid out in a plant hall.
 * Shafts and heating beamlines are rigid couplings and go straight.
 */
export type V3 = readonly [number, number, number];

export interface RouteEnd {
  readonly position: V3;
  /** Unit outward normal of the port in world space. */
  readonly normal: V3;
}

export interface RouteStyle {
  /** Radius of the drawn cable or pipe, m. */
  readonly radiusM: number;
  /** Height of the tray or rack this service runs on, m. */
  readonly trayM: number;
  /** Straight run out of each port before the first bend, m. */
  readonly standoffM: number;
  /** Rigid couplings are drawn straight. */
  readonly straight: boolean;
}

/** How each service is drawn. Bores come from the port rating when there is one. */
export function routeStyle(type: ConnectionType, a?: PortSpec, b?: PortSpec): RouteStyle {
  const bore = [a, b]
    .map((p) =>
      p?.domain === "fluid" ? p.innerDiameterM : p?.domain === "vacuum" ? p.flangeDiameterM : 0,
    )
    .reduce((m, x) => Math.max(m, x), 0);
  const pipe = (min: number, max: number, fallback: number) =>
    Math.min(max, Math.max(min, bore > 0 ? bore / 2 + 0.03 : fallback));
  switch (type) {
    case "electrical":
      return { radiusM: 0.07, trayM: 0.12, standoffM: 0.5, straight: false };
    case "control":
      return { radiusM: 0.025, trayM: 0.06, standoffM: 0.3, straight: false };
    case "coolant":
      return { radiusM: pipe(0.08, 0.6, 0.18), trayM: 0.9, standoffM: 1.0, straight: false };
    case "cryo":
      return { radiusM: pipe(0.06, 0.35, 0.12), trayM: 1.6, standoffM: 0.8, straight: false };
    case "steam":
      return { radiusM: pipe(0.12, 0.7, 0.3), trayM: 2.4, standoffM: 1.0, straight: false };
    case "vacuum":
      return { radiusM: pipe(0.1, 0.6, 0.2), trayM: 0.7, standoffM: 0.8, straight: false };
    case "fuel":
      return { radiusM: 0.04, trayM: 0.5, standoffM: 0.5, straight: false };
    case "shaft":
    case "port":
      return { radiusM: type === "shaft" ? 0.25 : 0.35, trayM: 0, standoffM: 0, straight: true };
    default:
      return { radiusM: 0.05, trayM: 0.1, standoffM: 0.3, straight: false };
  }
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const same = (a: V3, b: V3) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

/** The polyline from port A to port B (both included), with no repeated points. */
/** Ends closer than this are a flush joint (flange to flange): no pipe or cable is drawn. */
export const FLUSH_JOINT_M = 0.05;

export function routePath(a: RouteEnd, b: RouteEnd, style: RouteStyle): V3[] {
  const gap = Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
  if (gap <= FLUSH_JOINT_M) return [a.position];
  if (style.straight) return [a.position, b.position];
  const outA = add(a.position, a.normal, style.standoffM + style.radiusM);
  const outB = add(b.position, b.normal, style.standoffM + style.radiusM);
  const tray = Math.max(style.radiusM, style.trayM);
  const downA: V3 = [outA[0], tray, outA[2]];
  const downB: V3 = [outB[0], tray, outB[2]];
  const corner: V3 = [downB[0], tray, downA[2]];
  const points: V3[] = [a.position, outA, downA, corner, downB, outB, b.position];
  return points.filter((p, i) => i === 0 || !same(p, points[i - 1]!));
}

/**
 * Rounds each interior corner with a short circular-ish fillet (quadratic, `segments`
 * points) so pipes bend instead of kinking. Fillet size is limited by the adjoining legs.
 */
export function filleted(path: readonly V3[], radius: number, segments = 5): V3[] {
  if (path.length < 3) return [...path];
  const out: V3[] = [path[0]!];
  for (let i = 1; i < path.length - 1; i += 1) {
    const p0 = path[i - 1]!;
    const p1 = path[i]!;
    const p2 = path[i + 1]!;
    const d0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const d1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const r = Math.min(radius, d0 / 2, d1 / 2);
    if (r < 1e-3) {
      out.push(p1);
      continue;
    }
    const a = add(p1, [(p0[0] - p1[0]) / d0, (p0[1] - p1[1]) / d0, (p0[2] - p1[2]) / d0], r);
    const b = add(p1, [(p2[0] - p1[0]) / d1, (p2[1] - p1[1]) / d1, (p2[2] - p1[2]) / d1], r);
    for (let k = 0; k <= segments; k += 1) {
      const t = k / segments;
      const u = 1 - t;
      out.push([
        u * u * a[0] + 2 * u * t * p1[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * p1[1] + t * t * b[1],
        u * u * a[2] + 2 * u * t * p1[2] + t * t * b[2],
      ]);
    }
  }
  out.push(path[path.length - 1]!);
  return out;
}

export function pathLength(path: readonly V3[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}
