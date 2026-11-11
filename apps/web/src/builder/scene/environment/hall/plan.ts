import { HALL_LAYOUTS, type HallId, type HallLayout } from "./layout.js";

/**
 * The hall's plan: where its platforms, stairs, guard rails, columns, pits and perimeter
 * equipment are. Pure data derived from a layout: the drawing code (geometry.ts) and the
 * walk / fly cameras (navigation/collision.ts) both read this one description, so what a
 * visitor sees is what stops them.
 *
 * Presentation only. Nothing here is read by sim-core, placement or the service router:
 * every item sits outside the central build zone, and a test holds that line.
 */
export type V3 = readonly [number, number, number];
export type Zone = "north" | "south" | "east" | "west" | "overhead" | "floor";

/** A level platform people can stand on; `y` is the walking surface. */
export interface Deck {
  readonly id: string;
  readonly name: string;
  readonly zone: Zone;
  readonly kind: "gallery" | "catwalk" | "landing" | "bridge";
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A straight flight; `from` and `to` are the centres of its bottom and top nosings. */
export interface Stair {
  readonly id: string;
  readonly zone: Zone;
  readonly from: V3;
  readonly to: V3;
  readonly widthM: number;
}

/** A 1.1 m guard rail between two base points (level, or sloped beside a stair). */
export interface Rail {
  readonly zone: Zone;
  readonly a: V3;
  readonly b: V3;
}

/** An axis-aligned obstacle. `walk`: only people on foot meet it; `fly`: only the free camera. */
export interface Solid {
  readonly id: string;
  readonly min: V3;
  readonly max: V3;
  readonly scope: "all" | "walk" | "fly";
}

/** A rectangular hole in the floor slab: a grated trench (walkable) or a railed open pit. */
export interface FloorOpening {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly depthM: number;
  readonly cover: "grating" | "open";
}

export type PropKind =
  | "cabinet"
  | "lockers"
  | "fire"
  | "safety"
  | "rack"
  | "cart"
  | "bench"
  | "reel"
  | "coldbox"
  | "ahu"
  | "panelrow"
  | "tank"
  | "crates"
  | "gasrack";

/** Footprint of each kit in its own frame: width (local x), height, depth (local z), metres. */
export const PROP_SIZE: Readonly<Record<PropKind, readonly [number, number, number]>> = {
  cabinet: [1.2, 2.1, 0.6],
  lockers: [2.0, 1.9, 0.5],
  fire: [1.6, 1.95, 0.3],
  safety: [1.3, 2.0, 0.3],
  rack: [2.9, 3.0, 0.9],
  cart: [1.4, 1.4, 0.8],
  bench: [2.4, 1.25, 0.9],
  reel: [1.7, 1.65, 0.7],
  coldbox: [2.6, 3.7, 2.6],
  ahu: [4.0, 2.4, 2.0],
  panelrow: [4.0, 2.2, 0.8],
  tank: [3.8, 2.3, 1.9],
  crates: [2.4, 1.7, 1.6],
  gasrack: [1.7, 1.75, 0.6],
};

export interface PropPlacement {
  readonly kind: PropKind;
  readonly zone: Zone;
  /** Base centre. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Quarter turns only, so every footprint stays axis aligned. */
  readonly yaw: number;
  /** 0 = always drawn, 1 = MEDIUM and up, 2 = HIGH and up. Collision ignores it. */
  readonly detail: 0 | 1 | 2;
}

/** A steel column of the gallery frame (drawn and collided with). */
export interface Column {
  readonly zone: Zone;
  readonly x: number;
  readonly z: number;
  readonly y0: number;
  readonly y1: number;
  readonly sizeM: number;
}

export interface HallView {
  readonly label: string;
  readonly position: V3;
  readonly target: V3;
}

export interface HallPlan {
  readonly layout: HallLayout;
  readonly decks: readonly Deck[];
  readonly stairs: readonly Stair[];
  readonly rails: readonly Rail[];
  readonly columns: readonly Column[];
  readonly solids: readonly Solid[];
  readonly openings: readonly FloorOpening[];
  readonly props: readonly PropPlacement[];
  /** Where the bridge crane is parked (x) and the height of its girders' centre line. */
  readonly crane: { readonly x: number; readonly girderY: number; readonly spanM: number };
  /** Goods-lift shaft on the west wall: z range. */
  readonly lift: readonly [number, number];
  /** Free-camera vantage points: evidence shots and the "go to" places of the building. */
  readonly views: Readonly<Record<"establishing" | "eye" | "gallery" | "crane", HallView>>;
}

/** Guard-rail height, m. */
export const RAIL_HEIGHT_M = 1.1;

/** Deterministic PRNG so the hall is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  readonly decks: Deck[] = [];
  readonly stairs: Stair[] = [];
  readonly rails: Rail[] = [];
  readonly columns: Column[] = [];
  readonly solids: Solid[] = [];
  readonly openings: FloorOpening[] = [];
  readonly props: PropPlacement[] = [];

  deck(d: Deck): void {
    this.decks.push(d);
  }
  /** A flight with a guard rail on each side (`sides`: −1 left of travel, +1 right). */
  stair(id: string, zone: Zone, from: V3, to: V3, widthM: number, sides: readonly number[]): void {
    this.stairs.push({ id, zone, from, to, widthM });
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const run = Math.hypot(dx, dz);
    // Left of travel is (dz, −dx) / run in plan.
    for (const s of sides) {
      const ox = ((s * dz) / run) * (widthM / 2);
      const oz = ((-s * dx) / run) * (widthM / 2);
      this.rails.push({
        zone,
        a: [from[0] + ox, from[1], from[2] + oz],
        b: [to[0] + ox, to[1], to[2] + oz],
      });
    }
  }
  /** A level rail along x at depth z, leaving `gaps` (x ranges) open. */
  railX(
    zone: Zone,
    y: number,
    z: number,
    x0: number,
    x1: number,
    gaps: ReadonlyArray<readonly [number, number]> = [],
  ): void {
    let from = x0;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (a > from + 0.05) this.rails.push({ zone, a: [from, y, z], b: [Math.min(a, x1), y, z] });
      from = Math.max(from, b);
    }
    if (x1 > from + 0.05) this.rails.push({ zone, a: [from, y, z], b: [x1, y, z] });
  }
  /** A level rail along z at x, leaving `gaps` (z ranges) open. */
  railZ(
    zone: Zone,
    y: number,
    x: number,
    z0: number,
    z1: number,
    gaps: ReadonlyArray<readonly [number, number]> = [],
  ): void {
    let from = z0;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (a > from + 0.05) this.rails.push({ zone, a: [x, y, from], b: [x, y, Math.min(a, z1)] });
      from = Math.max(from, b);
    }
    if (z1 > from + 0.05) this.rails.push({ zone, a: [x, y, from], b: [x, y, z1] });
  }
  prop(
    kind: PropKind,
    zone: Zone,
    x: number,
    z: number,
    yaw: number,
    y = 0,
    detail: 0 | 1 | 2 = 1,
  ): void {
    this.props.push({ kind, zone, x, y, z, yaw, detail });
  }
}

