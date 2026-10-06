import type { Vec3 } from "@forgelab/shared";
import type { Aabb } from "../geometry.js";

/**
 * Uniform-grid broad phase.
 *
 * Each item's bounding box is inserted into every cell it overlaps. A query collects the
 * items in the cells its box overlaps, then keeps only those whose box really intersects.
 * This keeps hazard propagation proportional to what is near a hazard rather than to the
 * square of the component count.
 *
 * Results are sorted by id, so iteration order never depends on insertion order or on
 * JavaScript hash ordering — a requirement for determinism.
 */
export class SpatialHash {
  readonly #cellSizeM: number;
  readonly #cells = new Map<string, string[]>();
  readonly #boxes = new Map<string, Aabb>();
  #bounds: Aabb | undefined;

  constructor(cellSizeM: number) {
    if (!(cellSizeM > 0)) throw new RangeError("SpatialHash cell size must be positive.");
    this.#cellSizeM = cellSizeM;
  }

  get size(): number {
    return this.#boxes.size;
  }

  insert(id: string, box: Aabb): void {
    this.#boxes.set(id, box);
    this.#bounds =
      this.#bounds === undefined
        ? box
        : {
            minM: {
              x: Math.min(this.#bounds.minM.x, box.minM.x),
              y: Math.min(this.#bounds.minM.y, box.minM.y),
              z: Math.min(this.#bounds.minM.z, box.minM.z),
            },
            maxM: {
              x: Math.max(this.#bounds.maxM.x, box.maxM.x),
              y: Math.max(this.#bounds.maxM.y, box.maxM.y),
              z: Math.max(this.#bounds.maxM.z, box.maxM.z),
            },
          };
    this.#forEachCell(box, (key) => {
      const bucket = this.#cells.get(key);
      if (bucket === undefined) this.#cells.set(key, [id]);
      else bucket.push(id);
    });
  }

  /** Ids whose boxes intersect `box`, sorted. */
  queryBox(box: Aabb): string[] {
    const bounds = this.#bounds;
    if (bounds === undefined || !intersects(bounds, box)) return [];
    // A huge query (a fire's plume reach) never walks cells beyond what is occupied.
    const clipped: Aabb = {
      minM: {
        x: Math.max(box.minM.x, bounds.minM.x),
        y: Math.max(box.minM.y, bounds.minM.y),
        z: Math.max(box.minM.z, bounds.minM.z),
      },
      maxM: {
        x: Math.min(box.maxM.x, bounds.maxM.x),
        y: Math.min(box.maxM.y, bounds.maxM.y),
        z: Math.min(box.maxM.z, bounds.maxM.z),
      },
    };
    const found = new Set<string>();
    this.#forEachCell(clipped, (key) => {
      for (const id of this.#cells.get(key) ?? []) found.add(id);
    });
    return [...found].filter((id) => intersects(this.#boxes.get(id)!, box)).sort();
  }

  /** Ids whose boxes come within `radiusM` of a point, sorted. */
  querySphere(centerM: Vec3, radiusM: number): string[] {
    const box: Aabb = {
      minM: { x: centerM.x - radiusM, y: centerM.y - radiusM, z: centerM.z - radiusM },
      maxM: { x: centerM.x + radiusM, y: centerM.y + radiusM, z: centerM.z + radiusM },
    };
    return this.queryBox(box).filter(
      (id) => distanceToAabb(centerM, this.#boxes.get(id)!) <= radiusM,
    );
  }

  #forEachCell(box: Aabb, visit: (key: string) => void): void {
    const s = this.#cellSizeM;
    const x0 = Math.floor(box.minM.x / s);
    const y0 = Math.floor(box.minM.y / s);
    const z0 = Math.floor(box.minM.z / s);
    const x1 = Math.floor(box.maxM.x / s);
    const y1 = Math.floor(box.maxM.y / s);
    const z1 = Math.floor(box.maxM.z / s);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) visit(`${x},${y},${z}`);
      }
    }
  }
}

export function intersects(a: Aabb, b: Aabb): boolean {
  return (
    a.minM.x <= b.maxM.x &&
    a.maxM.x >= b.minM.x &&
    a.minM.y <= b.maxM.y &&
    a.maxM.y >= b.minM.y &&
    a.minM.z <= b.maxM.z &&
    a.maxM.z >= b.minM.z
  );
}

/** Distance from a point to the nearest point of a box (0 inside). */
export function distanceToAabb(p: Vec3, box: Aabb): number {
  const dx = Math.max(box.minM.x - p.x, 0, p.x - box.maxM.x);
  const dy = Math.max(box.minM.y - p.y, 0, p.y - box.maxM.y);
  const dz = Math.max(box.minM.z - p.z, 0, p.z - box.maxM.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Whether the segment from `a` to `b` passes through `box` (slab test). Used for line-of-
 * sight shielding: a barrier between a fire and a target intercepts the radiation.
 */
export function segmentIntersectsAabb(a: Vec3, b: Vec3, box: Aabb): boolean {
  let tMin = 0;
  let tMax = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const origin = a[axis];
    const delta = b[axis] - origin;
    const lo = box.minM[axis];
    const hi = box.maxM[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    let t1 = (lo - origin) / delta;
    let t2 = (hi - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

export function aabbCenter(box: Aabb): Vec3 {
  return {
    x: (box.minM.x + box.maxM.x) / 2,
    y: (box.minM.y + box.maxM.y) / 2,
    z: (box.minM.z + box.maxM.z) / 2,
  };
}
