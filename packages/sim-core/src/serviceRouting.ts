import {
  localPointToWorld,
  worldPointToLocal,
  QuaternionMath,
  vec3,
  type Transform,
} from "@forgelab/shared";
import { currentTransform, type SimulationComponent } from "./component.js";
import { isLoadBearing, type Connection } from "./connections.js";
import { arcFrame, worldAabb, type Aabb, type ComponentGeometry } from "./geometry.js";
import {
  filleted,
  pathLength,
  routePath,
  routeStyle,
  type RouteEnd,
  type RouteStyle,
  type V3,
} from "./serviceGeometry.js";

/** Approximate installation policy, metres; not an electrical/safety-code clearance. */
export const SERVICE_CLEARANCE_M = 0.04;
export interface RouteObstacle {
  readonly id: string;
  readonly label: string;
  readonly geometry: ComponentGeometry;
  readonly transform: Transform;
  readonly bounds: Aabb;
}
export interface RoutedService {
  readonly id: string;
  readonly points: readonly V3[];
  readonly radiusM: number;
  readonly bounds?: Aabb;
}
export interface RouteBlocker {
  readonly kind: "component" | "service" | "floor" | "budget" | "self";
  readonly id: string;
  readonly label: string;
}
export interface ServiceRoute extends RoutedService {
  readonly state: "clear" | "blocked";
  readonly lengthM: number;
  readonly blockers: readonly RouteBlocker[];
}
export interface RouteScene {
  readonly obstacles: readonly RouteObstacle[];
  readonly services: readonly RoutedService[];
  readonly groundM: number;
  readonly sourceId?: string;
  readonly targetId?: string;
  /**
   * Path length from each end over which a route may stay at its own port's height even
   * where that is within a tube radius of the floor (a busbar terminal on the slab).
   */
  readonly portApproachM?: number;
  /** Round shells the source port's straight lead-out of `sourceLeadM` may cross. */
  readonly sourceShells?: ReadonlySet<string>;
  readonly sourceLeadM?: number;
  /** Round shells the target port's straight lead-out of `targetLeadM` may cross. */
  readonly targetShells?: ReadonlySet<string>;
  readonly targetLeadM?: number;
}
const plus = (p: V3, n: V3, d: number): V3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
function pathBounds(points: readonly V3[]): Aabb {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    minZ = Math.min(minZ, p[2]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
    maxZ = Math.max(maxZ, p[2]);
  }
  return { minM: vec3(minX, minY, minZ), maxM: vec3(maxX, maxY, maxZ) };
}
function boundsOverlap(a: Aabb, b: Aabb, margin: number): boolean {
  return (
    a.minM.x <= b.maxM.x + margin &&
    a.maxM.x >= b.minM.x - margin &&
    a.minM.y <= b.maxM.y + margin &&
    a.maxM.y >= b.minM.y - margin &&
    a.minM.z <= b.maxM.z + margin &&
    a.maxM.z >= b.minM.z - margin
  );
}

/** Closest distance between two finite centreline segments, including parallel/point cases. */
export function segmentDistance(a: V3, b: V3, c: V3, d: V3): number {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c);
  const aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w);
  let s = 0,
    t = 0;
  if (aa < 1e-18) t = cc < 1e-18 ? 0 : clamp(ee / cc);
  else if (cc < 1e-18) s = clamp(-dd / aa);
  else {
    const denom = aa * cc - bb * bb;
    s = denom > 1e-18 ? clamp((bb * ee - cc * dd) / denom) : 0;
    t = (bb * s + ee) / cc;
    if (t < 0) {
      t = 0;
      s = clamp(-dd / aa);
    } else if (t > 1) {
      t = 1;
      s = clamp((bb - dd) / aa);
    }
  }
  return Math.hypot(
    w[0] + u[0] * s - v[0] * t,
    w[1] + u[1] * s - v[1] * t,
    w[2] + u[2] * s - v[2] * t,
  );
}
/** True when the two segments' boxes are more than `gap` apart on some axis. */
function segmentsApart(a: V3, b: V3, c: V3, d: V3, gap: number): boolean {
  for (let i = 0; i < 3; i++)
    if (
      Math.min(a[i]!, b[i]!) - Math.max(c[i]!, d[i]!) > gap ||
      Math.min(c[i]!, d[i]!) - Math.max(a[i]!, b[i]!) > gap
    )
      return true;
  return false;
}
const boxDistance = (p: V3, h: V3) => {
  const q = p.map((x, i) => Math.abs(x) - h[i]!);
  return Math.hypot(...q.map((x) => Math.max(0, x))) + Math.min(0, Math.max(...q));
};
function cylinderDistance(
  p: V3,
  axis: "x" | "y" | "z",
  radius: number,
  halfLength: number,
): number {
  const i = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const radial = Math.hypot(p[(i + 1) % 3]!, p[(i + 2) % 3]!) - radius;
  const axial = Math.abs(p[i]!) - halfLength;
  return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(0, Math.max(radial, axial));
}

