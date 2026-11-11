import { distanceToRouteObstacle, type RouteObstacle } from "@forgelab/sim-core";
import {
  RAIL_HEIGHT_M,
  type FloorOpening,
  type HallPlan,
  type Stair,
  type V3,
} from "../environment/hall/plan.js";

/**
 * What stops the walk and fly cameras: the hall's walls, floors, platforms, stairs, guard
 * rails and perimeter equipment (from the hall plan), and the machines of the design (the
 * same construction proxies the service router measures against, read only).
 *
 * Presentation only. A camera that bumps into a vessel changes nothing in the design, the
 * run or the simulation: nothing here writes anywhere but the camera's own position.
 * Pure functions, no renderer: tested in Node.
 */

/** A person on foot: a 0.35 m circle in plan, 1.8 m tall, eyes at 1.7 m. */
export const WALKER = Object.freeze({
  radiusM: 0.35,
  heightM: 1.8,
  eyeM: 1.7,
  /** The tallest rise taken in stride (a stair tread, a kerb). */
  stepUpM: 0.45,
  /** The largest drop followed without falling (walking down stairs). */
  stepDownM: 0.6,
});
/** The free camera: a 0.45 m sphere. */
export const FLYER = Object.freeze({ radiusM: 0.45, floorClearanceM: 0.3 });
/** How close either camera comes to the cladding: columns and wall services stand proud. */
export const WALL_MARGIN_M = 1.0;
const GRAVITY = 9.81;
/** No single collision step moves further than this, so thin rails and walls hold. */
const MAX_STEP_M = 0.18;

export interface Box {
  readonly min: V3;
  readonly max: V3;
}

export interface NavWorld {
  readonly plan: HallPlan | null;
  /** Obstacles a person on foot meets (solids, guard rails, open pits). */
  readonly walkBoxes: readonly Box[];
  /** Obstacles the free camera meets (solids, platforms, stair flights). */
  readonly flyBoxes: readonly Box[];
  readonly machines: readonly RouteObstacle[];
}

function railBox(a: V3, b: V3): Box {
  const t = 0.05;
  return {
    min: [Math.min(a[0], b[0]) - t, Math.min(a[1], b[1]), Math.min(a[2], b[2]) - t],
    max: [
      Math.max(a[0], b[0]) + t,
      Math.max(a[1], b[1]) + RAIL_HEIGHT_M,
      Math.max(a[2], b[2]) + t,
    ],
  };
}

/** A flight as a row of boxes under its treads, for the free camera. */
function stairBoxes(s: Stair): Box[] {
  const run = Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]);
  const n = Math.max(2, Math.ceil(run / 1.4));
  const ux = (s.to[0] - s.from[0]) / run;
  const uz = (s.to[2] - s.from[2]) / run;
  const half = s.widthM / 2;
  const out: Box[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * run;
    const c = ((i + 1) / n) * run;
    const xs = [s.from[0] + ux * a, s.from[0] + ux * c];
    const zs = [s.from[2] + uz * a, s.from[2] + uz * c];
    const y0 = s.from[1] + ((s.to[1] - s.from[1]) * i) / n;
    const y1 = s.from[1] + ((s.to[1] - s.from[1]) * (i + 1)) / n;
    out.push({
      min: [
        Math.min(...xs) - Math.abs(uz) * half,
        Math.min(y0, y1) - 0.3,
        Math.min(...zs) - Math.abs(ux) * half,
      ],
      max: [Math.max(...xs) + Math.abs(uz) * half, Math.max(y0, y1), Math.max(...zs) + Math.abs(ux) * half],
    });
  }
  return out;
}

