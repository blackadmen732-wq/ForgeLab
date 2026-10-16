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
  if (points.some((p) => p[1] - radiusM < scene.groundM - 1e-6))
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
      for (let j = 1; j < service.points.length; j++) {
        if (
          segmentDistance(a, b, service.points[j - 1]!, service.points[j]!) <
          margin + service.radiusM - 1e-6
        ) {
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

function escapeDistance(
  end: RouteEnd,
  style: RouteStyle,
  obstacle: RouteObstacle | undefined,
): number {
  let distance = style.standoffM + style.radiusM;
  if (!obstacle) return distance;
  const lo: V3 = [obstacle.bounds.minM.x, obstacle.bounds.minM.y, obstacle.bounds.minM.z];
  const hi: V3 = [obstacle.bounds.maxM.x, obstacle.bounds.maxM.y, obstacle.bounds.maxM.z];
  const bend = Math.max(style.radiusM * 2.5, 0.3);
  // Clear the proxy even where a machine's terminal sits inside its overall envelope.
  const exits = end.normal
    .map((n, i) =>
      Math.abs(n) < 1e-9 ? Infinity : ((n > 0 ? hi[i]! : lo[i]!) - end.position[i]!) / n,
    )
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (exits.length)
    distance = Math.max(
      distance,
      Math.min(...exits) + style.radiusM + SERVICE_CLEARANCE_M + 2 * bend,
    );
  return distance;
}

/** Bounded deterministic orthogonal search; failure means this planner found no route. */
export function planServiceRoute(
  id: string,
  a: RouteEnd,
  b: RouteEnd,
  style: RouteStyle,
  scene: RouteScene,
): ServiceRoute {
  const radiusM = style.radiusM,
    bend = Math.max(radiusM * 2.5, 0.3);
  const raw = routePath(a, b, style);
  const fallback = filleted(raw, bend);
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
  const outA = plus(
    a.position,
    a.normal,
    escapeDistance(
      a,
      style,
      scene.obstacles.find((o) => o.id === scene.sourceId),
    ),
  );
  const outB = plus(
    b.position,
    b.normal,
    escapeDistance(
      b,
      style,
      scene.obstacles.find((o) => o.id === scene.targetId),
    ),
  );
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
  const routes: ServiceRoute[] = [];
  for (const connection of [...services].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const source = byId.get(connection.from.componentId),
      target = byId.get(connection.to.componentId);
    if (!source || !target) continue;
    const a = routeEnd(source, connection.from.connectionPointId),
      b = routeEnd(target, connection.to.connectionPointId);
    if (!a || !b) continue;
    const style = routeStyle(
      connection.type,
      source.connectionPoints.find((s) => s.id === connection.from.connectionPointId)?.port,
      target.connectionPoints.find((s) => s.id === connection.to.connectionPointId)?.port,
    );
    const planned = planServiceRoute(connection.id, a, b, style, {
      obstacles,
      services: routes.filter((r) => r.state === "clear"),
      groundM,
      sourceId: source.id,
      targetId: target.id,
    });
    routes.push({
      ...planned,
      bounds: pathBounds(planned.points),
    });
  }
  return routes;
}
