import { describe, expect, it } from "vitest";
import {
  QuaternionMath,
  Vec3Math,
  DEFAULT_SNAP_SIZE_M,
  STANDARD_GRAVITY_MPS2,
  celsiusToKelvin,
  degreesToRadians,
  gramsPerCm3ToKgPerM3,
  localPointToWorld,
  megapascalsToPascals,
  microOhmCmToOhmMeters,
  safeRatio,
  snapVec3,
  transform,
  vec3,
  worldPointToLocal,
} from "./index.js";

describe("SI units", () => {
  it("uses the CGPM standard gravity value", () => {
    expect(STANDARD_GRAVITY_MPS2).toBe(9.80665);
  });

  it("converts datasheet units into SI", () => {
    expect(gramsPerCm3ToKgPerM3(7.85)).toBeCloseTo(7850, 9);
    expect(megapascalsToPascals(250)).toBe(250e6);
    expect(microOhmCmToOhmMeters(1.678)).toBeCloseTo(1.678e-8, 15);
    expect(celsiusToKelvin(0)).toBe(273.15);
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 12);
  });

  it("returns zero rather than NaN for a degenerate ratio", () => {
    expect(safeRatio(5, 0)).toBe(0);
    expect(safeRatio(5, 2)).toBe(2.5);
  });
});

describe("Vec3", () => {
  it("computes dot, cross and length", () => {
    expect(Vec3Math.dot(vec3(1, 2, 3), vec3(4, -5, 6))).toBe(12);
    expect(Vec3Math.cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(Vec3Math.length(vec3(3, 4, 0))).toBe(5);
  });

  it("normalizes the zero vector to zero instead of NaN", () => {
    expect(Vec3Math.normalize(vec3(0, 0, 0))).toEqual(vec3(0, 0, 0));
  });

  it("produces frozen vectors so simulation state cannot be mutated in place", () => {
    expect(Object.isFrozen(vec3(1, 2, 3))).toBe(true);
  });
});

describe("Quaternion", () => {
  it("rotates a vector 90 degrees about +Y", () => {
    const q = QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const rotated = QuaternionMath.rotateVec3(q, vec3(1, 0, 0));
    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(0, 12);
    expect(rotated.z).toBeCloseTo(-1, 12);
  });

  it("round-trips a vector through rotate and inverse-rotate", () => {
    const q = QuaternionMath.fromEulerYXZ(0.3, -1.1, 2.4);
    const v = vec3(1.5, -2.25, 0.75);
    const back = QuaternionMath.inverseRotateVec3(q, QuaternionMath.rotateVec3(q, v));
    expect(Vec3Math.equals(back, v, 1e-12)).toBe(true);
  });
});

describe("Transform", () => {
  it("round-trips a point between local and world space", () => {
    const t = transform(vec3(2, 3, -4), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0.7));
    const local = vec3(0.5, 1, 0.25);
    const back = worldPointToLocal(t, localPointToWorld(t, local));
    expect(Vec3Math.equals(back, local, 1e-12)).toBe(true);
  });
});

describe("Snapping", () => {
  it("snaps to the nearest grid multiple and is a no-op when disabled", () => {
    expect(snapVec3(vec3(0.3, 1.13, -0.4), DEFAULT_SNAP_SIZE_M)).toEqual(vec3(0.25, 1.25, -0.5));
    expect(snapVec3(vec3(0.3, 1.13, -0.4), 0)).toEqual(vec3(0.3, 1.13, -0.4));
  });
});
