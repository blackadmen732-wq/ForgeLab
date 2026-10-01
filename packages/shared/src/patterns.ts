import {
  type Quaternion,
  fromAxisAngle,
  multiply,
  normalize as normalizeQuaternion,
  quaternion,
  rotateVec3,
} from "./quaternion.js";
import { type Transform, transform } from "./transform.js";
import { type Vec3, add, dot, normalize, scale, subtract, vec3 } from "./vec3.js";

/**
 * Pattern tools: placements for copies of a selection arranged in a ring, a row or
 * mirrored across a plane. Pure geometry — the editor turns the placements into parts.
 * Each function returns, per copy, one transform for every input transform (in order),
 * so relative placements inside the selection are preserved and links between its
 * members can be copied with them.
 */

export interface RadialPattern {
  /** A point on the rotation axis, m. */
  readonly origin: Vec3;
  /** Axis direction (normalised internally). */
  readonly axis: Vec3;
  /** Total number of instances including the original (≥ 2). */
  readonly count: number;
  /** Angle the instances span, rad. 2π (default) spaces them evenly around a full ring. */
  readonly spanRad?: number;
}

/** Copies 1…count−1 of `items` rotated about the axis. */
export function radialCopies(items: readonly Transform[], p: RadialPattern): Transform[][] {
  const count = Math.max(1, Math.floor(p.count));
  const span = p.spanRad ?? 2 * Math.PI;
  const full = Math.abs(Math.abs(span) - 2 * Math.PI) < 1e-9;
  const step = count <= 1 ? 0 : full ? span / count : span / (count - 1);
  const axis = normalize(p.axis);
  const copies: Transform[][] = [];
  for (let k = 1; k < count; k += 1) {
    const q = fromAxisAngle(axis, step * k);
    copies.push(
      items.map((t) =>
        transform(
          add(p.origin, rotateVec3(q, subtract(t.positionM, p.origin))),
          normalizeQuaternion(multiply(q, t.rotation)),
        ),
      ),
    );
  }
  return copies;
}

export interface LinearPattern {
  /** Offset between neighbouring instances, m. */
  readonly step: Vec3;
  /** Total number of instances including the original (≥ 2). */
  readonly count: number;
}

/** Copies 1…count−1 of `items`, each shifted by k·step. */
export function linearCopies(items: readonly Transform[], p: LinearPattern): Transform[][] {
  const copies: Transform[][] = [];
  for (let k = 1; k < Math.max(1, Math.floor(p.count)); k += 1)
    copies.push(items.map((t) => transform(add(t.positionM, scale(p.step, k)), t.rotation)));
  return copies;
}

export interface MirrorPlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

function toMatrix(q: Quaternion): Matrix3 {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ];
}

function fromMatrix(m: Matrix3): Quaternion {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let q: Quaternion;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = quaternion((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = quaternion(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = quaternion((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = quaternion((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return normalizeQuaternion(q);
}

function mul(a: Matrix3, b: Matrix3): Matrix3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r += 1)
    for (let c = 0; c < 3; c += 1)
      out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out as unknown as Matrix3;
}

function reflection(n: Vec3): Matrix3 {
  const [x, y, z] = [n.x, n.y, n.z];
  return [
    1 - 2 * x * x,
    -2 * x * y,
    -2 * x * z,
    -2 * x * y,
    1 - 2 * y * y,
    -2 * y * z,
    -2 * x * z,
    -2 * y * z,
    1 - 2 * z * z,
  ];
}

/**
 * The mirror image of each placement across a plane.
 *
 * Positions are reflected exactly. A placement is a proper rotation, so a part cannot be
 * turned into its left-handed twin; the mirrored orientation is the reflection composed
 * with the part's own symmetry plane closest to the mirror (R' = M·R·S, S a reflection
 * across a local principal plane). That is the exact mirror image for any part symmetric
 * about its principal planes — every parametric ForgeLab part (boxes, cylinders, tori,
 * finished machines' envelopes) — and the nearest proper placement otherwise.
 */
export function mirrorCopies(items: readonly Transform[], plane: MirrorPlane): Transform[] {
  const n = normalize(plane.normal);
  const m = reflection(n);
  return items.map((t) => {
    const d = dot(subtract(t.positionM, plane.point), n);
    const position = subtract(t.positionM, scale(n, 2 * d));
    const r = toMatrix(t.rotation);
    // The local principal axis most aligned with the mirror normal: rows of Rᵀ·n.
    const local = [
      r[0]! * n.x + r[3]! * n.y + r[6]! * n.z,
      r[1]! * n.x + r[4]! * n.y + r[7]! * n.z,
      r[2]! * n.x + r[5]! * n.y + r[8]! * n.z,
    ];
    const axis = local.map(Math.abs).reduce((best, v, i, all) => (v > all[best]! ? i : best), 0);
    const s = reflection(axis === 0 ? vec3(1, 0, 0) : axis === 1 ? vec3(0, 1, 0) : vec3(0, 0, 1));
    return transform(position, fromMatrix(mul(mul(m, r), s)));
  });
}
