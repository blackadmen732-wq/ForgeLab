import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * The Main Reactor Hall, generated procedurally.
 *
 * Presentation only: nothing here is read by physics. The floor sits on y = 0, the ground
 * plane the structural solver uses. Everything is merged per (zone, material) so the whole
 * hall costs a few dozen draw calls; repeated emitters (fixtures, floor light pools,
 * emergency lamps, beacons) are instanced so the lighting controller can animate them.
 *
 * Layout (metres): 140 × 90 floor, 50 m to the underside of the roof trusses, 56 m to the
 * roof deck. North (z = −45) is the back wall with the control room; west (x = −70) has
 * the equipment door, loading bay and goods lift; east (x = +70) has the observation
 * galleries; south (z = +45) is behind the default camera.
 */
export const HALL = Object.freeze({
  halfX: 70,
  halfZ: 45,
  /** Underside of the roof trusses. */
  eaveM: 50,
  /** Roof deck. */
  roofM: 56,
  bayM: 10,
  /** Crane runway rail height. */
  craneRailM: 42,
  /** The clear central build zone. */
  buildHalfX: 40,
  buildHalfZ: 30,
});

export type Zone = "north" | "south" | "east" | "west" | "overhead" | "floor";
export const WALL_ZONES: readonly Zone[] = ["north", "south", "east", "west"];

export type Surface =
  | "steel"
  | "steelDark"
  | "concrete"
  | "panel"
  | "glass"
  | "interior"
  | "interiorLit"
  | "screen"
  | "clerestory"
  | "door"
  | "accent"
  | "hazardDark"
  | "markings"
  | "plates"
  | "duct"
  | "crane"
  | "rails"
  | "propRed"
  | "propGreen"
  | "propGrey"
  | "propBlue"
  | "rubber"
  | "roof"
  | "baylight";

export interface Emitter {
  readonly position: Vector3;
  /** Index used to sequence start-up (fixtures wake row by row). */
  readonly row: number;
}

export interface HallGeometry {
  readonly meshes: ReadonlyArray<{
    readonly zone: Zone;
    readonly surface: Surface;
    readonly geometry: BufferGeometry;
  }>;
  /** High-bay fixtures (lens centres). */
  readonly fixtures: readonly Emitter[];
  /** Perimeter work lights on the walls. */
  readonly workLights: ReadonlyArray<Emitter & { readonly normal: Vector3 }>;
  /** Emergency lamps (dark until the facility needs them). */
  readonly emergency: ReadonlyArray<Emitter & { readonly zone: Zone }>;
  /** Rotating warning beacons (door and control room). */
  readonly beacons: ReadonlyArray<Emitter & { readonly zone: Zone }>;
  /** Small indicator lamps on cabinets. */
  readonly indicators: ReadonlyArray<Emitter & { readonly zone: Zone }>;
}

/* ------------------------------------------------------------------------------------ *
 * Primitive helpers
 * ------------------------------------------------------------------------------------ */

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  return new BoxGeometry(sx, sy, sz).translate(x, y, z);
}

const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);

/** Square member of side `t` from a to b. */
function strut(a: Vector3, b: Vector3, t: number): BufferGeometry {
  const d = b.clone().sub(a);
  const length = d.length();
  const q = new Quaternion().setFromUnitVectors(Z_AXIS, d.normalize());
  const m = new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
  return new BoxGeometry(t, t, length).applyMatrix4(m);
}