/**
 * Distance to the core construction primitive, honoring its hollow space and rotation.
 * Detailed machine meshes can differ: these are construction proxies, not mesh/CAD proof.
 * The arc uses a conservative rounded-end swept tube proxy.
 */
export function distanceToRouteObstacle(point: V3, obstacle: RouteObstacle): number {
  const local = worldPointToLocal(obstacle.transform, vec3(...point));
  const p: V3 = [local.x, local.y, local.z];
  const g = obstacle.geometry;
  const wall = g.wallThicknessM;
  switch (g.kind) {
    case "box": {
      const h: V3 = [g.sizeM.x / 2, g.sizeM.y / 2, g.sizeM.z / 2];
      const outer = boxDistance(p, h);
      return wall === undefined
        ? outer
        : Math.max(outer, -boxDistance(p, h.map((v) => Math.max(0, v - wall)) as unknown as V3));
    }
    case "cylinder": {
      const outer = cylinderDistance(p, g.axis, g.radiusM, g.heightM / 2);
      return wall === undefined
        ? outer
        : Math.max(
            outer,
            -cylinderDistance(
              p,
              g.axis,
              Math.max(0, g.radiusM - wall),
              Math.max(0, g.heightM / 2 - wall),
            ),
          );
    }
    case "torus": {
      const axial = g.axis === "x" ? local.x : g.axis === "y" ? local.y : local.z;
      const radial =
        g.axis === "x"
          ? Math.hypot(local.y, local.z)
          : g.axis === "y"
            ? Math.hypot(local.x, local.z)
            : Math.hypot(local.x, local.y);
      const d = Math.hypot(radial - g.majorRadiusM, axial);
      return wall === undefined
        ? d - g.minorRadiusM
        : Math.max(d - g.minorRadiusM, g.minorRadiusM - wall - d);
    }
    case "arc": {
      const f = arcFrame(g);
      const v = { x: local.x - f.centre.x, y: local.y - f.centre.y, z: local.z - f.centre.z };
      const radial = v.x * f.radial.x + v.y * f.radial.y + v.z * f.radial.z;
      const tangent = v.x * f.tangent.x + v.y * f.tangent.y + v.z * f.tangent.z;
      const angle = clamp(Math.atan2(tangent, radial), -g.sweepRad / 2, g.sweepRad / 2);
      const centre: V3 = [
        f.centre.x + g.bendRadiusM * (f.radial.x * Math.cos(angle) + f.tangent.x * Math.sin(angle)),
        f.centre.y + g.bendRadiusM * (f.radial.y * Math.cos(angle) + f.tangent.y * Math.sin(angle)),
        f.centre.z + g.bendRadiusM * (f.radial.z * Math.cos(angle) + f.tangent.z * Math.sin(angle)),
      ];
      const d = Math.hypot(...sub(p, centre));
      return wall === undefined ? d - g.radiusM : Math.max(d - g.radiusM, g.radiusM - wall - d);
    }
  }
}