/** Collects what each camera can run into. `plan` is null outside a hall (open grid). */
export function navWorld(plan: HallPlan | null, machines: readonly RouteObstacle[]): NavWorld {
  const walkBoxes: Box[] = [];
  const flyBoxes: Box[] = [];
  if (plan !== null) {
    for (const s of plan.solids) {
      if (s.scope !== "fly") walkBoxes.push(s);
      if (s.scope !== "walk") flyBoxes.push(s);
    }
    for (const r of plan.rails) walkBoxes.push(railBox(r.a, r.b));
    // Nobody walks into an open pit, with or without its railing.
    for (const o of plan.openings)
      if (o.cover === "open")
        walkBoxes.push({ min: [o.minX, -o.depthM, o.minZ], max: [o.maxX, 1, o.maxZ] });
    for (const d of plan.decks)
      flyBoxes.push({ min: [d.minX, d.y - 0.3, d.minZ], max: [d.maxX, d.y, d.maxZ] });
    for (const s of plan.stairs) flyBoxes.push(...stairBoxes(s));
  }
  return { plan, walkBoxes, flyBoxes, machines };
}

/* ------------------------------------------------------------------------------------ *
 * Standing surfaces
 * ------------------------------------------------------------------------------------ */

/** Height of a flight's walking line at a plan position, or null beside or beyond it. */
export function stairHeightAt(s: Stair, x: number, z: number): number | null {
  const dx = s.to[0] - s.from[0];
  const dz = s.to[2] - s.from[2];
  const run = Math.hypot(dx, dz);
  const ux = dx / run;
  const uz = dz / run;
  const px = x - s.from[0];
  const pz = z - s.from[2];
  const along = px * ux + pz * uz;
  const across = Math.abs(px * uz - pz * ux);
  if (along < -1e-6 || along > run + 1e-6 || across > s.widthM / 2 + 1e-6) return null;
  return s.from[1] + (s.to[1] - s.from[1]) * Math.min(1, Math.max(0, along / run));
}

function openPitAt(plan: HallPlan, x: number, z: number): FloorOpening | null {
  for (const o of plan.openings)
    if (o.cover === "open" && x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ) return o;
  return null;
}

/**
 * The surface someone whose feet are at `feetY` stands on at (x, z): the highest floor,
 * platform or stair tread no more than a step above their feet.
 */
export function groundAt(plan: HallPlan | null, x: number, z: number, feetY: number): number {
  if (plan === null) return 0;
  const reach = feetY + WALKER.stepUpM;
  const pit = openPitAt(plan, x, z);
  let best = pit === null ? 0 : -pit.depthM;
  if (best > reach) best = -Infinity;
  for (const d of plan.decks)
    if (d.y <= reach && d.y > best && x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ)
      best = d.y;
  for (const s of plan.stairs) {
    const y = stairHeightAt(s, x, z);
    if (y !== null && y <= reach && y > best) best = y;
  }
  return best;
}

/** True where a platform or flight overhead leaves no room to stand at (x, z). */
export function headroomBlocked(
  plan: HallPlan | null,
  x: number,
  z: number,
  feetY: number,
): boolean {
  if (plan === null) return false;
  const lo = feetY + WALKER.stepUpM;
  const hi = feetY + WALKER.heightM + 0.3;
  for (const d of plan.decks)
    if (d.y > lo && d.y < hi && x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ)
      return true;
  for (const s of plan.stairs) {
    const y = stairHeightAt(s, x, z);
    if (y !== null && y > lo && y < hi) return true;
  }
  return false;
}

/** Names where someone is standing, for the mode indicator. */
export function standingOn(plan: HallPlan | null, x: number, z: number, feetY: number): string {
  if (plan === null) return "Ground";
  for (const d of plan.decks)
    if (Math.abs(d.y - feetY) < 0.05 && x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ)
      return d.name;
  for (const s of plan.stairs) {
    const y = stairHeightAt(s, x, z);
    if (y !== null && Math.abs(y - feetY) < 0.3) return "Stairs";
  }
  return feetY < 0.05 && feetY > -0.05 ? "Hall floor" : `+${feetY.toFixed(1)} m`;
}

/* ------------------------------------------------------------------------------------ *
 * Pushing a circle or a sphere out of obstacles
 * ------------------------------------------------------------------------------------ */

const GRAD_H = 0.04;