/** Round pipe or duct of radius r from a to b. */
function pipe(a: Vector3, b: Vector3, r: number, segments = 12): BufferGeometry {
  const d = b.clone().sub(a);
  const length = d.length();
  const q = new Quaternion().setFromUnitVectors(Y_AXIS, d.normalize());
  const m = new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
  return new CylinderGeometry(r, r, length, segments, 1, false).applyMatrix4(m);
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Wide-flange column; `alongX` puts the flanges parallel to the x axis. */
function column(x: number, z: number, y0: number, y1: number, alongX: boolean, size = 1) {
  const h = y1 - y0;
  const flange = 0.7 * size;
  const depth = 0.8 * size;
  const tf = 0.06 * size;
  const tw = 0.05 * size;
  const y = (y0 + y1) / 2;
  return alongX
    ? [
        box(flange, h, tf, x, y, z - depth / 2),
        box(flange, h, tf, x, y, z + depth / 2),
        box(tw, h, depth, x, y, z),
      ]
    : [
        box(tf, h, flange, x - depth / 2, y, z),
        box(tf, h, flange, x + depth / 2, y, z),
        box(depth, h, tw, x, y, z),
      ];
}

/** Deterministic PRNG so the hall is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Collector {
  #parts = new Map<string, BufferGeometry[]>();
  add(zone: Zone, surface: Surface, ...geometries: BufferGeometry[]): void {
    const key = `${zone}|${surface}`;
    let list = this.#parts.get(key);
    if (list === undefined) {
      list = [];
      this.#parts.set(key, list);
    }
    list.push(...geometries);
  }
  merge(): HallGeometry["meshes"] {
    const out: Array<{ zone: Zone; surface: Surface; geometry: BufferGeometry }> = [];
    for (const [key, parts] of this.#parts) {
      const [zone, surface] = key.split("|") as [Zone, Surface];
      // Mixed indexed/non-indexed inputs cannot merge; every helper here is indexed.
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (merged === null) throw new Error(`hall geometry ${key} could not be merged`);
      out.push({ zone, surface, geometry: merged });
    }
    return out;
  }
}

/* ------------------------------------------------------------------------------------ *
 * Hall
 * ------------------------------------------------------------------------------------ */

export function buildHallGeometry(): HallGeometry {
  const c = new Collector();
  const fixtures: Emitter[] = [];
  const workLights: Array<Emitter & { normal: Vector3 }> = [];
  const emergency: Array<Emitter & { zone: Zone }> = [];
  const beacons: Array<Emitter & { zone: Zone }> = [];
  const indicators: Array<Emitter & { zone: Zone }> = [];
  const random = mulberry32(1911);

  shell(c);
  northWall(c, emergency, beacons, workLights);
  westWall(c, emergency, beacons, workLights);
  eastWall(c, emergency, workLights);
  southWall(c, emergency, workLights);
  roof(c, fixtures);
  crane(c);
  floor(c);
  props(c, indicators, random);

  return { meshes: c.merge(), fixtures, workLights, emergency, beacons, indicators };
}

const LOWER_M = 7; // concrete lower zone
const { halfX: X, halfZ: Z, eaveM: H, roofM: R, bayM: BAY } = HALL;
/** Girt heights up the steel zone, about every 6.5 m, the top one just under the eave. */
const GIRTS_M = (() => {
  const out = [LOWER_M + 0.3];
  const n = Math.ceil((H - 1 - LOWER_M) / 6.5);
  for (let k = 1; k <= n; k += 1) out.push(LOWER_M + 0.3 + ((H - 1.3 - LOWER_M) * k) / n);
  return out;
})();
/** The clerestory window band, just under the eave. */
const CLERESTORY_M = H - 3.8;

/** Columns, girts, cladding, clerestory and gables common to every side. */
function shell(c: Collector): void {
  // Long walls: north (z = −Z) and south (z = +Z).
  for (const [zone, z] of [
    ["north", -Z],
    ["south", Z],
  ] as const) {
    const out = Math.sign(z);
    for (let x = -X; x <= X + 0.01; x += BAY)
      c.add(zone, "steel", ...column(x, z, 0, H, true, 1.2));
    // Girts across the upper steel zone.
    for (const y of GIRTS_M) c.add(zone, "steel", box(2 * X, 0.3, 0.22, 0, y, z + out * 0.2));
    // Upper ribbed panels, clerestory band, parapet.
    c.add(zone, "panel", box(2 * X + 1, H - LOWER_M, 0.14, 0, (H + LOWER_M) / 2, z + out * 0.62));
    c.add(zone, "clerestory", box(2 * X - 2, 3.4, 0.06, 0, CLERESTORY_M, z + out * 0.5));
    for (let x = -X; x <= X + 0.01; x += 2.5)
      c.add(zone, "steelDark", box(0.12, 3.6, 0.14, x, CLERESTORY_M, z + out * 0.44));
    c.add(zone, "panel", box(2 * X + 1.4, R - H + 0.6, 0.14, 0, (H + R) / 2, z + out * 0.62));
    // Crane runway on corbels.
    for (let x = -X; x <= X + 0.01; x += BAY)
      c.add(zone, "steel", box(0.7, 1.3, 1.6, x, HALL.craneRailM - 1.4, z - out * 1.1));
    c.add(zone, "steel", box(2 * X, 1.2, 0.8, 0, HALL.craneRailM - 0.4, z - out * 1.7));
    c.add(zone, "steelDark", box(2 * X, 0.18, 0.14, 0, HALL.craneRailM + 0.29, z - out * 1.7));
  }
  // Short walls: west (x = −X) and east (x = +X).
  for (const [zone, x] of [
    ["west", -X],
    ["east", X],
  ] as const) {
    const out = Math.sign(x);
    for (let z = -Z + BAY; z <= Z - BAY + 0.01; z += BAY)
      c.add(zone, "steel", ...column(x, z, 0, H, false, 1.2));
    for (const y of GIRTS_M) c.add(zone, "steel", box(0.22, 0.3, 2 * Z, x + out * 0.2, y, 0));
    c.add(zone, "panel", box(0.14, H - LOWER_M, 2 * Z + 1, x + out * 0.62, (H + LOWER_M) / 2, 0));
    c.add(zone, "clerestory", box(0.06, 3.4, 2 * Z - 2, x + out * 0.5, CLERESTORY_M, 0));
    for (let z = -Z; z <= Z + 0.01; z += 2.5)
      c.add(zone, "steelDark", box(0.14, 3.6, 0.12, x + out * 0.44, CLERESTORY_M, z));
    c.add(zone, "panel", box(0.14, R - H + 0.6, 2 * Z + 1.4, x + out * 0.62, (H + R) / 2, 0));
  }
  // Cross bracing in selected bays (every third bay of the long walls, end bays of the short).
  for (const [zone, z] of [
    ["north", -Z + 0.3],
    ["south", Z - 0.3],
  ] as const) {
    for (const x0 of [-X, -X + 30, X - 40, X - 10]) {
      c.add(zone, "steel", strut(v(x0, LOWER_M + 0.3, z), v(x0 + BAY, 20, z), 0.18));
      c.add(zone, "steel", strut(v(x0 + BAY, LOWER_M + 0.3, z), v(x0, 20, z), 0.18));
    }
  }
  for (const [zone, x] of [
    ["west", -X + 0.3],
    ["east", X - 0.3],
  ] as const) {
    for (const z0 of [-Z + BAY, Z - 2 * BAY]) {
      c.add(zone, "steel", strut(v(x, 20, z0), v(x, H - 1, z0 + BAY), 0.18));
      c.add(zone, "steel", strut(v(x, 20, z0 + BAY), v(x, H - 1, z0), 0.18));
    }
  }
}

/** A concrete lower wall along x at depth z with a vent grille and door openings. */
function lowerWallX(
  c: Collector,
  zone: Zone,
  z: number,
  out: number,
  openings: ReadonlyArray<readonly [number, number]>,
): void {
  // Wall segments between openings (x ranges to skip).
  const cuts = [...openings].sort((a, b) => a[0] - b[0]);
  let x0 = -X;
  for (const [a, b] of [...cuts, [X, X] as const]) {
    if (a > x0)
      c.add(zone, "concrete", box(a - x0, LOWER_M, 0.5, (a + x0) / 2, LOWER_M / 2, z + out * 0.45));
    x0 = b;
  }
  // Cast-in horizontal reveal and a cap.
  c.add(zone, "steelDark", box(2 * X, 0.08, 0.06, 0, 3.5, z + out * 0.19));
  c.add(zone, "steelDark", box(2 * X, 0.25, 0.7, 0, LOWER_M + 0.05, z + out * 0.35));
}

function lowerWallZ(
  c: Collector,
  zone: Zone,
  x: number,
  out: number,
  openings: ReadonlyArray<readonly [number, number]>,
): void {
  const cuts = [...openings].sort((a, b) => a[0] - b[0]);
  let z0 = -Z;
  for (const [a, b] of [...cuts, [Z, Z] as const]) {
    if (a > z0)
      c.add(zone, "concrete", box(0.5, LOWER_M, a - z0, x + out * 0.45, LOWER_M / 2, (a + z0) / 2));
    z0 = b;
  }
  c.add(zone, "steelDark", box(0.06, 0.08, 2 * Z, x + out * 0.19, 3.5, 0));
  c.add(zone, "steelDark", box(0.7, 0.25, 2 * Z, x + out * 0.35, LOWER_M + 0.05, 0));
}

/** Personnel door: frame, leaf, vision panel and exit sign. `along` is the wall direction. */
function personnelDoor(
  c: Collector,
  zone: Zone,
  x: number,
  z: number,
  along: "x" | "z",
  inward: number,
) {
  const w = 1.2;
  const h = 2.3;
  if (along === "x") {
    c.add(zone, "steelDark", box(w + 0.3, h + 0.15, 0.2, x, (h + 0.15) / 2, z));
    c.add(zone, "door", box(w, h, 0.08, x, h / 2, z + inward * 0.1));
    c.add(zone, "glass", box(0.3, 0.6, 0.02, x + 0.25, 1.6, z + inward * 0.15));
    c.add(zone, "propGreen", box(0.5, 0.2, 0.05, x, h + 0.45, z + inward * 0.12));
  } else {
    c.add(zone, "steelDark", box(0.2, h + 0.15, w + 0.3, x, (h + 0.15) / 2, z));
    c.add(zone, "door", box(0.08, h, w, x + inward * 0.1, h / 2, z));
    c.add(zone, "glass", box(0.02, 0.6, 0.3, x + inward * 0.15, 1.6, z + 0.25));
    c.add(zone, "propGreen", box(0.05, 0.2, 0.5, x + inward * 0.12, h + 0.45, z));
  }
}

/** Louvred ventilation grille. */
function vent(
  c: Collector,
  zone: Zone,
  x: number,
  y: number,
  z: number,
  along: "x" | "z",
  inward: number,
) {
  const w = 2.4;
  const h = 1.4;
  if (along === "x") {
    c.add(zone, "steelDark", box(w, h, 0.12, x, y, z + inward * 0.05));
    for (let i = 0; i < 7; i += 1)
      c.add(
        zone,
        "steel",
        box(w - 0.1, 0.06, 0.12, x, y - h / 2 + 0.15 + i * 0.18, z + inward * 0.12),
      );
  } else {
    c.add(zone, "steelDark", box(0.12, h, w, x + inward * 0.05, y, z));
    for (let i = 0; i < 7; i += 1)
      c.add(
        zone,
        "steel",
        box(0.12, 0.06, w - 0.1, x + inward * 0.12, y - h / 2 + 0.15 + i * 0.18, z),
      );
  }
}

function railing(c: Collector, zone: Zone, a: Vector3, b: Vector3, posts = 2) {
  const d = b.clone().sub(a);
  const n = Math.max(1, Math.round(d.length() / posts));
  for (let i = 0; i <= n; i += 1) {
    const p = a.clone().addScaledVector(d, i / n);
    c.add(zone, "rails", box(0.06, 1.1, 0.06, p.x, p.y + 0.55, p.z));
  }
  c.add(zone, "rails", strut(a.clone().setY(a.y + 1.1), b.clone().setY(b.y + 1.1), 0.07));
  c.add(zone, "rails", strut(a.clone().setY(a.y + 0.55), b.clone().setY(b.y + 0.55), 0.05));
  c.add(zone, "rails", strut(a.clone().setY(a.y + 0.08), b.clone().setY(b.y + 0.08), 0.12));
}

/** Straight stair from a (bottom) to b (top) with treads and stringers, width w. */
function stair(c: Collector, zone: Zone, a: Vector3, b: Vector3, w: number) {
  const d = b.clone().sub(a);
  const rise = d.y;
  const steps = Math.max(2, Math.round(rise / 0.19));
  const horiz = new Vector3(d.x, 0, d.z);
  const run = horiz.length();
  const dir = horiz.normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  for (let i = 0; i < steps; i += 1) {
    const p = a
      .clone()
      .addScaledVector(dir, (run * (i + 0.5)) / steps)
      .setY(a.y + (rise * (i + 1)) / steps);
    const g = new BoxGeometry(w, 0.05, run / steps + 0.05);
    g.rotateY(Math.atan2(dir.x, dir.z));
    c.add(zone, "steelDark", g.translate(p.x, p.y, p.z));
  }
  for (const s of [-1, 1]) {
    const off = side.clone().multiplyScalar((s * w) / 2);
    c.add(zone, "steel", strut(a.clone().add(off), b.clone().add(off), 0.22));
    railing(c, zone, a.clone().add(off), b.clone().add(off), 1.2);
  }
}

/** Back wall: four layers with the elevated control room. */
function northWall(
  c: Collector,
  emergency: Array<Emitter & { zone: Zone }>,
  beacons: Array<Emitter & { zone: Zone }>,
  workLights: Array<Emitter & { normal: Vector3 }>,
): void {
  const zone: Zone = "north";
  const z = -Z;
  // Opening into the adjoining assembly bay (far-background glimpse) at x = 48..58.
  const bayOpening: [number, number] = [46, 58];
  lowerWallX(c, zone, z, -1, [bayOpening]);

  // Layer 2: recessed bays — alternate bays carry a deeper panel with pilasters.
  for (let x = -X; x < X - 0.01; x += BAY) {
    const i = Math.round((x + X) / BAY);
    if (x + BAY / 2 > bayOpening[0] && x + BAY / 2 < bayOpening[1]) continue;
    if (i % 2 === 1) {
      c.add(
        zone,
        "concrete",
        box(BAY - 1.4, LOWER_M - 1.2, 0.3, x + BAY / 2, (LOWER_M - 1.2) / 2 + 0.6, z + 0.05),
      );
      c.add(zone, "steelDark", box(BAY - 1.2, 0.12, 0.5, x + BAY / 2, LOWER_M - 0.55, z + 0.25));
    }
  }
  // Doors and vents at the base.
  for (const x of [-55, -25, 25]) personnelDoor(c, zone, x, z + 0.25, "x", 1);
  for (const x of [-45, -35, 35, 42]) vent(c, zone, x, 4.6, z + 0.25, "x", 1);

  // Layer 3: elevated control room between x = −30 and +20, floor at 9 m, glazing to 14 m.
  const x0 = -30;
  const x1 = 20;
  const yF = 9;
  const yC = 14.5;
  const depth = 5; // room projects this far into the hall
  const front = z + depth;
  // Floor slab, fascia, roof slab.
  c.add(
    zone,
    "concrete",
    box(x1 - x0 + 1, 0.5, depth + 1, (x0 + x1) / 2, yF - 0.25, z + depth / 2),
  );
  c.add(zone, "steelDark", box(x1 - x0 + 1.2, 0.9, 0.2, (x0 + x1) / 2, yF - 0.55, front + 0.5));
  c.add(
    zone,
    "steel",
    box(x1 - x0 + 1.2, 0.6, depth + 1.4, (x0 + x1) / 2, yC + 0.3, z + depth / 2 + 0.2),
  );
  // Supporting columns under the slab.
  for (let x = x0; x <= x1 + 0.01; x += 10)
    c.add(zone, "steel", ...column(x, front + 0.2, 0, yF - 0.5, true, 0.8));
  // Inclined glazing (tilted out at the top, as control rooms are) with mullions.
  const glassH = yC - yF - 0.1;
  const tilt = 0.18;
  const glass = new BoxGeometry(x1 - x0, glassH, 0.04)
    .rotateX(-tilt)
    .translate((x0 + x1) / 2, yF + glassH / 2 + 0.05, front + 0.55);
  c.add(zone, "glass", glass);
  for (let x = x0; x <= x1 + 0.01; x += 2.5) {
    const m = new BoxGeometry(0.1, glassH, 0.12)
      .rotateX(-tilt)
      .translate(x, yF + glassH / 2 + 0.05, front + 0.55);
    c.add(zone, "steelDark", m);
  }
  c.add(zone, "steelDark", box(x1 - x0, 0.12, 0.14, (x0 + x1) / 2, yF + 1.1, front + 0.58));
  // Interior: back wall lit, desks with screens, ceiling light panels — seen through glass.
  c.add(zone, "interior", box(x1 - x0, yC - yF, 0.2, (x0 + x1) / 2, (yF + yC) / 2, z + 0.1));
  c.add(zone, "interior", box(x1 - x0, 0.1, depth, (x0 + x1) / 2, yF + 0.05, z + depth / 2));
  for (let x = x0 + 2; x < x1 - 1; x += 4) {
    c.add(zone, "steelDark", box(3.2, 0.75, 1.1, x + 1, yF + 0.45, front - 1.6)); // desk
    c.add(zone, "screen", box(0.9, 0.55, 0.04, x + 0.3, yF + 1.25, front - 1.95));
    c.add(zone, "screen", box(0.9, 0.55, 0.04, x + 1.3, yF + 1.25, front - 1.95));
    c.add(zone, "steelDark", box(0.6, 1.0, 0.6, x + 1, yF + 0.55, front - 0.7)); // chair
    c.add(zone, "interiorLit", box(3, 0.05, 1.2, x + 1, yC - 0.1, z + depth / 2));
  }
  // Large mimic display on the back wall of the control room.
  c.add(zone, "screen", box(14, 3, 0.05, (x0 + x1) / 2, yF + 2.6, z + 0.25));
  // Balcony rail on the slab edge beyond the glazing ends.
  railing(c, zone, v(x0 - 0.5, yF, front + 0.95), v(x1 + 0.5, yF, front + 0.95), 2.5);
  // Stair to the control room at the east end.
  stair(c, zone, v(x1 + 9, 0, front + 1.5), v(x1 + 1.5, yF, front + 1.5), 1.4);
  beacons.push({ position: v(x0 - 1, yC + 0.9, front + 0.6), row: 0, zone });
  beacons.push({ position: v(x1 + 1, yC + 0.9, front + 0.6), row: 0, zone });

  // Layer 4: high catwalk at 20 m for crane maintenance, with ducts and cable trays.
  const yW = 20;
  c.add(zone, "steelDark", box(2 * X - 4, 0.12, 1.6, 0, yW, z + 1.4));
  for (let x = -X + 2; x <= X - 2 + 0.01; x += 5) {
    c.add(zone, "steel", box(0.15, 0.4, 1.6, x, yW - 0.25, z + 1.4));
    c.add(zone, "steel", strut(v(x, yW - 0.3, z + 2.1), v(x, yW - 1.8, z + 0.4), 0.12));
  }
  railing(c, zone, v(-X + 2, yW, z + 2.2), v(X - 2, yW, z + 2.2), 2);
  c.add(zone, "duct", pipe(v(-X + 1, 17, z + 1.3), v(X - 1, 17, z + 1.3), 0.7, 20));
  for (let x = -X + 8; x < X; x += 16) c.add(zone, "steelDark", box(0.4, 1.8, 0.2, x, 17, z + 0.3));
  c.add(zone, "steelDark", box(2 * X - 2, 0.1, 0.8, 0, 15.3, z + 0.9));
  for (const [dy, s] of [
    [0.2, "propGrey"],
    [0.35, "rubber"],
  ] as const)
    c.add(zone, s, box(2 * X - 2, 0.08, 0.6, 0, 15.3 + dy, z + 0.9));

  // Far-background glimpse: the adjoining bay through the opening.
  const [a, b] = bayOpening;
  c.add(
    zone,
    "steelDark",
    box(0.8, 12, 0.8, a, 6, z),
    box(0.8, 12, 0.8, b, 6, z),
    box(b - a + 0.8, 1.2, 0.8, (a + b) / 2, 12.4, z),
  );
  c.add(zone, "concrete", box(b - a + 6, 0.2, 30, (a + b) / 2, -0.09, z - 15)); // floor beyond
  c.add(zone, "panel", box(b - a + 6, 22, 0.2, (a + b) / 2, 11, z - 30)); // far wall
  c.add(zone, "baylight", box(b - a + 4, 0.3, 26, (a + b) / 2, 21.5, z - 15)); // lit roof
  c.add(
    zone,
    "steel",
    ...column(a - 2, z - 12, 0, 21, true),
    ...column(b + 2, z - 12, 0, 21, true),
  );
  c.add(zone, "propGrey", box(3, 2.4, 2, a + 3, 1.2, z - 20), box(2, 3.6, 2, b - 2.5, 1.8, z - 24));
  c.add(zone, "accent", box(b - a - 1, 0.01, 0.2, (a + b) / 2, 0.02, z - 4));

  for (const x of [-60, -40, 30, 60])
    emergency.push({ position: v(x, 6.2, z + 0.4), row: 0, zone });
  for (const x of [-60, -40, -20, 0, 20, 40, 60])
    workLights.push({ position: v(x, LOWER_M + 1.2, z + 0.8), row: 0, normal: v(0, 0, 1) });
}

/** West wall: equipment door, loading bay, goods lift. */
function westWall(
  c: Collector,
  emergency: Array<Emitter & { zone: Zone }>,
  beacons: Array<Emitter & { zone: Zone }>,
  workLights: Array<Emitter & { normal: Vector3 }>,
): void {
  const zone: Zone = "west";
  const x = -X;
  const doorW = 14;
  const doorH = 16;
  const lift: [number, number] = [-32, -26];
  const personnel: [number, number] = [11, 12.6];
  lowerWallZ(c, zone, x, -1, [[-doorW / 2 - 1, doorW / 2 + 1], lift, personnel]);
  // Concrete fill above the lower zone around the door head.
  c.add(
    zone,
    "concrete",
    box(0.5, doorH + 2 - LOWER_M, 4, x - 0.45, (doorH + 2 + LOWER_M) / 2, -doorW / 2 - 3),
  );
  c.add(
    zone,
    "concrete",
    box(0.5, doorH + 2 - LOWER_M, 4, x - 0.45, (doorH + 2 + LOWER_M) / 2, doorW / 2 + 3),
  );
  // Door: heavy jambs, header, slatted leaf (closed), hood.
  for (const s of [-1, 1]) {
    c.add(zone, "steel", box(1.2, doorH + 2, 1.2, x + 0.3, (doorH + 2) / 2, s * (doorW / 2 + 0.6)));
    // Chevron impact guards on the jambs.
    for (let y = 0.2; y < 2.4; y += 0.5) {
      c.add(zone, "markings", box(1.25, 0.25, 1.25, x + 0.3, y, s * (doorW / 2 + 0.6)));
      c.add(zone, "hazardDark", box(1.26, 0.25, 1.26, x + 0.3, y + 0.25, s * (doorW / 2 + 0.6)));
    }
  }
  c.add(zone, "steel", box(1.4, 2, doorW + 2.4, x + 0.3, doorH + 1, 0));
  c.add(zone, "steelDark", box(1.6, 1.4, doorW + 1, x + 0.7, doorH + 2.7, 0)); // coil hood
  for (let y = 0.3; y < doorH; y += 0.45) c.add(zone, "door", box(0.12, 0.4, doorW, x - 0.2, y, 0));
  c.add(zone, "rubber", box(0.3, 0.12, doorW, x - 0.1, 0.06, 0));
  c.add(zone, "glass", box(0.05, 0.5, doorW - 1, x - 0.12, 5.2, 0));
  for (const s of [-1, 1])
    beacons.push({ position: v(x + 0.8, doorH + 3.8, s * (doorW / 2 + 0.6)), row: 0, zone });
  // Door status lamps and control panel.
  c.add(zone, "propGrey", box(0.3, 1.2, 0.8, x + 0.5, 1.5, doorW / 2 + 2.2));
  // Loading bay floor zone: hatched apron in front of the door.
  for (let i = 0; i < 12; i += 1) {
    const g = new BoxGeometry(0.4, 0.01, 4)
      .rotateY(Math.PI / 4)
      .translate(x + 3 + (i % 2) * 0, 0.013, -doorW / 2 + 0.6 + i * 1.2);
    c.add("floor", i % 2 === 0 ? "markings" : "hazardDark", g);
  }
  c.add(
    "floor",
    "markings",
    box(0.2, 0.01, doorW + 2, x + 8, 0.012, 0),
    box(8, 0.01, 0.2, x + 4, 0.012, -doorW / 2 - 1),
    box(8, 0.01, 0.2, x + 4, 0.012, doorW / 2 + 1),
  );
  // Goods lift: shaft frame, mesh panels, landing door.
  const [l0, l1] = lift;
  const lz = (l0 + l1) / 2;
  for (const zz of [l0, l1])
    for (const xx of [x + 0.4, x + 4.4]) c.add(zone, "steel", box(0.3, 22, 0.3, xx, 11, zz));
  for (const y of [0.1, 9, 14.5, 22])
    c.add(
      zone,
      "steel",
      box(4.3, 0.25, 0.25, x + 2.4, y, l0),
      box(4.3, 0.25, 0.25, x + 2.4, y, l1),
      box(0.25, 0.25, l1 - l0, x + 4.4, y, lz),
    );
  c.add(zone, "glass", box(0.04, 21, l1 - l0 - 0.4, x + 4.4, 11.5, lz));
  c.add(zone, "door", box(0.1, 3, 3, x + 4.35, 1.5, lz));
  c.add(zone, "accent", box(0.12, 0.3, 3.2, x + 4.4, 3.2, lz));
  personnelDoor(c, zone, x + 0.25, (personnel[0] + personnel[1]) / 2, "z", 1);
  for (const zz of [-20, 20, 34]) vent(c, zone, x + 0.25, 4.6, zz, "z", 1);
  for (const zz of [-38, -12, 12, 38])
    emergency.push({ position: v(x + 0.4, 6.2, zz), row: 0, zone });
  for (const zz of [-35, -15, 15, 35])
    workLights.push({ position: v(x + 0.8, LOWER_M + 1.2, zz), row: 0, normal: v(1, 0, 0) });
}

/** East wall: two tiers of observation galleries with glazed control rooms and stairs. */
function eastWall(
  c: Collector,
  emergency: Array<Emitter & { zone: Zone }>,
  workLights: Array<Emitter & { normal: Vector3 }>,
): void {
  const zone: Zone = "east";
  const x = X;
  lowerWallZ(c, zone, x, 1, [[20, 21.6]]);
  personnelDoor(c, zone, x - 0.25, 20.8, "z", -1);
  for (const zz of [-35, -5, 32]) vent(c, zone, x - 0.25, 4.6, zz, "z", -1);
  for (const [y, z0, z1] of [
    [8, -34, 30],
    [16, -26, 22],
  ] as const) {
    const w = 3.2;
    c.add(zone, "steelDark", box(w, 0.25, z1 - z0, x - w / 2 - 0.3, y, (z0 + z1) / 2));
    for (let zz = z0; zz <= z1 + 0.01; zz += 8) {
      c.add(zone, "steel", box(w, 0.5, 0.25, x - w / 2 - 0.3, y - 0.35, zz));
      c.add(zone, "steel", strut(v(x - 0.3, y - 3, zz), v(x - w, y - 0.2, zz), 0.16));
    }
    railing(c, zone, v(x - w - 0.3, y, z0), v(x - w - 0.3, y, z1), 2);
    // Glazed observation rooms behind the gallery.
    const r0 = z0 + 10;
    const r1 = r0 + 18;
    c.add(zone, "glass", box(0.04, 3.4, r1 - r0, x - 0.35, y + 1.9, (r0 + r1) / 2));
    for (let zz = r0; zz <= r1 + 0.01; zz += 2)
      c.add(zone, "steelDark", box(0.12, 3.5, 0.08, x - 0.33, y + 1.9, zz));
    c.add(zone, "interiorLit", box(0.1, 3, r1 - r0 - 0.5, x + 0.1, y + 1.8, (r0 + r1) / 2));
    c.add(
      zone,
      "screen",
      box(0.05, 0.8, 1.6, x + 0.02, y + 1.4, r0 + 4),
      box(0.05, 0.8, 1.6, x + 0.02, y + 1.4, r1 - 4),
    );
  }
  // Stairs: floor → 8 m → 16 m.
  stair(c, zone, v(x - 5.5, 0, 38), v(x - 5.5, 8, 30), 1.4);
  stair(c, zone, v(x - 5.5, 8, -26 + 8 + 0.5), v(x - 5.5, 16, -26 + 0.5), 1.4);
  for (const zz of [-38, -10, 10, 38])
    emergency.push({ position: v(x - 0.4, 6.2, zz), row: 0, zone });
  for (const zz of [-35, -15, 15, 35])
    workLights.push({ position: v(x - 0.8, LOWER_M - 0.4, zz), row: 0, normal: v(-1, 0, 0) });
}

/** South wall (behind the default camera): plain, with a secondary door and vents. */
function southWall(
  c: Collector,
  emergency: Array<Emitter & { zone: Zone }>,
  workLights: Array<Emitter & { normal: Vector3 }>,
): void {
  const zone: Zone = "south";
  const z = Z;
  lowerWallX(c, zone, z, 1, []);
  for (const x of [-40, 10, 50]) personnelDoor(c, zone, x, z - 0.25, "x", -1);
  for (const x of [-20, 30]) vent(c, zone, x, 4.6, z - 0.25, "x", -1);
  for (const x of [-50, 0, 50]) emergency.push({ position: v(x, 6.2, z - 0.4), row: 0, zone });
  for (const x of [-45, -15, 15, 45])
    workLights.push({ position: v(x, LOWER_M + 1.2, z - 0.8), row: 0, normal: v(0, 0, -1) });
}

/** Trusses, purlins, bracing, ducts, cable trays, sprinklers, lighting rigs and deck. */
function roof(c: Collector, fixtures: Emitter[]): void {
  const zone: Zone = "overhead";
  const bottom = H;
  const top = R - 0.6;
  for (let x = -X; x <= X + 0.01; x += BAY) {
    c.add(zone, "steel", box(0.45, 0.45, 2 * Z, x, bottom, 0));
    c.add(zone, "steel", box(0.45, 0.45, 2 * Z, x, top, 0));
    const panel = 4.5;
    for (let z = -Z; z < Z - 0.01; z += panel) {
      c.add(zone, "steel", box(0.22, top - bottom, 0.22, x, (top + bottom) / 2, z));
      const up = Math.round((z + Z) / panel) % 2 === 0;
      c.add(
        zone,
        "steel",
        strut(v(x, up ? bottom : top, z), v(x, up ? top : bottom, z + panel), 0.2),
      );
    }
  }
  // Purlins and plan bracing.
  for (let z = -Z; z <= Z + 0.01; z += 4.5)
    c.add(zone, "steelDark", box(2 * X, 0.3, 0.2, 0, top + 0.35, z));
  for (let x = -X; x < X - 0.01; x += BAY) {
    for (const z of [-Z + 2, -2, Z - 2]) {
      c.add(
        zone,
        "steelDark",
        strut(v(x, top + 0.2, z - 4.5), v(x + BAY, top + 0.2, z + 4.5), 0.1),
      );
    }
    c.add(
      zone,
      "steelDark",
      box(BAY, 0.25, 0.25, x + BAY / 2, bottom, -Z + 9),
      box(BAY, 0.25, 0.25, x + BAY / 2, bottom, Z - 9),
    );
  }
  c.add(zone, "roof", box(2 * X + 1.4, 0.4, 2 * Z + 1.4, 0, R, 0));
  // Supply-air ducts with drop diffusers, hangers.
  for (const z of [-18, 18]) {
    c.add(zone, "duct", pipe(v(-X, H - 2.8, z), v(X, H - 2.8, z), 1.0, 24));
    for (let x = -X + 5; x < X; x += 10) {
      c.add(zone, "duct", pipe(v(x, H - 2.8, z), v(x, H - 4.8, z), 0.35, 12));
      c.add(zone, "duct", new CylinderGeometry(0.75, 0.45, 0.35, 16).translate(x, H - 5, z));
      c.add(
        zone,
        "steelDark",
        box(0.06, bottom - (H - 2.8) + 1, 0.06, x + 2, (bottom + (H - 2.8)) / 2 + 0.5, z),
      );
    }
  }
  // Cable trays and sprinkler mains.
  for (const z of [-30, 30]) {
    c.add(zone, "steelDark", box(2 * X, 0.12, 0.9, 0, H - 1.8, z));
    c.add(zone, "propGrey", box(2 * X, 0.1, 0.7, 0, H - 1.68, z));
  }
  for (let z = -Z + 7.5; z < Z; z += 7.5)
    c.add(zone, "propRed", pipe(v(-X, H - 0.8, z), v(X, H - 0.8, z), 0.06, 6));
  // Lighting rigs: unistrut runs with high-bay fixtures, 7 rows along x.
  const rows = [-35, -24, -12, 0, 12, 24, 35];
  for (const z of rows) {
    c.add(zone, "steelDark", box(2 * X - 6, 0.1, 0.1, 0, H - 3.8, z));
    for (let x = -X + 5; x < X; x += BAY) {
      c.add(zone, "steelDark", box(0.05, 3.2, 0.05, x, H - 2.2, z));
      // Fixture housing (the lens is an instanced emitter just below it).
      c.add(zone, "propGrey", new CylinderGeometry(0.42, 0.62, 0.55, 18).translate(x, H - 4.3, z));
      fixtures.push({ position: v(x, H - 4.6, z), row: Math.round((x + X) / BAY) });
    }
  }
}

/** Bridge crane parked at the west end, over the loading bay. */
function crane(c: Collector): void {
  const zone: Zone = "overhead";
  const cx = -56;
  const span = 2 * Z - 3.4;
  const y = HALL.craneRailM + 1.6;
  c.add(zone, "crane", box(1.3, 2.2, span, cx - 1.8, y, 0), box(1.3, 2.2, span, cx + 1.8, y, 0));
  for (const s of [-1, 1]) {
    c.add(zone, "crane", box(5.2, 1.4, 2.6, cx, y - 0.6, s * (Z - 2.3)));
    c.add(zone, "steelDark", box(5.4, 0.2, 2.8, cx, y - 1.4, s * (Z - 2.3)));
  }
  c.add(zone, "crane", box(3.6, 1.8, 3.4, cx, y + 1.9, 6)); // trolley
  c.add(zone, "steelDark", box(1.8, 1.0, 1.6, cx + 0.6, y + 3.3, 6)); // hoist motor
  c.add(zone, "rails", box(4, 0.1, 0.1, cx, y + 1.2, 6 - 1.8));
  for (const dx of [-0.35, 0.35])
    c.add(zone, "steelDark", pipe(v(cx + dx, y + 1, 6), v(cx + dx, 14.2, 6), 0.045, 6));
  c.add(zone, "crane", box(1.6, 1.8, 1.0, cx, 13.4, 6)); // hook block
  c.add(
    zone,
    "steelDark",
    new CylinderGeometry(0.3, 0.3, 0.3, 16).rotateZ(Math.PI / 2).translate(cx, 12.3, 6),
  );
  c.add(zone, "steelDark", pipe(v(cx, 12.2, 6), v(cx, 11.4, 6), 0.12, 8));
  // Warning stripes on the girder ends.
  for (const s of [-1, 1])
    for (const dx of [-1.8, 1.8])
      c.add(zone, "hazardDark", box(1.32, 2.22, 0.4, cx + dx, y, s * (span / 2 - 0.3)));
}

/** Floor: markings, embedded plates, access covers, trench drains, foundation zone. */
function floor(c: Collector): void {
  const zone: Zone = "floor";
  const lift = 0.012;
  const line = 0.15;
  // Perimeter walkway (inset 4 m) — restrained double line.
  const wx = X - 4;
  const wz = Z - 4;
  for (const d of [0, 1.4]) {
    c.add(
      zone,
      "markings",
      box(2 * (wx - d), 0.01, line, 0, lift, -(wz - d)),
      box(2 * (wx - d), 0.01, line, 0, lift, wz - d),
    );
    c.add(
      zone,
      "markings",
      box(line, 0.01, 2 * (wz - d), -(wx - d), lift, 0),
      box(line, 0.01, 2 * (wz - d), wx - d, lift, 0),
    );
  }
  // Build zone outline with corner brackets only (the grid shows the rest).
  const bx = HALL.buildHalfX;
  const bz = HALL.buildHalfZ;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      c.add(
        zone,
        "markings",
        box(6, 0.01, 0.25, sx * (bx - 3), lift, sz * bz),
        box(0.25, 0.01, 6, sx * bx, lift, sz * (bz - 3)),
      );
      for (let i = 0; i < 4; i += 1) {
        const g = new BoxGeometry(1.4, 0.01, 0.22)
          .rotateY((sx * sz * Math.PI) / 4)
          .translate(sx * (bx + 1.2), lift, sz * (bz - 1 - i * 0.7));
        c.add(zone, i % 2 === 0 ? "markings" : "hazardDark", g);
      }
    }
  }
  // Foundation zone: flush anchor plates on a 6 m ring and two embedded rails.
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    c.add(zone, "plates", box(1.2, 0.01, 1.2, Math.cos(a) * 17, 0.006, Math.sin(a) * 17));
    for (const [dx, dz] of [
      [-0.4, -0.4],
      [0.4, -0.4],
      [-0.4, 0.4],
      [0.4, 0.4],
    ] as const)
      c.add(
        zone,
        "steelDark",
        new CylinderGeometry(0.06, 0.06, 0.03, 8).translate(
          Math.cos(a) * 17 + dx,
          0.012,
          Math.sin(a) * 17 + dz,
        ),
      );
  }
  for (const z of [-26, 26]) {
    c.add(zone, "plates", box(2 * bx + 10, 0.01, 0.3, 0, 0.006, z));
    c.add(zone, "steelDark", box(2 * bx + 10, 0.012, 0.08, 0, 0.01, z));
  }
  // Access covers and trench drains.
  for (const [x, z] of [
    [-48, -20],
    [-48, 20],
    [48, -20],
    [48, 20],
    [0, -38],
    [-20, 38],
    [20, 38],
  ] as const) {
    c.add(zone, "plates", box(1.6, 0.01, 1.6, x, 0.007, z));
    c.add(
      zone,
      "steelDark",
      box(1.7, 0.008, 0.06, x, 0.009, z - 0.8),
      box(1.7, 0.008, 0.06, x, 0.009, z + 0.8),
    );
  }
  for (const z of [-Z + 2.2, Z - 2.2]) {
    c.add(zone, "steelDark", box(2 * X - 6, 0.01, 0.4, 0, 0.006, z));
    for (let x = -X + 3; x < X - 3; x += 0.5)
      c.add(zone, "steel", box(0.05, 0.012, 0.36, x, 0.009, z));
  }
}

