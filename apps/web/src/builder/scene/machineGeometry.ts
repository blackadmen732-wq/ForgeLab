import { BoxGeometry, type BufferGeometry, CylinderGeometry, TorusGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type ComponentGeometry, geometryLocalHalfExtentsM } from "@forgelab/sim-core";

export type V = readonly [number, number, number];

export function box(sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): BufferGeometry {
  return new BoxGeometry(Math.max(sx, 1e-3), Math.max(sy, 1e-3), Math.max(sz, 1e-3)).translate(
    x,
    y,
    z,
  );
}

/** Cylinder of radius r and length l along `axis`, centred at c. */
export function cyl(
  r: number,
  l: number,
  axis: "x" | "y" | "z",
  c: V = [0, 0, 0],
  segments = 24,
  r2 = r,
): BufferGeometry {
  const g = new CylinderGeometry(r2, r, Math.max(l, 1e-3), segments);
  if (axis === "x") g.rotateZ(-Math.PI / 2);
  if (axis === "z") g.rotateX(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

export function ring(
  R: number,
  tube: number,
  axis: "x" | "y" | "z",
  c: V = [0, 0, 0],
): BufferGeometry {
  const g = new TorusGeometry(R, tube, 6, 32);
  if (axis === "y") g.rotateX(Math.PI / 2);
  if (axis === "x") g.rotateY(Math.PI / 2);
  return g.translate(c[0], c[1], c[2]);
}

export function merge(parts: BufferGeometry[]): BufferGeometry | null {
  const indexed = parts.map((p) => (p.index === null ? p : p.toNonIndexed()));
  const merged = indexed.length === 0 ? null : mergeGeometries(indexed, false);
  for (const p of [...parts, ...indexed]) p.dispose();
  return merged;
}

export function halfExtents(g: ComponentGeometry): V {
  switch (g.kind) {
    case "box":
      return [g.sizeM.x / 2, g.sizeM.y / 2, g.sizeM.z / 2];
    case "cylinder": {
      const r = g.radiusM;
      const h = g.heightM / 2;
      return g.axis === "x" ? [h, r, r] : g.axis === "z" ? [r, r, h] : [r, h, r];
    }
    case "torus": {
      const R = g.majorRadiusM + g.minorRadiusM;
      const a = g.minorRadiusM;
      return g.axis === "x" ? [a, R, R] : g.axis === "z" ? [R, R, a] : [R, a, R];
    }
    case "arc": {
      const h = geometryLocalHalfExtentsM(g);
      return [h.x, h.y, h.z];
    }
  }
}
