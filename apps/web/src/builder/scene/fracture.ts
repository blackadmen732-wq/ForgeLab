import { type Color, Matrix4, Plane, Vector3 } from "three";
import { findFluid } from "@forgelab/materials";
import { findComponentDefinition } from "@forgelab/reactor-components";
import { materialColor } from "./appearance.js";

/**
 * How a part that broke up looks for the rest of the run. Presentation only: whether it
 * broke is the simulation's (its destruction event was fractured); this decides where
 * the casing is open and what the fragments are made of.
 *
 * The breach is a broken-off corner on the side the failure threw its debris: three
 * clip planes, tilted apart, of which a fragment must fall behind all three to be cut
 * away — a jagged trihedral gouge rather than a clean saw cut. It is held in the part's
 * own frame, so it moves with the part if the part falls. The machine's internals show
 * through it, cut by the same planes.
 */
type V3 = readonly [number, number, number];

export interface Breach {
  /** Part-local plane normals (pointing into the part, away from the hole). */
  readonly normals: readonly V3[];
  /** Part-local points the planes pass through. */
  readonly points: readonly V3[];
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * A breach on a part of local half extents `half`, opening towards local direction
 * `towards`. `amount` (0..1, the share of the part thrown as debris) sets how deep the
 * gouge reaches: from a chipped corner to nearly half the part.
 */
export function breachFor(half: V3, towards: V3, amount: number, rand: () => number): Breach {
  const d = norm(Math.hypot(...towards) < 1e-6 ? [0, 1, 0] : towards);
  // The part's extent along d (support of the box), and the depth of the gouge's apex.
  const reach = Math.abs(d[0]) * half[0] + Math.abs(d[1]) * half[1] + Math.abs(d[2]) * half[2];
  const depth = reach * (0.75 - 0.6 * Math.min(1, Math.max(0, amount)));
  // Two directions across d.
  const a = norm(Math.abs(d[1]) < 0.9 ? [d[2], 0, -d[0]] : [1, 0, 0]);
  const b: V3 = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const normals: V3[] = [];
  const points: V3[] = [];
  for (let k = 0; k < 3; k += 1) {
    const phase = (k / 3) * Math.PI * 2 + rand() * 0.6;
    const tilt = 0.45 + rand() * 0.35;
    const c = Math.cos(phase) * tilt;
    const s = Math.sin(phase) * tilt;
    const n = norm([
      d[0] + a[0] * c + b[0] * s,
      d[1] + a[1] * c + b[1] * s,
      d[2] + a[2] * c + b[2] * s,
    ]);
    normals.push([-n[0], -n[1], -n[2]]);
    const at = depth * (0.85 + rand() * 0.3);
    points.push([d[0] * at, d[1] * at, d[2] * at]);
  }
  return { normals, points };
}

/** Whether a part-local point is inside the gouge (cut away). For tests. */
export function inBreach(breach: Breach, p: V3): boolean {
  return breach.normals.every((n, k) => {
    const q = breach.points[k]!;
    return n[0] * (p[0] - q[0]) + n[1] * (p[1] - q[1]) + n[2] * (p[2] - q[2]) < 0;
  });
}

export interface FragmentColor {
  readonly color: Color;
  readonly weight: number;
}

/**
 * What a part's fragments are made of: mostly its casing material, the rest the solid
 * materials of its internals (copper winding, insulation, steel) in proportion to their
 * count. Fluids and vacuum do not fly as fragments.
 */
export function fragmentPalette(type: string, materialId: string): FragmentColor[] {
  const internals = findComponentDefinition(type)?.product.internals ?? [];
  const solids = internals.filter(
    (i) => i.substanceId !== null && i.kind !== "vacuum" && findFluid(i.substanceId) === undefined,
  );
  const palette: FragmentColor[] = [{ color: materialColor(materialId), weight: 0.6 }];
  for (const i of solids)
    palette.push({ color: materialColor(i.substanceId!), weight: 0.4 / solids.length });
  if (solids.length === 0) palette[0] = { color: palette[0]!.color, weight: 1 };
  return palette;
}

export function pickColor(palette: readonly FragmentColor[], r: number): Color {
  let x = r;
  for (const p of palette) {
    if (x < p.weight) return p.color;
    x -= p.weight;
  }
  return palette[palette.length - 1]!.color;
}

/* Run state: breaches of the parts that broke this run. Cleared on reset. ------------ */

const breaches = new Map<string, { breach: Breach; planes: Plane[] }>();

export function setBreach(componentId: string, breach: Breach): void {
  breaches.set(componentId, {
    breach,
    planes: breach.normals.map(() => new Plane()),
  });
}

export function clearBreaches(): void {
  breaches.clear();
}

export function breachedIds(): IterableIterator<string> {
  return breaches.keys();
}

/** World-space clip planes of a part's breach (aimed by `aimBreach`), or null. */
export function breachPlanes(componentId: string): Plane[] | null {
  return breaches.get(componentId)?.planes ?? null;
}

const n = new Vector3();
const p = new Vector3();
const normalMatrix = new Matrix4();

/** Moves a part's breach planes to where the part is now. */
export function aimBreach(componentId: string, matrixWorld: Matrix4): void {
  const entry = breaches.get(componentId);
  if (entry === undefined) return;
  normalMatrix.copy(matrixWorld).invert().transpose();
  entry.breach.normals.forEach((local, k) => {
    n.set(...local).transformDirection(normalMatrix);
    p.set(...entry.breach.points[k]!).applyMatrix4(matrixWorld);
    entry.planes[k]!.setFromNormalAndCoplanarPoint(n, p);
  });
}