/** Pushes a circle of radius r at (x, z) out of the boxes that overlap [y0, y1]. */
function pushCircleFromBoxes(
  boxes: readonly Box[],
  p: { x: number; z: number },
  y0: number,
  y1: number,
  r: number,
): void {
  for (const b of boxes) {
    if (b.max[1] <= y0 || b.min[1] >= y1) continue;
    if (p.x < b.min[0] - r || p.x > b.max[0] + r || p.z < b.min[2] - r || p.z > b.max[2] + r)
      continue;
    const cx = Math.min(b.max[0], Math.max(b.min[0], p.x));
    const cz = Math.min(b.max[2], Math.max(b.min[2], p.z));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (r - d);
      p.z += (dz / d) * (r - d);
      continue;
    }
    // Centre inside the box: leave through the nearest face.
    const exits = [
      p.x - b.min[0] + r,
      b.max[0] - p.x + r,
      p.z - b.min[2] + r,
      b.max[2] - p.z + r,
    ];
    const least = exits.indexOf(Math.min(...exits));
    if (least === 0) p.x = b.min[0] - r;
    else if (least === 1) p.x = b.max[0] + r;
    else if (least === 2) p.z = b.min[2] - r;
    else p.z = b.max[2] + r;
  }
}

function pushSphereFromBoxes(
  boxes: readonly Box[],
  p: { x: number; y: number; z: number },
  r: number,
): void {
  for (const b of boxes) {
    if (
      p.x < b.min[0] - r ||
      p.x > b.max[0] + r ||
      p.y < b.min[1] - r ||
      p.y > b.max[1] + r ||
      p.z < b.min[2] - r ||
      p.z > b.max[2] + r
    )
      continue;
    const cx = Math.min(b.max[0], Math.max(b.min[0], p.x));
    const cy = Math.min(b.max[1], Math.max(b.min[1], p.y));
    const cz = Math.min(b.max[2], Math.max(b.min[2], p.z));
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dz = p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (r - d);
      p.y += (dy / d) * (r - d);
      p.z += (dz / d) * (r - d);
      continue;
    }
    const exits = [
      p.x - b.min[0] + r,
      b.max[0] - p.x + r,
      p.y - b.min[1] + r,
      b.max[1] - p.y + r,
      p.z - b.min[2] + r,
      b.max[2] - p.z + r,
    ];
    const least = exits.indexOf(Math.min(...exits));
    if (least === 0) p.x = b.min[0] - r;
    else if (least === 1) p.x = b.max[0] + r;
    else if (least === 2) p.y = b.min[1] - r;
    else if (least === 3) p.y = b.max[1] + r;
    else if (least === 4) p.z = b.min[2] - r;
    else p.z = b.max[2] + r;
  }
}

function nearMachine(m: RouteObstacle, x: number, y0: number, y1: number, z: number, r: number) {
  const b = m.bounds;
  return (
    x >= b.minM.x - r &&
    x <= b.maxM.x + r &&
    z >= b.minM.z - r &&
    z <= b.maxM.z + r &&
    y1 >= b.minM.y &&
    y0 <= b.maxM.y
  );
}

/**
 * Pushes a person out of the machines, sideways only. Each machine is probed at knee,
 * chest and head height against its construction proxy (hollow where the part is hollow).
 */
function pushWalkerFromMachines(
  machines: readonly RouteObstacle[],
  p: { x: number; z: number },
  feetY: number,
): void {
  const r = WALKER.radiusM;
  for (const m of machines) {
    if (!nearMachine(m, p.x, feetY + WALKER.stepUpM, feetY + WALKER.heightM, p.z, r)) continue;
    for (const h of [0.55, 1.15, WALKER.eyeM]) {
      const y = feetY + h;
      const d = distanceToRouteObstacle([p.x, y, p.z], m) - r;
      if (d >= 0) continue;
      let gx =
        distanceToRouteObstacle([p.x + GRAD_H, y, p.z], m) -
        distanceToRouteObstacle([p.x - GRAD_H, y, p.z], m);
      let gz =
        distanceToRouteObstacle([p.x, y, p.z + GRAD_H], m) -
        distanceToRouteObstacle([p.x, y, p.z - GRAD_H], m);
      let g = Math.hypot(gx, gz);
      if (g < 1e-6) {
        // Directly above or below the nearest surface: step away from the part's middle.
        gx = p.x - (m.bounds.minM.x + m.bounds.maxM.x) / 2;
        gz = p.z - (m.bounds.minM.z + m.bounds.maxM.z) / 2;
        g = Math.hypot(gx, gz);
        if (g < 1e-6) {
          gx = 1;
          gz = 0;
          g = 1;
        }
      }
      // A slanted surface pushes less sideways per metre of depth than a wall does.
      const push = Math.min(-d * Math.min(4, (2 * GRAD_H) / g), 0.5);
      p.x += (gx / g) * push;
      p.z += (gz / g) * push;
    }
  }
}