function overlapsSegment(a: V3, b: V3, bounds: Aabb, margin: number): boolean {
  const lo: V3 = [bounds.minM.x, bounds.minM.y, bounds.minM.z],
    hi: V3 = [bounds.maxM.x, bounds.maxM.y, bounds.maxM.z];
  let enter = 0,
    leave = 1;
  for (let i = 0; i < 3; i++) {
    const delta = b[i]! - a[i]!;
    if (Math.abs(delta) < 1e-12) {
      if (a[i]! < lo[i]! - margin || a[i]! > hi[i]! + margin) return false;
    } else {
      const t0 = (lo[i]! - margin - a[i]!) / delta,
        t1 = (hi[i]! + margin - a[i]!) / delta;
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
      if (enter > leave) return false;
    }
  }
  return true;
}
function hitsObstacle(a: V3, b: V3, radius: number, obstacle: RouteObstacle): boolean {
  if (!overlapsSegment(a, b, obstacle.bounds, radius)) return false;
  const delta = sub(b, a),
    length = Math.hypot(...delta);
  const unit: V3 = length < 1e-10 ? [0, 0, 0] : (delta.map((x) => x / length) as unknown as V3);
  let traveled = 0;
  // Distance-based steps cannot jump a thin wall as uniform point sampling can.
  for (let step = 0; step < 256; step++) {
    const gap = distanceToRouteObstacle(plus(a, unit, traveled), obstacle) - radius;
    if (gap < -1e-6) return true;
    if (traveled >= length) return false;
    traveled = Math.min(length, traveled + Math.max(1e-4, gap * 0.9));
  }
  return true; // Unresolved grazing is conservative, never a false clearance claim.
}

/** Validates the actual rounded centreline and its full tube radius, not a flat crossing. */
export function routeBlockers(
  points: readonly V3[],
  radiusM: number,
  scene: RouteScene,
): RouteBlocker[] {
  const blocked = new Map<string, RouteBlocker>();
  const margin = radiusM + SERVICE_CLEARANCE_M;
  // Broad phase once per candidate corridor, before checking each rounded segment.
  // Hundreds of remote machines should not generate thousands of per-segment allocations.
  const bounds = pathBounds(points);
  const obstacles = scene.obstacles.filter((o) => boundsOverlap(bounds, o.bounds, margin));
  const services = scene.services.filter(
    (s) => !s.bounds || boundsOverlap(bounds, s.bounds, margin + s.radiusM),
  );
  const along = [0];
  for (let i = 1; i < points.length; i++)
    along.push(along[i - 1]! + Math.hypot(...sub(points[i]!, points[i - 1]!)));
  const total = along[along.length - 1]!;
  for (let i = 1; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      // Neighboring cross-sections along a bend naturally overlap; distant folds do not.
      if (along[j - 1]! - along[i]! < 4 * margin) continue;
      if (
        segmentDistance(points[i - 1]!, points[i]!, points[j - 1]!, points[j]!) <
        2 * radiusM + SERVICE_CLEARANCE_M - 1e-6
      )
        blocked.set("self", { kind: "self", id: "self", label: "Route folds into itself" });
    }
  // Only the approach into a low port may stay at that port's height; nothing goes lower.
  const approach = scene.portApproachM ?? 0,
    first = points[0]![1],
    last = points[points.length - 1]![1];
  if (
    points.some(
      (p, i) =>
        p[1] - radiusM < scene.groundM - 1e-6 &&
        !(along[i]! < approach && p[1] >= first - 1e-6) &&
        !(total - along[i]! < approach && p[1] >= last - 1e-6),
    )
  )
    blocked.set("floor", { kind: "floor", id: "floor", label: "Floor" });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    for (const obstacle of obstacles) {
      // Only the terminal leg may enter its own engineered port. Never skip the whole machine.
      if (
        (i === 1 && obstacle.id === scene.sourceId) ||
        (i === points.length - 1 && obstacle.id === scene.targetId)
      )
        continue;
      // A port's straight lead-out passes the shells enclosing its machine, as a port does.
      if (
        (along[i - 1]! < (scene.sourceLeadM ?? 0) && scene.sourceShells?.has(obstacle.id)) ||
        (total - along[i]! < (scene.targetLeadM ?? 0) && scene.targetShells?.has(obstacle.id))
      )
        continue;
      if (!blocked.has(`c:${obstacle.id}`) && hitsObstacle(a, b, margin, obstacle))
        blocked.set(`c:${obstacle.id}`, {
          kind: "component",
          id: obstacle.id,
          label: obstacle.label,
        });
    }
    for (const service of services) {
      if (blocked.has(`s:${service.id}`)) continue;
      if (service.bounds && !overlapsSegment(a, b, service.bounds, margin + service.radiusM))
        continue;
      const gap = margin + service.radiusM;
      for (let j = 1; j < service.points.length; j++) {
        const c = service.points[j - 1]!,
          d = service.points[j]!;
        if (!segmentsApart(a, b, c, d, gap) && segmentDistance(a, b, c, d) < gap - 1e-6) {
          blocked.set(`s:${service.id}`, {
            kind: "service",
            id: service.id,
            label: `Service ${service.id}`,
          });
          break;
        }
      }
    }
  }
  return [...blocked.values()];
}