/** Sparse perimeter equipment along the lower walls. */
function props(
  c: Collector,
  indicators: Array<Emitter & { zone: Zone }>,
  random: () => number,
): void {
  type Kit = (x: number, z: number, yaw: number, zone: Zone) => void;
  const rot = (
    g: BoxGeometry,
    x: number,
    z: number,
    yaw: number,
    lx: number,
    ly: number,
    lz: number,
  ) => g.translate(lx, ly, lz).rotateY(yaw).translate(x, 0, z);
  const cabinet: Kit = (x, z, yaw, zone) => {
    c.add(zone, "propGrey", rot(new BoxGeometry(1.2, 2.1, 0.6), x, z, yaw, 0, 1.05, 0));
    c.add(zone, "steelDark", rot(new BoxGeometry(1.1, 0.02, 0.62), x, z, yaw, 0, 1.6, 0));
    const p = new Vector3(0.35, 1.85, 0.31).applyAxisAngle(Y_AXIS, yaw).add(v(x, 0, z));
    indicators.push({ position: p, row: 0, zone });
  };
  const lockers: Kit = (x, z, yaw, zone) => {
    for (let i = 0; i < 4; i += 1)
      c.add(
        zone,
        "propBlue",
        rot(new BoxGeometry(0.48, 1.9, 0.5), x, z, yaw, -0.75 + i * 0.5, 0.95, 0),
      );
  };
  const fire: Kit = (x, z, yaw, zone) => {
    c.add(zone, "propRed", rot(new BoxGeometry(0.8, 1.1, 0.3), x, z, yaw, 0, 1.4, 0));
    c.add(zone, "propRed", rot(new BoxGeometry(0.22, 0.6, 0.22), x, z, yaw, 0.7, 0.3, 0));
  };
  const safety: Kit = (x, z, yaw, zone) => {
    c.add(zone, "propGreen", rot(new BoxGeometry(0.9, 1.4, 0.25), x, z, yaw, 0, 1.3, 0));
    c.add(zone, "steelDark", rot(new BoxGeometry(0.1, 1.9, 0.1), x, z, yaw, -0.6, 0.95, 0.1));
  };
  const rack: Kit = (x, z, yaw, zone) => {
    for (const lx of [-1.4, 1.4])
      c.add(zone, "accent", rot(new BoxGeometry(0.1, 3, 0.9), x, z, yaw, lx, 1.5, 0));
    for (const ly of [0.2, 1.2, 2.2, 2.95])
      c.add(zone, "steelDark", rot(new BoxGeometry(2.9, 0.08, 0.9), x, z, yaw, 0, ly, 0));
    for (const ly of [0.55, 1.55])
      c.add(
        zone,
        "propGrey",
        rot(new BoxGeometry(0.8 + random(), 0.6, 0.7), x, z, yaw, -0.6 + random() * 1.2, ly, 0),
      );
  };
  const cart: Kit = (x, z, yaw, zone) => {
    c.add(zone, "propGrey", rot(new BoxGeometry(1.4, 0.08, 0.8), x, z, yaw, 0, 0.8, 0));
    c.add(zone, "propGrey", rot(new BoxGeometry(1.4, 0.08, 0.8), x, z, yaw, 0, 0.3, 0));
    c.add(zone, "rubber", rot(new BoxGeometry(1.2, 0.18, 0.7), x, z, yaw, 0, 0.1, 0));
    c.add(zone, "steelDark", rot(new BoxGeometry(0.05, 0.6, 0.8), x, z, yaw, 0.7, 1.1, 0));
  };
  const bench: Kit = (x, z, yaw, zone) => {
    c.add(zone, "steelDark", rot(new BoxGeometry(2.4, 0.06, 0.9), x, z, yaw, 0, 0.9, 0));
    c.add(zone, "accent", rot(new BoxGeometry(2.3, 0.84, 0.05), x, z, yaw, 0, 0.45, 0.4));
    c.add(zone, "propGrey", rot(new BoxGeometry(0.5, 0.3, 0.4), x, z, yaw, 0.6, 1.08, 0));
  };
  const reel: Kit = (x, z, yaw, zone) => {
    const g = new CylinderGeometry(0.8, 0.8, 0.6, 20)
      .rotateX(Math.PI / 2)
      .translate(0, 0.8, 0)
      .rotateY(yaw)
      .translate(x, 0, z);
    c.add(zone, "rubber", g);
    c.add(
      zone,
      "propGrey",
      new CylinderGeometry(0.85, 0.85, 0.06, 20)
        .rotateX(Math.PI / 2)
        .translate(0, 0.8, 0.32)
        .rotateY(yaw)
        .translate(x, 0, z),
    );
  };
  const kits: Record<string, Kit> = { cabinet, lockers, fire, safety, rack, cart, bench, reel };
  // Along the north wall (facing +z): avoid doors, control-room stair and the bay opening.
  const north: Array<[number, string]> = [
    [-66, "rack"],
    [-62, "cabinet"],
    [-60.6, "cabinet"],
    [-51, "fire"],
    [-48, "lockers"],
    [-40, "bench"],
    [-31, "safety"],
    [-20, "cabinet"],
    [-18.6, "cabinet"],
    [-17.2, "cabinet"],
    [-8, "reel"],
    [4, "cart"],
    [12, "fire"],
    [38, "rack"],
    [62, "safety"],
    [65, "cabinet"],
  ];
  for (const [x, k] of north) kits[k]!(x, -Z + 1.2, 0, "north");
  const south: Array<[number, string]> = [
    [-62, "cabinet"],
    [-55, "fire"],
    [-30, "rack"],
    [-5, "lockers"],
    [22, "safety"],
    [40, "cart"],
    [60, "rack"],
  ];
  for (const [x, k] of south) kits[k]!(x, Z - 1.2, Math.PI, "south");
  const east: Array<[number, string]> = [
    [-40, "cabinet"],
    [-38.6, "cabinet"],
    [-30, "fire"],
    [-15, "bench"],
    [0, "rack"],
    [8, "safety"],
    [26, "reel"],
    [42, "cart"],
  ];
  for (const [z, k] of east) kits[k]!(X - 1.2, z, -Math.PI / 2, "east");
  const west: Array<[number, string]> = [
    [-40, "rack"],
    [-22, "fire"],
    [-17, "cabinet"],
    [-15.6, "cabinet"],
    [16, "safety"],
    [24, "lockers"],
    [33, "reel"],
    [40, "cart"],
  ];
  for (const [z, k] of west) kits[k]!(-X + 1.2, z, Math.PI / 2, "west");
}