function pushFlyerFromMachines(
  machines: readonly RouteObstacle[],
  p: { x: number; y: number; z: number },
): void {
  const r = FLYER.radiusM;
  for (const m of machines) {
    if (!nearMachine(m, p.x, p.y - r, p.y + r, p.z, r)) continue;
    const d = distanceToRouteObstacle([p.x, p.y, p.z], m) - r;
    if (d >= 0) continue;
    const gx =
      distanceToRouteObstacle([p.x + GRAD_H, p.y, p.z], m) -
      distanceToRouteObstacle([p.x - GRAD_H, p.y, p.z], m);
    const gy =
      distanceToRouteObstacle([p.x, p.y + GRAD_H, p.z], m) -
      distanceToRouteObstacle([p.x, p.y - GRAD_H, p.z], m);
    const gz =
      distanceToRouteObstacle([p.x, p.y, p.z + GRAD_H], m) -
      distanceToRouteObstacle([p.x, p.y, p.z - GRAD_H], m);
    const g = Math.hypot(gx, gy, gz);
    if (g < 1e-6) {
      p.y += -d;
      continue;
    }
    const push = Math.min(-d, 0.6);
    p.x += (gx / g) * push;
    p.y += (gy / g) * push;
    p.z += (gz / g) * push;
  }
}

function clampToHall(plan: HallPlan | null, p: { x: number; z: number }): void {
  if (plan === null) return;
  const L = plan.layout;
  p.x = Math.min(L.halfX - WALL_MARGIN_M, Math.max(-L.halfX + WALL_MARGIN_M, p.x));
  p.z = Math.min(L.halfZ - WALL_MARGIN_M, Math.max(-L.halfZ + WALL_MARGIN_M, p.z));
}

/* ------------------------------------------------------------------------------------ *
 * Walking
 * ------------------------------------------------------------------------------------ */

export interface Walker {
  x: number;
  /** Feet. */
  y: number;
  z: number;
  /** Vertical speed while falling, m/s (0 on the ground). */
  vy: number;
}

function resolveWalker(world: NavWorld, p: { x: number; z: number }, feetY: number): void {
  for (let pass = 0; pass < 3; pass += 1) {
    pushCircleFromBoxes(
      world.walkBoxes,
      p,
      feetY + WALKER.stepUpM,
      feetY + WALKER.heightM,
      WALKER.radiusM,
    );
    pushWalkerFromMachines(world.machines, p, feetY);
    clampToHall(world.plan, p);
  }
}

/** True when a person standing at (x, z) with feet at feetY overlaps nothing. */
export function walkerFits(world: NavWorld, x: number, z: number, feetY: number): boolean {
  const p = { x, z };
  resolveWalker(world, p, feetY);
  return Math.hypot(p.x - x, p.z - z) < 1e-3 && !headroomBlocked(world.plan, x, z, feetY);
}

/**
 * Moves a person by (dx, dz) over dt seconds: slides along whatever is in the way, climbs
 * and descends stairs, and falls (never through a floor) where the ground drops away.
 */
