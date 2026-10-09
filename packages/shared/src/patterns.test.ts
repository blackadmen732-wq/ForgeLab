import { describe, expect, it } from "vitest";
import { linearCopies, mirrorCopies, radialCopies } from "./patterns.js";
import { fromAxisAngle, rotateVec3 } from "./quaternion.js";
import { transform } from "./transform.js";
import { vec3, type Vec3 } from "./vec3.js";

const near = (a: Vec3, b: Vec3) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
  expect(a.z).toBeCloseTo(b.z, 9);
};

describe("pattern tools", () => {
  it("rings 18 coils evenly round an axis, each turned to face the centre", () => {
    const coil = transform(vec3(8, 4, 0), fromAxisAngle(vec3(0, 1, 0), 0));
    const copies = radialCopies([coil], { origin: vec3(0, 4, 0), axis: vec3(0, 1, 0), count: 18 });
    expect(copies).toHaveLength(17);
    const step = (2 * Math.PI) / 18;
    copies.forEach(([t], k) => {
      const a = step * (k + 1);
      near(t!.positionM, vec3(8 * Math.cos(a), 4, -8 * Math.sin(a)));
      // The coil's local +X (which pointed outwards) still points outwards.
      const out = rotateVec3(t!.rotation, vec3(1, 0, 0));
      near(out, vec3(Math.cos(a), 0, -Math.sin(a)));
    });
  });

  it("spans a partial arc from first to last instance", () => {
    const copies = radialCopies([transform(vec3(1, 0, 0))], {
      origin: vec3(0, 0, 0),
      axis: vec3(0, 0, 1),
      count: 3,
      spanRad: Math.PI,
    });
    near(copies[1]![0]!.positionM, vec3(-1, 0, 0));
  });

  it("keeps a multi-part selection's relative layout in every copy", () => {
    const items = [transform(vec3(5, 0, 0)), transform(vec3(6, 1, 0))];
    for (const copy of radialCopies(items, {
      origin: vec3(0, 0, 0),
      axis: vec3(0, 1, 0),
      count: 4,
    })) {
      const d = Math.hypot(
        copy[1]!.positionM.x - copy[0]!.positionM.x,
        copy[1]!.positionM.y - copy[0]!.positionM.y,
        copy[1]!.positionM.z - copy[0]!.positionM.z,
      );
      expect(d).toBeCloseTo(Math.SQRT2, 9);
    }
  });

  it("rows copies at a fixed step", () => {
    const copies = linearCopies([transform(vec3(0, 0, 0))], { step: vec3(2, 0, 1), count: 4 });
    expect(copies.map((c) => c[0]!.positionM.x)).toEqual([2, 4, 6]);
    expect(copies.map((c) => c[0]!.positionM.z)).toEqual([1, 2, 3]);
  });

  it("mirrors positions exactly and orientations onto the mirror image", () => {
    // A part turned 30° about Y, mirrored across the YZ plane, turns −30°.
    const t = transform(vec3(3, 1, 2), fromAxisAngle(vec3(0, 1, 0), Math.PI / 6));
    const [m] = mirrorCopies([t], { point: vec3(0, 0, 0), normal: vec3(1, 0, 0) });
    near(m!.positionM, vec3(-3, 1, 2));
    // Its local axes map to the reflected axes up to the part's own symmetry: the
    // reflected long axis (local +X) is the mirror of the original, up to sign.
    const before = rotateVec3(t.rotation, vec3(1, 0, 0));
    const after = rotateVec3(m!.rotation, vec3(1, 0, 0));
    expect(Math.abs(after.x)).toBeCloseTo(Math.abs(before.x), 9);
    expect(Math.abs(after.z)).toBeCloseTo(Math.abs(before.z), 9);
    expect(Math.sign(after.x * after.z)).toBe(-Math.sign(before.x * before.z));
    // A proper rotation: unit quaternion.
    const q = m!.rotation;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  });
});