/** The floor-plan box a prop occupies, from its kit footprint and quarter-turn yaw. */
export function propBounds(p: PropPlacement): { min: V3; max: V3 } {
  const [w, h, d] = PROP_SIZE[p.kind];
  const quarter = Math.round(p.yaw / (Math.PI / 2)) % 2 !== 0;
  const hx = (quarter ? d : w) / 2;
  const hz = (quarter ? w : d) / 2;
  return { min: [p.x - hx, p.y, p.z - hz], max: [p.x + hx, p.y + h, p.z + hz] };
}

/* ------------------------------------------------------------------------------------ *
 * Parts every hall has
 * ------------------------------------------------------------------------------------ */

function common(b: Builder, L: HallLayout) {
  const { halfX: X, halfZ: Z } = L;
  // Goods lift beside the equipment door.
  const l0 = -(L.doorM[0] / 2 + 25);
  const lift: readonly [number, number] = [l0, l0 + 6];
  b.solids.push({
    id: "goods-lift",
    min: [-X + 0.2, 0, lift[0] - 0.2],
    max: [-X + 4.7, 22.2, lift[1] + 0.2],
    scope: "all",
  });
  // Bridge crane parked over the loading bay: girders, trolley and hook block.
  const crane = { x: -X + 14, girderY: L.craneRailM + 1.6, spanM: 2 * Z - 3.4 };
  b.solids.push(
    {
      id: "crane-bridge",
      min: [crane.x - 2.9, crane.girderY - 1.6, -crane.spanM / 2],
      max: [crane.x + 2.9, crane.girderY + 1.3, crane.spanM / 2],
      scope: "fly",
    },
    {
      id: "crane-trolley",
      min: [crane.x - 2, crane.girderY + 1, 4.1],
      max: [crane.x + 2, crane.girderY + 4, 7.9],
      scope: "fly",
    },
    {
      id: "crane-hook",
      min: [crane.x - 0.9, 11.3, 5.4],
      max: [crane.x + 0.9, 14.4, 6.6],
      scope: "fly",
    },
  );
  // Service trenches either side of the build zone, under walkable bar grating.
  for (const [i, x] of [-(L.buildHalfX + 14), L.buildHalfX + 14].entries())
    b.openings.push({
      id: `trench-${i === 0 ? "west" : "east"}`,
      minX: x - 0.6,
      maxX: x + 0.6,
      minZ: -(Z - 6),
      maxZ: Z - 6,
      depthM: 0.7,
      cover: "grating",
    });
  return { lift, crane };
}