/** How far a port's ray travels before it leaves `bounds`; 0 when it starts outside. */
function exitDistance(end: RouteEnd, bounds: Aabb): number {
  const lo: V3 = [bounds.minM.x, bounds.minM.y, bounds.minM.z];
  const hi: V3 = [bounds.maxM.x, bounds.maxM.y, bounds.maxM.z];
  const exits = end.normal
    .map((n, i) =>
      Math.abs(n) < 1e-9 ? Infinity : ((n > 0 ? hi[i]! : lo[i]!) - end.position[i]!) / n,
    )
    .filter((v) => Number.isFinite(v) && v >= 0);
  return exits.length ? Math.min(...exits) : 0;
}

/**
 * Round shells (breeding blanket, toroidal winding set, cryostat) that wholly enclose a
 * port's own machine. Their real counterparts carry port openings this proxy does not
 * model, so a port's straight lead-out may cross them. Boxes (rooms, walls, cabinets)
 * never qualify: a service still cannot pass through a wall.
 */
function enclosingShells(
  ownerId: string | undefined,
  obstacles: readonly RouteObstacle[],
): RouteObstacle[] {
  const owner = obstacles.find((o) => o.id === ownerId);
  if (!owner) return [];
  const a = owner.bounds;
  return obstacles.filter(
    (o) =>
      o.id !== owner.id &&
      o.geometry.kind !== "box" &&
      o.bounds.minM.x <= a.minM.x + 1e-6 &&
      o.bounds.minM.y <= a.minM.y + 1e-6 &&
      o.bounds.minM.z <= a.minM.z + 1e-6 &&
      o.bounds.maxM.x >= a.maxM.x - 1e-6 &&
      o.bounds.maxM.y >= a.maxM.y - 1e-6 &&
      o.bounds.maxM.z >= a.maxM.z - 1e-6,
  );
}

function escapeDistance(end: RouteEnd, style: RouteStyle, envelopes: readonly Aabb[]): number {
  const distance = style.standoffM + style.radiusM;
  const bend = Math.max(style.radiusM * 2.5, 0.3);
  // Clear the proxy even where a machine's terminal sits inside its overall envelope.
  const exit = Math.max(0, ...envelopes.map((b) => exitDistance(end, b)));
  return envelopes.length
    ? Math.max(distance, exit + style.radiusM + SERVICE_CLEARANCE_M + 2 * bend)
    : distance;
}

const AXES: readonly V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const LANE_REACH_M = 12;
const LANE_SEARCH_BUDGET = 12000;

/** Sorted distinct coordinates no lower than `lo`, merged at 0.1 mm. */
function lanes(values: readonly number[], lo = -Infinity): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b))
    if (v >= lo - 1e-9 && (!out.length || v - out[out.length - 1]! > 1e-4)) out.push(v);
  return out;
}

/**
 * Deterministic A* over a sparse lane grid. Every nearby machine contributes lanes just
 * outside its construction proxy on each side and above it; turns cost extra so a route
 * keeps few bends. Returns the orthogonal corners from `start` to `finish`, or null when
 * no lane path exists within the search budget.
 */
/** Index into AXES of an axis-aligned unit normal; 6 when it is not axis-aligned. */
const axisOf = (n: V3) => {
  const i = AXES.findIndex((d) => dot(d, n) > 0.999);
  return i < 0 ? 6 : i;
};

