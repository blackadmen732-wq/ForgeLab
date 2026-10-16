import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { ConnectionPoint } from "@forgelab/sim-core";

export type Sample = { position: Vector3; normal: Vector3 };
type Surface = (u: number, v: number) => Sample;
export interface PortOpening {
  readonly point: ConnectionPoint;
  readonly boreM: number;
  readonly wallM: number;
  readonly depthM: number;
}

/** Engineering bores come from the port. Unspecified fuel/heating sizes are visual only. */
export function portOpenings(
  points: readonly ConnectionPoint[],
  scaleM: number,
  vesselWallM = 0,
): PortOpening[] {
  return points.flatMap((point) => {
    const p = point.port;
    const boreM =
      p?.domain === "fluid"
        ? p.innerDiameterM / 2
        : p?.domain === "vacuum"
          ? p.flangeDiameterM / 2
          : p?.domain === "heating"
            ? Math.min(0.38, scaleM * 0.2)
            : p?.domain === "fuel"
              ? Math.min(0.04, scaleM * 0.05)
              : 0;
    if (boreM === 0) return [];
    const wallM = Math.min(0.025, Math.max(0.005, boreM * 0.12));
    return [{ point, boreM, wallM, depthM: Math.max(0.18, boreM * 2.2 + vesselWallM) }];
  });
}

type Vertex = { position: Vector3; normal: Vector3; uv: [number, number]; index: number };
type CutPlane = { normal: Vector3; constant: number };
type Cutter = { at: Vector3; axis: Vector3; radius: number; depth: number; planes: CutPlane[] };

/** A polygonal cylinder inside the nozzle's outer wall, enclosing its entire usable bore. */
function cutter(opening: PortOpening): Cutter {
  const { point, boreM, wallM, depthM } = opening;
  const at = new Vector3(point.localPosition.x, point.localPosition.y, point.localPosition.z);
  const axis = new Vector3(
    point.localDirection.x,
    point.localDirection.y,
    point.localDirection.z,
  ).normalize();
  const x = new Vector3()
    .crossVectors(axis, Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))
    .normalize();
  const y = new Vector3().crossVectors(axis, x);
  const radius = boreM + wallM,
    sides = 24,
    planes: CutPlane[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i * Math.PI * 2) / sides;
    const normal = x.clone().multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a));
    planes.push({ normal, constant: normal.dot(at) + radius * Math.cos(Math.PI / sides) });
  }
  planes.push({ normal: axis, constant: axis.dot(at) + 0.03 });
  const back = axis.clone().negate();
  planes.push({ normal: back, constant: back.dot(at) + depthM });
  return { at, axis, radius, depth: depthM, planes };
}

function clip(polygon: Vertex[], plane: CutPlane, inside: boolean): Vertex[] {
  if (polygon.length < 3) return [];
  const out: Vertex[] = [];
  let previous = polygon[polygon.length - 1]!;
  let pd = plane.normal.dot(previous.position) - plane.constant;
  let keepPrevious = inside ? pd <= 0 : pd > 0;
  for (const current of polygon) {
    const cd = plane.normal.dot(current.position) - plane.constant;
    const keepCurrent = inside ? cd <= 0 : cd > 0;
    if (keepCurrent !== keepPrevious) {
      const t = pd / (pd - cd);
      out.push({
        position: previous.position.clone().lerp(current.position, t),
        normal: previous.normal.clone().lerp(current.normal, t).normalize(),
        uv: [
          previous.uv[0] + (current.uv[0] - previous.uv[0]) * t,
          previous.uv[1] + (current.uv[1] - previous.uv[1]) * t,
        ],
        index: -1,
      });
    }
    if (keepCurrent) out.push(current);
    previous = current;
    pd = cd;
    keepPrevious = keepCurrent;
  }
  return out.length >= 3 ? out : [];
}