/** An open, railed pit. */
function pit(b: Builder, id: string, minX: number, maxX: number, minZ: number, maxZ: number) {
  b.openings.push({ id, minX, maxX, minZ, maxZ, depthM: 3.4, cover: "open" });
  const m = 0.25;
  b.railX("floor", 0, minZ - m, minX - m, maxX + m);
  b.railX("floor", 0, maxZ + m, minX - m, maxX + m);
  b.railZ("floor", 0, minX - m, minZ - m, maxZ + m);
  b.railZ("floor", 0, maxX + m, minZ - m, maxZ + m);
}

/* ------------------------------------------------------------------------------------ *
 * Reactor hall, 140 × 90 m
 * ------------------------------------------------------------------------------------ */

function standard(b: Builder, L: HallLayout): HallPlan["views"] {
  const { halfX: X, halfZ: Z } = L;
  // North wall: maintenance gantry at +9 m with one flight from the floor.
  const front = -Z + 2.8;
  b.deck({
    id: "north-gantry",
    name: "Maintenance gantry · +9 m",
    zone: "north",
    kind: "gallery",
    y: 9,
    minX: -30.5,
    maxX: 22.5,
    minZ: -Z + 0.2,
    maxZ: front,
  });
  b.stair("north-gantry-stair", "north", [33.5, 0, front - 0.75], [22.5, 9, front - 0.75], 1.4, [
    -1, 1,
  ]);
  b.railX("north", 9, front, -30.5, 22.5);
  b.railZ("north", 9, -30.5, -Z + 0.2, front);
  b.railZ("north", 9, 22.5, -Z + 0.2, front - 1.45);
  // Crane-maintenance catwalk at +20 m (reached from a caged ladder; fly up to it).
  b.deck({
    id: "north-catwalk",
    name: "Crane catwalk · +20 m",
    zone: "north",
    kind: "catwalk",
    y: 20,
    minX: -X + 2,
    maxX: X - 2,
    minZ: -Z + 0.6,
    maxZ: -Z + 2.2,
  });
  b.railX("north", 20, -Z + 2.2, -X + 2, X - 2);
  b.railZ("north", 20, -X + 2, -Z + 0.6, -Z + 2.2);
  b.railZ("north", 20, X - 2, -Z + 0.6, -Z + 2.2);

  // East wall: two service catwalks, floor → +8 m → +16 m.
  const e0 = X - 3.5;
  const e1 = X - 0.3;
  b.deck({
    id: "east-catwalk-1",
    name: "East catwalk · +8 m",
    zone: "east",
    kind: "catwalk",
    y: 8,
    minX: e0,
    maxX: e1,
    minZ: -37,
    maxZ: 30,
  });
  b.deck({
    id: "east-catwalk-2",
    name: "East catwalk · +16 m",
    zone: "east",
    kind: "catwalk",
    y: 16,
    minX: e0,
    maxX: e1,
    minZ: -26,
    maxZ: 22,
  });
  b.stair("east-stair-1", "east", [X - 1.9, 0, 40.6], [X - 1.9, 8, 30], 1.4, [-1, 1]);
  b.stair("east-stair-2", "east", [X - 2.75, 8, -35.5], [X - 2.75, 16, -26], 1.2, [-1, 1]);
  b.railZ("east", 8, e0, -37, 30);
  b.railX("east", 8, -37, e0, e1);
  b.railX("east", 8, 30, e0, e1, [[X - 2.6, X - 1.2]]);
  b.railZ("east", 16, e0, -26, 22);
  b.railX("east", 16, 22, e0, e1);
  b.railX("east", 16, -26, e0, e1, [[X - 3.35, X - 2.15]]);

  pit(b, "sump-pit", 56, 63, -38.5, -33.5);

  // Perimeter equipment, as before: tight to the walls, clear of doors and stairs.
  const north: Array<[number, PropKind]> = [
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
  for (const [x, k] of north) b.prop(k, "north", x, -Z + 1.2, 0);
  const south: Array<[number, PropKind]> = [
    [-62, "cabinet"],
    [-55, "fire"],
    [-30, "rack"],
    [-5, "lockers"],
    [22, "safety"],
    [40, "cart"],
    [60, "rack"],
  ];
  for (const [x, k] of south) b.prop(k, "south", x, Z - 1.2, Math.PI);
  const east: Array<[number, PropKind]> = [
    [-40, "cabinet"],
    [-38.6, "cabinet"],
    [-30, "fire"],
    [-15, "bench"],
    [0, "rack"],
    [8, "safety"],
    [26, "reel"],
  ];
  for (const [z, k] of east) b.prop(k, "east", X - 1.2, z, -Math.PI / 2);
  const west: Array<[number, PropKind]> = [
    [-40, "rack"],
    [-22, "fire"],
    [-17, "cabinet"],
    [-15.6, "cabinet"],
    [16, "safety"],
    [24, "lockers"],
    [33, "reel"],
    [40, "cart"],
  ];
  for (const [z, k] of west) b.prop(k, "west", -X + 1.2, z, Math.PI / 2);
  // Laydown area by the loading bay and plant on the gantry.
  b.prop("crates", "west", -X + 9, 20, 0, 0, 1);
  b.prop("crates", "west", -X + 12.2, 21, Math.PI / 2, 0, 2);
  b.prop("gasrack", "west", -X + 1.2, -11, Math.PI / 2, 0, 1);
  b.prop("panelrow", "north", -22, -Z + 0.9, 0, 9, 1);
  b.prop("panelrow", "north", -8, -Z + 0.9, 0, 9, 2);
  b.prop("panelrow", "east", X - 0.9, 4, -Math.PI / 2, 8, 1);
  b.prop("panelrow", "east", X - 0.9, -12, -Math.PI / 2, 16, 2);

  return {
    establishing: {
      label: "Hall overview",
      position: [64, 27, 41],
      target: [-12, 7, -10],
    },
    eye: { label: "Floor, by the south wall", position: [34, 1.7, 36], target: [-6, 7, -6] },
    gallery: {
      label: "East catwalk · +8 m",
      position: [X - 1.7, 9.7, 24],
      target: [10, 5, -14],
    },
    crane: { label: "Bridge crane", position: [-22, 24, 24], target: [-56, 42, -2] },
  };
}

/* ------------------------------------------------------------------------------------ *
 * Tokamak assembly bay, 220 × 130 m, with service galleries on both long walls
 * ------------------------------------------------------------------------------------ */

/** Plan length of one gallery stair flight, and of the landing at each end. */
const FLIGHT_RUN_M = 11;
const LANDING_M = 1.8;
const STRIP_M = 1.5;
/** Where each gallery's two stair stacks start (x of the foot of every flight). */
export const GALLERY_STAIRS_X: readonly number[] = [-58, 42];

function assemblyBay(b: Builder, L: HallLayout): HallPlan["views"] {
  const { halfX: X, halfZ: Z } = L;
  const levels = [0, ...L.galleryLevelsM];
  const top = levels[levels.length - 1]!;
  const gx0 = -X + 26;
  const gx1 = X - 0.3;
  const bridgeX0 = X - 3.5;
  const random = mulberry32(2611);
  for (const side of [-1, 1] as const) {
    const zone: Zone = side < 0 ? "north" : "south";
    const wall = side * Z;
    const zFront = side * (Z - L.galleryDepthM);
    const zOuter = zFront - side * STRIP_M;
    const zStair = zFront - side * (STRIP_M / 2);
    const lo = (a: number, c: number) => Math.min(a, c);
    const hi = (a: number, c: number) => Math.max(a, c);
    for (let k = 1; k < levels.length; k += 1) {
      const y = levels[k]!;
      b.deck({
        id: `${zone}-gallery-${k}`,
        name: `${zone === "north" ? "North" : "South"} gallery · level ${k} (+${y} m)`,
        zone,
        kind: "gallery",
        y,
        minX: gx0,
        maxX: gx1,
        minZ: lo(wall - side * 0.2, zFront),
        maxZ: hi(wall - side * 0.2, zFront),
      });
      const gaps: Array<readonly [number, number]> = [];
      for (const a of GALLERY_STAIRS_X) {
        // Top landing of the flight below, and foot landing of the flight above.
        gaps.push([a + FLIGHT_RUN_M, a + FLIGHT_RUN_M + LANDING_M]);
        b.deck({
          id: `${zone}-landing-${k}-top-${a}`,
          name: `Stair landing · +${y} m`,
          zone,
          kind: "landing",
          y,
          minX: a + FLIGHT_RUN_M,
          maxX: a + FLIGHT_RUN_M + LANDING_M,
          minZ: lo(zFront, zOuter),
          maxZ: hi(zFront, zOuter),
        });
        b.railX(zone, y, zOuter, a + FLIGHT_RUN_M, a + FLIGHT_RUN_M + LANDING_M);
        b.railZ(zone, y, a + FLIGHT_RUN_M + LANDING_M, lo(zFront, zOuter), hi(zFront, zOuter));
        if (k < levels.length - 1) {
          gaps.push([a - LANDING_M, a]);
          b.deck({
            id: `${zone}-landing-${k}-foot-${a}`,
            name: `Stair landing · +${y} m`,
            zone,
            kind: "landing",
            y,
            minX: a - LANDING_M,
            maxX: a,
            minZ: lo(zFront, zOuter),
            maxZ: hi(zFront, zOuter),
          });
          b.railX(zone, y, zOuter, a - LANDING_M, a);
          b.railZ(zone, y, a - LANDING_M, lo(zFront, zOuter), hi(zFront, zOuter));
        }
      }
      // The east bridges meet the galleries on levels 2 and 4.
      if (k % 2 === 0) gaps.push([bridgeX0, gx1]);
      b.railX(zone, y, zFront, gx0, gx1, gaps);
      b.railZ(zone, y, gx0, lo(wall - side * 0.2, zFront), hi(wall - side * 0.2, zFront));
    }
    // One flight per storey in each stack, all climbing east, stacked above one another.
    for (const a of GALLERY_STAIRS_X)
      for (let k = 0; k < levels.length - 1; k += 1)
        b.stair(
          `${zone}-stair-${k}-${a}`,
          zone,
          [a, levels[k]!, zStair],
          [a + FLIGHT_RUN_M, levels[k + 1]!, zStair],
          STRIP_M - 0.2,
          [-1, 1],
        );
    // Front columns on the bay grid, floor to above the top deck.
    for (let x = gx0 + 4; x <= gx1 - 5; x += L.bayM)
      b.columns.push({ zone, x, z: zFront + side * 0.3, y0: 0, y1: top + 1.4, sizeM: 0.5 });

    // Plant on every storey (0 = the undercroft at floor level), along the back wall and in
    // a second row mid-depth, leaving the front of each deck clear to walk.
    const back = wall - side * 1.1;
    const mid = wall - side * 5.4;
    const yawBack = side < 0 ? 0 : Math.PI;
    const wallKits: PropKind[] = ["cabinet", "panelrow", "rack", "lockers", "bench", "gasrack"];
    const floorKits: PropKind[] = ["coldbox", "ahu", "tank", "panelrow", "crates"];
    for (let k = 0; k < levels.length; k += 1) {
      const y = levels[k]!;
      for (let x = gx0 + 5; x < gx1 - 8; x += 9 + Math.floor(random() * 3) * 3) {
        const kit = wallKits[Math.floor(random() * wallKits.length)]!;
        // Doors into the adjoining building stand every 40 m: keep them clear.
        if (Math.abs(((x + 400) % 40) - 20) < 3) continue;
        b.prop(kit, zone, x, back, yawBack, y, k <= 1 ? 1 : 2);
      }
      for (let x = gx0 + 12; x < gx1 - 14; x += 17 + Math.floor(random() * 3) * 4) {
        const kit = floorKits[Math.floor(random() * floorKits.length)]!;
        b.prop(kit, zone, x, mid, random() > 0.5 ? yawBack : yawBack + Math.PI, y, k <= 1 ? 1 : 2);
      }
    }
  }
  // East wall: bridges tying the two galleries together on levels 2 and 4.
  for (let k = 2; k < levels.length; k += 2) {
    const y = levels[k]!;
    const z1 = Z - L.galleryDepthM;
    b.deck({
      id: `east-bridge-${k}`,
      name: `East bridge · level ${k} (+${y} m)`,
      zone: "east",
      kind: "bridge",
      y,
      minX: bridgeX0,
      maxX: gx1,
      minZ: -z1,
      maxZ: z1,
    });
    b.railZ("east", y, bridgeX0, -z1, z1);
  }
  pit(b, "sump-pit", 88, 97, -49, -43);
  pit(b, "drain-tank-pit", -100, -90, 42, 48);

  // Ends of the bay: equipment along the short walls and a laydown area by the door.
  const east: Array<[number, PropKind]> = [
    [-44, "rack"],
    [-36, "cabinet"],
    [-34.6, "cabinet"],
    [-22, "fire"],
    [-10, "bench"],
    [2, "rack"],
    [14, "safety"],
    [24, "reel"],
    [36, "lockers"],
    [45, "cart"],
  ];
  for (const [z, k] of east) b.prop(k, "east", X - 1.2, z, -Math.PI / 2);
  const west: Array<[number, PropKind]> = [
    [-50, "rack"],
    [-44, "gasrack"],
    [-24, "fire"],
    [-19, "cabinet"],
    [-17.6, "cabinet"],
    [20, "safety"],
    [28, "lockers"],
    [38, "reel"],
    [47, "cart"],
  ];
  for (const [z, k] of west) b.prop(k, "west", -X + 1.2, z, Math.PI / 2);
  b.prop("crates", "west", -X + 9, 26, 0, 0, 1);
  b.prop("crates", "west", -X + 12.4, 27, Math.PI / 2, 0, 1);
  b.prop("crates", "west", -X + 9.6, 30.5, 0, 0, 2);
  b.prop("tank", "west", -X + 10, -44, 0, 0, 1);

  const zf = Z - L.galleryDepthM;
  return {
    establishing: { label: "Bay overview", position: [98, 36, 46], target: [-24, 10, -16] },
    eye: { label: "Floor, by the south gallery", position: [46, 1.7, 47], target: [-8, 9, -8] },
    gallery: {
      label: "South gallery · level 2",
      position: [24, levels[2]! + 1.7, zf + 1.4],
      target: [-14, 8, -20],
    },
    crane: { label: "Bridge crane", position: [-56, 30, 30], target: [-X + 14, 56, -4] },
  };
}

/* ------------------------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------------------------ */

const cache = new Map<HallId, HallPlan>();

export function hallPlan(layout: HallLayout): HallPlan {
  const cached = cache.get(layout.id);
  if (cached !== undefined && cached.layout === layout) return cached;
  const b = new Builder();
  const { lift, crane } = common(b, layout);
  const views = layout.galleryLevelsM.length > 0 ? assemblyBay(b, layout) : standard(b, layout);
  // Perimeter kits and gallery columns stop people on foot (and the free camera).
  for (const [i, p] of b.props.entries()) {
    if (p.kind === "fire" || p.kind === "safety") continue;
    b.solids.push({ id: `prop-${i}-${p.kind}`, ...propBounds(p), scope: "all" });
  }
  for (const [i, c] of b.columns.entries())
    b.solids.push({
      id: `column-${i}`,
      min: [c.x - c.sizeM / 2, c.y0, c.z - c.sizeM / 2],
      max: [c.x + c.sizeM / 2, c.y1, c.z + c.sizeM / 2],
      scope: "all",
    });
  const plan: HallPlan = Object.freeze({
    layout,
    decks: b.decks,
    stairs: b.stairs,
    rails: b.rails,
    columns: b.columns,
    solids: b.solids,
    openings: b.openings,
    props: b.props,
    crane,
    lift,
    views,
  });
  if (HALL_LAYOUTS[layout.id] === layout) cache.set(layout.id, plan);
  return plan;
}