export function moveWalker(world: NavWorld, w: Walker, dx: number, dz: number, dt: number): void {
  const distance = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(distance / MAX_STEP_M));
  const grounded = w.vy === 0;
  for (let i = 0; i < steps; i += 1) {
    const p = { x: w.x + dx / steps, z: w.z + dz / steps };
    resolveWalker(world, p, w.y);
    // A low soffit (the underside of a stair) stops the move; try each axis on its own.
    if (headroomBlocked(world.plan, p.x, p.z, w.y)) {
      if (!headroomBlocked(world.plan, p.x, w.z, w.y)) p.z = w.z;
      else if (!headroomBlocked(world.plan, w.x, p.z, w.y)) p.x = w.x;
      else continue;
    }
    w.x = p.x;
    w.z = p.z;
    if (grounded) {
      const ground = groundAt(world.plan, w.x, w.z, w.y);
      // Treads up and down are taken in stride; a larger drop is a fall, handled below.
      if (ground > w.y || w.y - ground <= WALKER.stepDownM) w.y = ground;
    }
  }
  const ground = groundAt(world.plan, w.x, w.z, w.y);
  if (w.y > ground + 1e-9) {
    w.vy -= GRAVITY * dt;
    w.y += w.vy * dt;
  }
  if (w.y <= ground + 1e-9) {
    w.y = ground;
    w.vy = 0;
  }
}

/** Puts a person down at (x, z): on the surface under `nearY`, clear of obstacles. */
export function placeWalker(world: NavWorld, x: number, z: number, nearY = 0): Walker {
  const p = { x, z };
  clampToHall(world.plan, p);
  let y = groundAt(world.plan, p.x, p.z, nearY);
  if (!Number.isFinite(y)) y = 0;
  for (let i = 0; i < 12; i += 1) {
    const before = { ...p };
    resolveWalker(world, p, y);
    if (Math.hypot(p.x - before.x, p.z - before.z) < 1e-4) break;
  }
  const ground = groundAt(world.plan, p.x, p.z, y);
  return { x: p.x, y: Number.isFinite(ground) ? ground : y, z: p.z, vy: 0 };
}

/* ------------------------------------------------------------------------------------ *
 * Flying
 * ------------------------------------------------------------------------------------ */

export interface Flyer {
  x: number;
  y: number;
  z: number;
}

function resolveFlyer(world: NavWorld, p: Flyer): void {
  const plan = world.plan;
  for (let pass = 0; pass < 3; pass += 1) {
    pushSphereFromBoxes(world.flyBoxes, p, FLYER.radiusM);
    pushFlyerFromMachines(world.machines, p);
    clampToHall(plan, p);
    let floor = 0;
    if (plan !== null) {
      const pit = openPitAt(plan, p.x, p.z);
      if (pit !== null) {
        // Inside a pit the camera may sink to its bottom, but not into its walls.
        const inset = FLYER.radiusM;
        const inside =
          p.x > pit.minX + inset &&
          p.x < pit.maxX - inset &&
          p.z > pit.minZ + inset &&
          p.z < pit.maxZ - inset;
        if (inside || p.y < 0) {
          floor = -pit.depthM;
          if (p.y < FLYER.floorClearanceM) {
            p.x = Math.min(pit.maxX - inset, Math.max(pit.minX + inset, p.x));
            p.z = Math.min(pit.maxZ - inset, Math.max(pit.minZ + inset, p.z));
          }
        }
      }
      p.y = Math.min(plan.layout.eaveM - 1, p.y);
    }
    p.y = Math.max(floor + FLYER.floorClearanceM, p.y);
  }
}

/** Moves the free camera by a displacement, sliding along whatever is in the way. */
export function moveFlyer(world: NavWorld, p: Flyer, dx: number, dy: number, dz: number): void {
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(distance / MAX_STEP_M));
  for (let i = 0; i < steps; i += 1) {
    p.x += dx / steps;
    p.y += dy / steps;
    p.z += dz / steps;
    resolveFlyer(world, p);
  }
}

/** Moves a camera position out of whatever it was put inside (after a jump). */
export function placeFlyer(world: NavWorld, x: number, y: number, z: number): Flyer {
  const p = { x, y, z };
  for (let i = 0; i < 12; i += 1) {
    const before = { ...p };
    resolveFlyer(world, p);
    if (Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z) < 1e-4) break;
  }
  return p;
}