/** Subtract a bounded convex cutter. Keep and triangulate the exterior pieces. */
function subtract(polygon: Vertex[], cut: Cutter): Vertex[][] {
  const center = polygon
    .reduce((v, p) => v.add(p.position), new Vector3())
    .multiplyScalar(1 / polygon.length);
  const bound = Math.sqrt(Math.max(...polygon.map((p) => p.position.distanceToSquared(center))));
  const delta = center.clone().sub(cut.at),
    along = delta.dot(cut.axis);
  if (
    along > 0.03 + bound ||
    along < -cut.depth - bound ||
    delta.addScaledVector(cut.axis, -along).lengthSq() > (cut.radius + bound) ** 2
  )
    return [polygon];
  const outside: Vertex[][] = [];
  let remaining = polygon;
  for (const plane of cut.planes) {
    const piece = clip(remaining, plane, false);
    if (piece.length) outside.push(piece);
    remaining = clip(remaining, plane, true);
    if (!remaining.length) break;
  }
  return outside;
}

/** Analytic normals and trimmed openings: no complete grid cell is removed at a bore. */
function surface(
  sample: Surface,
  nu: number,
  nv: number,
  urange: readonly [number, number],
  vrange: readonly [number, number],
  openings: readonly PortOpening[],
  inward: boolean,
): BufferGeometry {
  const position: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const vertices: Vertex[] = [],
    cutters = openings.map(cutter);
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = urange[0] + ((urange[1] - urange[0]) * i) / nu;
      const v = vrange[0] + ((vrange[1] - vrange[0]) * j) / nv;
      const s = sample(u, v);
      s.normal.multiplyScalar(inward ? -1 : 1);
      position.push(...s.position.toArray());
      normal.push(...s.normal.toArray());
      uv.push(i / nu, j / nv);
      vertices.push({ ...s, uv: [i / nu, j / nv], index: vertices.length });
    }
  const add = (v: Vertex) => {
    if (v.index < 0) {
      v.index = position.length / 3;
      position.push(...v.position.toArray());
      normal.push(...v.normal.toArray());
      uv.push(...v.uv);
    }
    return v.index;
  };
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        b = a + 1,
        c = a + nu + 1,
        d = c + 1;
      for (const tri of inward
        ? [
            [a, b, c],
            [b, d, c],
          ]
        : [
            [a, c, b],
            [b, c, d],
          ]) {
        let pieces = [tri.map((n) => vertices[n]!)];
        for (const cut of cutters) pieces = pieces.flatMap((p) => subtract(p, cut));
        for (const polygon of pieces)
          for (let k = 1; k < polygon.length - 1; k++) {
            const va = polygon[0]!,
              vb = polygon[k]!,
              vc = polygon[k + 1]!;
            if (
              new Vector3()
                .subVectors(vb.position, va.position)
                .cross(new Vector3().subVectors(vc.position, va.position))
                .lengthSq() < 1e-20
            )
              continue;
            index.push(add(va), add(vb), add(vc));
          }
      }
    }
  return new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute(position, 3))
    .setAttribute("normal", new Float32BufferAttribute(normal, 3))
    .setAttribute("uv", new Float32BufferAttribute(uv, 2))
    .setIndex(index);
}

/** Canonical Y-axis torus, in real metres. u circles the plant; v circles its tube. */
export function torusSample(R: number, r: number, u: number, v: number): Sample {
  const cu = Math.cos(u),
    su = Math.sin(u),
    cv = Math.cos(v),
    sv = Math.sin(v);
  return {
    position: new Vector3((R + r * cv) * cu, r * sv, (R + r * cv) * su),
    normal: new Vector3(cv * cu, sv, cv * su),
  };
}

export function torusSkin(
  R: number,
  r: number,
  openings: readonly PortOpening[] = [],
  inward = false,
  urange: readonly [number, number] = [0, Math.PI * 2],
  vrange: readonly [number, number] = [0, Math.PI * 2],
  segments: readonly [number, number] = [128, 48],
): BufferGeometry {
  return surface((u, v) => torusSample(R, r, u, v), ...segments, urange, vrange, openings, inward);
}

/** Open-ended cylindrical skin: end covers are separately built from real dimensions. */
export function cylinderSkin(
  radiusM: number,
  heightM: number,
  openings: readonly PortOpening[] = [],
  inward = false,
): BufferGeometry {
  return surface(
    (u, y) => ({
      position: new Vector3(radiusM * Math.cos(u), y, radiusM * Math.sin(u)),
      normal: new Vector3(Math.cos(u), 0, Math.sin(u)),
    }),
    96,
    40,
    [0, Math.PI * 2],
    [-heightM / 2, heightM / 2],
    openings,
    inward,
  );
}
