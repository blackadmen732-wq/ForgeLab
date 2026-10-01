import { describe, expect, it } from "vitest";
import { Vec3Math } from "@forgelab/shared";
import {
  arcFrame,
  arcGeometry,
  arcPoint,
  arcTangent,
  geometryInteriorSurfaceM2,
  geometryInteriorVolumeM3,
  geometryLocalHalfExtentsM,
  geometryOuterSurfaceM2,
  geometryVolumeM3,
  torusGeometry,
} from "./index.js";

describe("arc geometry (a bent tube)", () => {
  const R = 4;
  const a = 0.8;
  const t = 0.05;

  it("rejects sweeps outside (0, π] and tubes fatter than the bend", () => {
    expect(() => arcGeometry(R, 0, a)).toThrow(RangeError);
    expect(() => arcGeometry(R, Math.PI * 1.2, a)).toThrow(RangeError);
    expect(() => arcGeometry(1, 0.5, 1.2)).toThrow(RangeError);
  });

  it("has a right-handed frame with the centreline midpoint at the origin", () => {
    for (const axis of ["x", "y", "z"] as const) {
      const g = arcGeometry(R, Math.PI / 3, a, axis);
      const f = arcFrame(g);
      const cross = Vec3Math.cross(f.radial, f.tangent);
      expect(Vec3Math.distance(cross, f.axis)).toBeLessThan(1e-12);
      expect(Vec3Math.length(arcPoint(g, 0))).toBeLessThan(1e-12);
      expect(Vec3Math.distance(arcTangent(g, 0), f.tangent)).toBeLessThan(1e-12);
      // Every centreline point is bendRadius from the centre of curvature.
      for (const s of [-Math.PI / 6, -0.2, 0.4, Math.PI / 6])
        expect(Vec3Math.distance(arcPoint(g, s), f.centre)).toBeCloseTo(R, 12);
    }
  });

  it("has the swept fraction of the full torus's volumes and areas (Pappus)", () => {
    const n = 12;
    const sector = arcGeometry(R, (2 * Math.PI) / n, a, "y", t);
    const torus = torusGeometry(R, a, "y", t);
    expect(n * geometryVolumeM3(sector)).toBeCloseTo(geometryVolumeM3(torus), 9);
    expect(n * geometryInteriorVolumeM3(sector)).toBeCloseTo(geometryInteriorVolumeM3(torus), 9);
    expect(n * geometryInteriorSurfaceM2(sector)).toBeCloseTo(geometryInteriorSurfaceM2(torus), 9);
    expect(n * geometryOuterSurfaceM2(sector)).toBeCloseTo(geometryOuterSurfaceM2(torus), 9);
  });

  it("bounds the whole tube in a box symmetric about its origin", () => {
    const g = arcGeometry(R, Math.PI / 2, a, "y");
    const h = geometryLocalHalfExtentsM(g);
    const f = arcFrame(g);
    for (let k = 0; k <= 16; k += 1) {
      const s = -Math.PI / 4 + (k / 16) * (Math.PI / 2);
      const p = arcPoint(g, s);
      expect(Math.abs(p.x) + a).toBeLessThanOrEqual(h.x + 1e-9);
      expect(Math.abs(p.y) + a).toBeLessThanOrEqual(h.y + 1e-9);
      expect(Math.abs(p.z) + a).toBeLessThanOrEqual(h.z + 1e-9);
    }
    expect(Math.abs(Vec3Math.dot(f.axis, h))).toBeCloseTo(a, 12);
  });
});