function laneSearch(
  start: V3,
  startNormal: V3,
  finish: V3,
  finishNormal: V3,
  radiusM: number,
  bend: number,
  heights: readonly number[],
  lowestY: number,
  scene: RouteScene,
): V3[] | null {
  const margin = radiusM + SERVICE_CLEARANCE_M,
    lane = margin + bend;
  const top = Math.max(start[1], finish[1], ...heights) + LANE_REACH_M;
  const region: Aabb = {
    minM: vec3(
      Math.min(start[0], finish[0]) - LANE_REACH_M,
      scene.groundM,
      Math.min(start[2], finish[2]) - LANE_REACH_M,
    ),
    maxM: vec3(
      Math.max(start[0], finish[0]) + LANE_REACH_M,
      top,
      Math.max(start[2], finish[2]) + LANE_REACH_M,
    ),
  };
  const nearby = scene.obstacles.filter((o) => boundsOverlap(region, o.bounds, margin));
  const services = scene.services.filter(
    (s) => !s.bounds || boundsOverlap(region, s.bounds, margin + s.radiusM),
  );
  const xs = lanes([
    start[0],
    finish[0],
    ...nearby.flatMap((o) => [o.bounds.minM.x - lane, o.bounds.maxM.x + lane]),
  ]);
  const zs = lanes([
    start[2],
    finish[2],
    ...nearby.flatMap((o) => [o.bounds.minM.z - lane, o.bounds.maxM.z + lane]),
  ]);
  const ys = lanes(
    [start[1], finish[1], ...heights, ...nearby.map((o) => o.bounds.maxM.y + lane)],
    Math.min(start[1], finish[1], scene.groundM + margin),
  );
  const n = [xs.length, ys.length, zs.length] as const;
  const coord = [xs, ys, zs] as const;
  const index = (values: readonly number[], v: number) => {
    let best = 0;
    for (let i = 1; i < values.length; i++)
      if (Math.abs(values[i]! - v) < Math.abs(values[best]! - v)) best = i;
    return best;
  };
  const from = [index(xs, start[0]), index(ys, start[1]), index(zs, start[2])];
  const to = [index(xs, finish[0]), index(ys, finish[1]), index(zs, finish[2])];
  const id = (c: readonly number[]) => (c[0]! * n[1] + c[1]!) * n[2] + c[2]!;
  const cell = (k: number): number[] => [
    Math.floor(k / (n[1] * n[2])),
    Math.floor(k / n[2]) % n[1],
    k % n[2],
  ];
  const point = (c: readonly number[]): V3 => [xs[c[0]!]!, ys[c[1]!]!, zs[c[2]!]!];
  const goal = id(to),
    target = point(to);
  const turn = 2 * bend + 0.5;
  const edgeOk = new Map<number, boolean>();
  const clear = (u: number, v: number, a: V3, b: V3) => {
    const key = Math.min(u, v) * n[0] * n[1] * n[2] + Math.max(u, v);
    const known = edgeOk.get(key);
    if (known !== undefined) return known;
    const low = Math.min(a[1], b[1]);
    const column = (p: V3) => Math.abs(a[0] - p[0]) < 1e-9 && Math.abs(a[2] - p[2]) < 1e-9;
    const rises = column(b) && (column(start) || column(finish)) && low >= lowestY - 1e-6;
    const ok =
      (low - radiusM >= scene.groundM - 1e-6 || rises) &&
      !nearby.some((o) => hitsObstacle(a, b, margin, o)) &&
      !services.some(
        (s) =>
          (!s.bounds || overlapsSegment(a, b, s.bounds, margin + s.radiusM)) &&
          s.points.some((d, j) => {
            if (j === 0) return false;
            const c = s.points[j - 1]!,
              gap = margin + s.radiusM;
            return !segmentsApart(a, b, c, d, gap) && segmentDistance(a, b, c, d) < gap - 1e-6;
          }),
      );
    edgeOk.set(key, ok);
    return ok;
  };
  // States are (cell, arriving axis); 6 marks the start.
  const best = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap: [number, number, number, number][] = []; // f, order, g, state
  let order = 0;
  const push = (f: number, g: number, state: number) => {
    heap.push([f, order++, g, state]);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      const x = heap[i]!,
        y = heap[up]!;
      if (y[0] < x[0] || (y[0] === x[0] && y[1] < x[1])) break;
      heap[i] = y;
      heap[up] = x;
      i = up;
    }
  };
  const pop = () => {
    const head = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        const less = (a: number, b: number) =>
          heap[a]![0] < heap[b]![0] || (heap[a]![0] === heap[b]![0] && heap[a]![1] < heap[b]![1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return head;
  };
  // Weighted toward the target: a near-shortest route found fast beats the shortest found late.
  const h = (p: V3) =>
    1.5 * (Math.abs(p[0] - target[0]) + Math.abs(p[1] - target[1]) + Math.abs(p[2] - target[2]));
  // Leave along the lead: the first move may not double back into the port.
  const first = id(from) * 7 + axisOf(startNormal);
  best.set(first, 0);
  push(h(point(from)), 0, first);
  for (let popped = 0; heap.length && popped < LANE_SEARCH_BUDGET; popped++) {
    const [, , g, state] = pop();
    if (g > (best.get(state) ?? Infinity)) continue;
    const at = Math.floor(state / 7),
      arrived = state % 7;
    // Arrive head-on: the last move continues into the port's lead, never back out of it.
    if (at === goal && arrived !== axisOf(finishNormal)) {
      const corners: V3[] = [];
      for (let s: number | undefined = state; s !== undefined; s = parent.get(s))
        corners.unshift(point(cell(Math.floor(s / 7))));
      corners[0] = start;
      corners[corners.length - 1] = finish;
      return corners.filter((p, i, list) => {
        if (i === 0 || i === list.length - 1) return true;
        const d0 = sub(p, list[i - 1]!),
          d1 = sub(list[i + 1]!, p);
        const cross = [
          d0[1] * d1[2] - d0[2] * d1[1],
          d0[2] * d1[0] - d0[0] * d1[2],
          d0[0] * d1[1] - d0[1] * d1[0],
        ];
        return Math.hypot(...cross) > 1e-9;
      });
    }
    const c = cell(at),
      p = point(c);
    for (let dir = 0; dir < 6; dir++) {
      if (arrived !== 6 && (arrived ^ 1) === dir) continue; // no reversing in place
      const axis = dir >> 1,
        step = AXES[dir]![axis]!;
      const next = [...c];
      next[axis]! += step;
      if (next[axis]! < 0 || next[axis]! >= n[axis]!) continue;
      const q = point(next),
        v = id(next);
      if (!clear(at, v, p, q)) continue;
      const cost =
        g +
        Math.abs(coord[axis]![next[axis]!]! - coord[axis]![c[axis]!]!) +
        (arrived !== 6 && arrived !== dir ? turn : 0);
      const key = v * 7 + dir;
      if (cost >= (best.get(key) ?? Infinity) - 1e-9) continue;
      best.set(key, cost);
      parent.set(key, state);
      push(cost + h(q), cost, key);
    }
  }
  return null;
}

/** Flanges facing each other on one axis, joined by a single straight spool. */
function facing(a: RouteEnd, b: RouteEnd): boolean {
  const gap = sub(b.position, a.position),
    reach = dot(gap, a.normal);
  return (
    dot(a.normal, b.normal) < -0.999 &&
    reach > 0 &&
    Math.hypot(...sub(gap, a.normal.map((x) => x * reach) as unknown as V3)) < 1e-3
  );
}

interface PortLeads {
  readonly shellsA: readonly RouteObstacle[];
  readonly shellsB: readonly RouteObstacle[];
  /** Where each straight lead-out ends, clear of its machine and any shells around it. */
  readonly outA: V3;
  readonly outB: V3;
}
function portLeads(a: RouteEnd, b: RouteEnd, style: RouteStyle, scene: RouteScene): PortLeads {
  const shellsA = enclosingShells(scene.sourceId, scene.obstacles),
    shellsB = enclosingShells(scene.targetId, scene.obstacles);
  const own = (id: string | undefined) => scene.obstacles.filter((o) => o.id === id);
  const out = (end: RouteEnd, id: string | undefined, shells: readonly RouteObstacle[]) =>
    plus(
      end.position,
      end.normal,
      escapeDistance(
        end,
        style,
        [...own(id), ...shells].map((o) => o.bounds),
      ),
    );
  return {
    shellsA,
    shellsB,
    outA: out(a, scene.sourceId, shellsA),
    outB: out(b, scene.targetId, shellsB),
  };
}

/** Bounded deterministic orthogonal search; failure means this planner found no route. */
export function planServiceRoute(
  id: string,
  a: RouteEnd,
  b: RouteEnd,
  style: RouteStyle,
  sceneIn: RouteScene,
): ServiceRoute {
  let scene = sceneIn;
  const radiusM = style.radiusM,
    bend = Math.max(radiusM * 2.5, 0.3);
  const { shellsA, shellsB, outA, outB } = portLeads(a, b, style, scene);
  const lead = (end: RouteEnd, shells: readonly RouteObstacle[]) =>
    style.straight
      ? Infinity
      : shells.length
        ? Math.max(...shells.map((o) => exitDistance(end, o.bounds))) +
          radiusM +
          SERVICE_CLEARANCE_M
        : 0;
  // Cables landing on one terminal run as a bundle into it, so they do not block each other.
  const sameEnd = (p: V3 | undefined) =>
    !!p && [a.position, b.position].some((q) => Math.hypot(...sub(p, q)) < 1e-6);
  scene = {
    ...scene,
    services: scene.services.filter(
      (s) => !sameEnd(s.points[0]) && !sameEnd(s.points[s.points.length - 1]),
    ),
    portApproachM: Math.max(
      ...[a, b].map((end, i) => Math.hypot(...sub(i ? outB : outA, end.position))),
    ),
    sourceShells: new Set(shellsA.map((o) => o.id)),
    sourceLeadM: lead(a, shellsA),
    targetShells: new Set(shellsB.map((o) => o.id)),
    targetLeadM: lead(b, shellsB),
  };
  const raw = routePath(a, b, style);
  const fallback = filleted(raw, bend);
  if (!style.straight && raw.length >= 2 && facing(a, b)) {
    const spool = [a.position, b.position];
    if (!routeBlockers(spool, radiusM, scene).length)
      return {
        id,
        radiusM,
        points: spool,
        state: "clear",
        blockers: [],
        lengthM: pathLength(spool),
      };
  }
  if (raw.length < 2 || style.straight) {
    const blockers = routeBlockers(fallback, radiusM, scene);
    return {
      id,
      radiusM,
      points: fallback,
      state: blockers.length ? "blocked" : "clear",
      blockers,
      lengthM: pathLength(fallback),
    };
  }
  const base = scene.groundM + Math.max(radiusM + SERVICE_CLEARANCE_M, style.trayM);
  const lift = Math.max(1, radiusM * 4 + SERVICE_CLEARANCE_M);
  const heights = [base, base + lift, base + 2 * lift, Math.max(base, outA[1], outB[1]) + lift];
  const initial = routeBlockers(fallback, radiusM, scene);
  const relevant = scene.obstacles
    .filter((o) => initial.some((x) => x.kind === "component" && x.id === o.id))
    .slice(0, 4);
  const margin = radiusM + SERVICE_CLEARANCE_M + 2 * bend;
  const lanesX = [
    ...new Set(relevant.flatMap((o) => [o.bounds.minM.x - margin, o.bounds.maxM.x + margin])),
  ];
  const lanesZ = [
    ...new Set(relevant.flatMap((o) => [o.bounds.minM.z - margin, o.bounds.maxM.z + margin])),
  ];
  const allBlockers = new Map(initial.map((x) => [`${x.kind}:${x.id}`, x]));
  let attempts = 0;
  for (const h of heights) {
    const start: V3 = [outA[0], h, outA[2]],
      finish: V3 = [outB[0], h, outB[2]];
    const middles: V3[][] = [
      [[finish[0], h, start[2]]],
      [[start[0], h, finish[2]]],
      ...lanesX.map((x): V3[] => [
        [x, h, start[2]],
        [x, h, finish[2]],
      ]),
      ...lanesZ.map((z): V3[] => [
        [start[0], h, z],
        [finish[0], h, z],
      ]),
    ];
    for (const middle of middles) {
      if (++attempts > 64) break;
      const path = [a.position, outA, start, ...middle, finish, outB, b.position].filter(
        (p, i, list) => i === 0 || Math.hypot(...sub(p, list[i - 1]!)) > 1e-7,
      );
      const points = filleted(path, bend);
      const blockers = routeBlockers(points, radiusM, scene);
      if (!blockers.length)
        return { id, radiusM, points, state: "clear", blockers: [], lengthM: pathLength(points) };
      for (const item of blockers) allBlockers.set(`${item.kind}:${item.id}`, item);
    }
  }
  // The fixed shapes failed: search the lane grid around every nearby machine.
  const corners = laneSearch(
    outA,
    a.normal,
    outB,
    b.normal,
    radiusM,
    bend,
    heights,
    Math.min(a.position[1], b.position[1]),
    scene,
  );
  if (corners) {
    const points = filleted([a.position, ...corners, b.position], bend);
    const blockers = routeBlockers(points, radiusM, scene);
    if (!blockers.length)
      return { id, radiusM, points, state: "clear", blockers: [], lengthM: pathLength(points) };
    for (const item of blockers) allBlockers.set(`${item.kind}:${item.id}`, item);
  }
  const blockers = initial.length ? initial : [...allBlockers.values()];
  if (!blockers.length)
    blockers.push({ kind: "budget", id: "search", label: "Route search limit" });
  return {
    id,
    radiusM,
    points: fallback,
    state: "blocked",
    blockers,
    lengthM: pathLength(fallback),
  };
}

export function routeEnd(component: SimulationComponent, socketId: string): RouteEnd | null {
  const socket = component.connectionPoints.find((s) => s.id === socketId);
  if (!socket) return null;
  const t = currentTransform(component),
    p = localPointToWorld(t, socket.localPosition);
  const n = QuaternionMath.rotateVec3(t.rotation, socket.localDirection);
  const length = Math.hypot(n.x, n.y, n.z);
  return {
    position: [p.x, p.y, p.z],
    normal: length > 1e-10 ? [n.x / length, n.y / length, n.z / length] : [0, 1, 0],
  };
}

/** Same sorted graph produces the same routes after save/load; hidden parts still occupy space. */
export function planServiceRoutes(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
  groundM = 0,
): ServiceRoute[] {
  const services = connections.filter((c) => !isLoadBearing(c.type));
  if (!services.length) return [];
  const byId = new Map(components.map((c) => [c.id, c]));
  const obstacles = components.map((c): RouteObstacle => {
    const t = currentTransform(c);
    return {
      id: c.id,
      label: c.label || c.id,
      geometry: c.geometry,
      transform: t,
      bounds: worldAabb(c.geometry, t),
    };
  });
  const plans = services.flatMap((connection) => {
    const source = byId.get(connection.from.componentId),
      target = byId.get(connection.to.componentId);
    if (!source || !target) return [];
    const a = routeEnd(source, connection.from.connectionPointId),
      b = routeEnd(target, connection.to.connectionPointId);
    if (!a || !b) return [];
    const style = routeStyle(
      connection.type,
      source.connectionPoints.find((s) => s.id === connection.from.connectionPointId)?.port,
      target.connectionPoints.find((s) => s.id === connection.to.connectionPointId)?.port,
    );
    const scene = { obstacles, services: [], groundM, sourceId: source.id, targetId: target.id };
    const { outA, outB } = portLeads(a, b, style, scene);
    // Each port's straight lead-out is reserved for its own connection, so a route planned
    // earlier cannot take the only way a later one has out of its port.
    const stubs =
      style.straight || facing(a, b)
        ? [[a.position, b.position]]
        : [
            [a.position, outA],
            [outB, b.position],
          ];
    const reserved = stubs.map((points): RoutedService => ({
      id: connection.id,
      points,
      radiusM: style.radiusM,
      bounds: pathBounds(points),
    }));
    return [{ connection, a, b, style, scene, reserved }];
  });
  const routes: ServiceRoute[] = [];
  // Fixed straight links (beam ducts, shafts) cannot detour, so they claim space first.
  const fixed = (p: (typeof plans)[number]) => (p.style.straight ? 0 : 1);
  const ordered = [...plans].sort(
    (a, b) =>
      fixed(a) - fixed(b) ||
      (a.connection.id < b.connection.id ? -1 : a.connection.id > b.connection.id ? 1 : 0),
  );
  for (const { connection, a, b, style, scene } of ordered) {
    const planned = planServiceRoute(connection.id, a, b, style, {
      ...scene,
      services: [
        ...routes.filter((r) => r.state === "clear"),
        ...plans.flatMap((p) => (p.connection.id === connection.id ? [] : p.reserved)),
      ],
    });
    routes.push({
      ...planned,
      bounds: pathBounds(planned.points),
    });
  }
  return routes;
}
