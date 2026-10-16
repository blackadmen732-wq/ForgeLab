import {
  type BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PointM = readonly [number, number, number];
export type Axis = "x" | "y" | "z";
const UP = new Vector3(0, 1, 0);
// CPU-only template, shared by every pattern. Clones are merged and disposed per build.
const HEX_HEAD = new CylinderGeometry(1, 1, 1, 6);

/** One hex head from the same CPU template used by all bolt patterns. */
export function hexHead(radiusM: number, heightM: number): BufferGeometry {
  return HEX_HEAD.clone().scale(radiusM, heightM, radiusM);
}

/** Consumes temporary geometries; a pattern is one mesh, never a mesh per fastener. */
export function joinGeometry(parts: BufferGeometry[]): BufferGeometry {
  const copies = parts.map((p) => (p.index === null ? p : p.toNonIndexed()));
  const result = mergeGeometries(copies, false);
  for (const p of new Set([...parts, ...copies])) p.dispose();
  if (result === null) throw new Error("Industrial geometry could not be combined");
  return result;
}

/** A manufactured edge, with the bevel measured in metres. */
export function roundedHousing(size: PointM, at: PointM, bevelM: number): BufferGeometry {
  return new RoundedBoxGeometry(...size, 2, Math.min(bevelM, ...size.map((v) => v / 4))).translate(
    ...at,
  );
}

function along(g: BufferGeometry, axis: Axis, at: PointM): BufferGeometry {
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(...at);
}

/** Hollow, bevel-edged sleeve/flange. The bore stays open all the way through. */
export function flangedRing(
  boreRadiusM: number,
  outerRadiusM: number,
  lengthM: number,
  axis: Axis,
  at: PointM,
  segments = 48,
): BufferGeometry {
  const b = Math.min(0.008, lengthM * 0.15, (outerRadiusM - boreRadiusM) * 0.12);
  const h = lengthM / 2;
  const profile = [
    [boreRadiusM, -h + b],
    [boreRadiusM + b, -h],
    [outerRadiusM - b, -h],
    [outerRadiusM, -h + b],
    [outerRadiusM, h - b],
    [outerRadiusM - b, h],
    [boreRadiusM + b, h],
    [boreRadiusM, h - b],
    [boreRadiusM, -h + b],
  ];
  return along(
    new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r!, y!)),
      segments,
    ),
    axis,
    at,
  );
}

/** Clone one hex-head prototype around a physical bolt circle, then batch the result. */
export function boltCircle(
  pitchRadiusM: number,
  headRadiusM: number,
  headHeightM: number,
  count: number,
  axis: Axis,
  at: PointM,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = ((i + 0.5) * Math.PI * 2) / count;
    parts.push(
      hexHead(headRadiusM, headHeightM).translate(
        Math.cos(a) * pitchRadiusM,
        0,
        Math.sin(a) * pitchRadiusM,
      ),
    );
  }
  return along(joinGeometry(parts), axis, at);
}

/** Open-bore pipe skin following a visual route; engineering losses still belong to sim-core. */
export function curvedConduit(
  pointsM: readonly PointM[],
  boreRadiusM: number,
  wallM: number,
): BufferGeometry {
  const curve = new CatmullRomCurve3(
    pointsM.map((p) => new Vector3(...p)),
    false,
    "centripetal",
  );
  const outer = new TubeGeometry(curve, 20, boreRadiusM + wallM, 16, false);
  const inner = new TubeGeometry(curve, 20, boreRadiusM, 16, false);
  const index = inner.index!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    index.setX(i, index.getX(i + 2));
    index.setX(i + 2, a);
  }
  const n = inner.getAttribute("normal");
  for (let i = 0; i < n.count; i += 1) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return joinGeometry([outer, inner]);
}

/** Carries a Y-axis fitting to a socket's actual outward direction and position. */
export function atInterface(
  g: BufferGeometry,
  position: PointM,
  direction: PointM,
): BufferGeometry {
  const q = new Quaternion().setFromUnitVectors(UP, new Vector3(...direction).normalize());
  return g.applyMatrix4(new Matrix4().compose(new Vector3(...position), q, new Vector3(1, 1, 1)));
}
