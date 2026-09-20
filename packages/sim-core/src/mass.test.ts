import { describe, expect, it } from "vitest";
import { MaterialIds, getMaterial } from "@forgelab/materials";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { makeWorld, place, placeBlock } from "@forgelab/test-utils";
import {
  boxGeometry,
  componentCenterOfMassM,
  computeAssemblyMassProperties,
  cylinderGeometry,
  geometryVolumeM3,
  loadBearingAreaM2,
  resolveMassKg,
} from "./index.js";

describe("geometry and mass", () => {
  it("computes solid and shell volumes from closed-form expressions", () => {
    expect(geometryVolumeM3(boxGeometry(vec3(2, 3, 4)))).toBeCloseTo(24, 12);

    // Box shell: outer minus the void it encloses.
    const shell = boxGeometry(vec3(2, 2, 2), 0.1);
    expect(geometryVolumeM3(shell)).toBeCloseTo(8 - 1.8 ** 3, 12);

    expect(geometryVolumeM3(cylinderGeometry(2, 5))).toBeCloseTo(Math.PI * 4 * 5, 12);

    // Capped tube: pi*r^2*h - pi*(r-t)^2*(h-2t).
    const tube = cylinderGeometry(1.5, 3, "y", 0.05);
    expect(geometryVolumeM3(tube)).toBeCloseTo(
      Math.PI * 1.5 ** 2 * 3 - Math.PI * 1.45 ** 2 * 2.9,
      12,
    );
  });

  it("treats a wall thicker than the part as solid rather than producing negative volume", () => {
    expect(geometryVolumeM3(boxGeometry(vec3(1, 1, 1), 5))).toBeCloseTo(1, 12);
    expect(geometryVolumeM3(cylinderGeometry(1, 1, "y", 5))).toBeCloseTo(Math.PI, 12);
  });

  it("derives mass from volume times material density", () => {
    const geometry = boxGeometry(vec3(2, 1, 0.5));
    const steel = getMaterial(MaterialIds.StructuralSteel);
    expect(resolveMassKg(geometry, MaterialIds.StructuralSteel)).toBeCloseTo(
      1 * steel.densityKgM3,
      9,
    );
  });

  it("adds declared contents on top of the geometry-derived mass", () => {
    const geometry = boxGeometry(vec3(1, 1, 1));
    const bare = resolveMassKg(geometry, MaterialIds.StructuralSteel);
    expect(resolveMassKg(geometry, MaterialIds.StructuralSteel, 250)).toBeCloseTo(bare + 250, 9);
  });

  it("refuses an unknown material instead of guessing a density", () => {
    expect(() => resolveMassKg(boxGeometry(vec3(1, 1, 1)), "unobtainium")).toThrowError(
      /Unknown material id/,
    );
  });

  // REQUIRED TEST 6
  it("changes calculated mass when the material changes and the geometry does not", () => {
    const world = makeWorld();
    const block = placeBlock(world, {
      id: "block",
      positionM: vec3(0, 0.5, 0),
      sizeM: vec3(1, 1, 1),
      materialId: MaterialIds.StructuralSteel,
    });
    const steelMassKg = block.massKg;
    expect(steelMassKg).toBeCloseTo(7850, 9);

    const geometryBefore = block.geometry;
    const switched = world.setMaterial("block", MaterialIds.Aluminum);

    expect(switched.geometry).toBe(geometryBefore);
    expect(switched.massKg).toBeCloseTo(2700, 9);
    expect(switched.massKg).not.toBeCloseTo(steelMassKg, 3);

    // The mass ratio is exactly the density ratio, because nothing else changed.
    const steel = getMaterial(MaterialIds.StructuralSteel);
    const aluminum = getMaterial(MaterialIds.Aluminum);
    expect(switched.massKg / steelMassKg).toBeCloseTo(aluminum.densityKgM3 / steel.densityKgM3, 12);

    // ...and the change propagates into weight and stress.
    world.solve();
    expect(world.requireComponent("block").state.support.ownWeightN).toBeCloseTo(2700 * 9.80665, 6);
  });

  it("changes every catalogue component's mass with its material", () => {
    for (const type of [
      "structural-beam",
      "structural-platform",
      "reactor-chamber",
      "equipment-block",
    ]) {
      const world = makeWorld();
      const steel = place(world, type, { id: "part", materialId: MaterialIds.StructuralSteel });
      const steelMassKg = steel.massKg;
      const tungsten = world.setMaterial("part", MaterialIds.Tungsten);
      expect(tungsten.massKg).toBeGreaterThan(steelMassKg);
      expect(tungsten.massKg / steelMassKg).toBeCloseTo(19250 / 7850, 9);
    }
  });

  it("reports the material section that carries the load, not the bounding footprint", () => {
    // 150 x 150 x 8 mm square hollow section, loaded along its length.
    const shs = boxGeometry(vec3(4, 0.15, 0.15), 0.008);
    const upright = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
    expect(loadBearingAreaM2(shs, upright)).toBeCloseTo(0.15 ** 2 - 0.134 ** 2, 12);

    // A capped tube loaded along its axis resists on its annulus, not its bore.
    const tube = cylinderGeometry(1.5, 3, "y", 0.05);
    expect(loadBearingAreaM2(tube, QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0))).toBeCloseTo(
      Math.PI * (1.5 ** 2 - 1.45 ** 2),
      12,
    );
  });
});

describe("centre of mass", () => {
  it("places a single symmetric component's centre of mass at its own origin", () => {
    const world = makeWorld();
    placeBlock(world, { id: "block", positionM: vec3(2, 3, -4) });
    expect(componentCenterOfMassM(world.requireComponent("block"))).toEqual(vec3(2, 3, -4));
  });

  // REQUIRED TEST 7
  it("computes the assembly centre of mass as the mass-weighted mean", () => {
    const world = makeWorld();
    // 1 m steel cube (7850 kg) at x = 0, and a 1 m tungsten cube (19250 kg) at x = 10.
    placeBlock(world, {
      id: "a",
      positionM: vec3(0, 0.5, 0),
      materialId: MaterialIds.StructuralSteel,
    });
    placeBlock(world, { id: "b", positionM: vec3(10, 0.5, 0), materialId: MaterialIds.Tungsten });

    const properties = computeAssemblyMassProperties(world.listComponents());
    const expectedTotal = 7850 + 19250;
    const expectedX = (7850 * 0 + 19250 * 10) / expectedTotal;

    expect(properties.componentCount).toBe(2);
    expect(properties.totalMassKg).toBeCloseTo(expectedTotal, 9);
    expect(properties.centerOfMassM.x).toBeCloseTo(expectedX, 12);
    expect(properties.centerOfMassM.y).toBeCloseTo(0.5, 12);
    expect(properties.centerOfMassM.z).toBeCloseTo(0, 12);
  });

  it("puts the centre of mass exactly between two identical components", () => {
    const world = makeWorld();
    placeBlock(world, { id: "a", positionM: vec3(-3, 2, 5) });
    placeBlock(world, { id: "b", positionM: vec3(3, 6, -1) });
    const { centerOfMassM } = computeAssemblyMassProperties(world.listComponents());
    expect(centerOfMassM.x).toBeCloseTo(0, 12);
    expect(centerOfMassM.y).toBeCloseTo(4, 12);
    expect(centerOfMassM.z).toBeCloseTo(2, 12);
  });

  it("tracks the centre of mass as components fall", () => {
    const world = makeWorld();
    placeBlock(world, { id: "falling", positionM: vec3(0, 50, 0) });
    const before = world.getSnapshot().assembly.centerOfMassM.y;
    world.stepMany(60);
    const after = world.getSnapshot().assembly.centerOfMassM.y;
    expect(after).toBeLessThan(before);
  });

  it("returns zero mass at the origin for an empty assembly", () => {
    const properties = computeAssemblyMassProperties([]);
    expect(properties.totalMassKg).toBe(0);
    expect(properties.centerOfMassM).toEqual(vec3(0, 0, 0));
  });

  it("shifts the centre of mass toward declared contents", () => {
    const world = makeWorld();
    place(world, "equipment-block", { id: "light", positionM: vec3(-5, 0.5, 0) });
    place(world, "equipment-block", {
      id: "heavy",
      positionM: vec3(5, 0.5, 0),
      additionalMassKg: 20_000,
    });
    const { centerOfMassM } = computeAssemblyMassProperties(world.listComponents());
    expect(centerOfMassM.x).toBeGreaterThan(3);
  });

  it("keeps the centre of mass invariant under a rigid translation of the assembly", () => {
    const build = (offsetX: number) => {
      const world = makeWorld();
      placeBlock(world, { id: "a", positionM: vec3(offsetX - 2, 0.5, 0) });
      placeBlock(world, {
        id: "b",
        positionM: vec3(offsetX + 2, 0.5, 0),
        materialId: MaterialIds.Copper,
      });
      return computeAssemblyMassProperties(world.listComponents()).centerOfMassM.x;
    };
    expect(build(10) - build(0)).toBeCloseTo(10, 12);
  });

  it("accounts for rotation when a component's origin is offset from the world origin", () => {
    const world = makeWorld();
    const rotated = transform(vec3(4, 1, 0), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0.9));
    place(world, "structural-beam", { id: "beam", transform: rotated });
    // The beam is symmetric, so rotating it about its own origin cannot move its centre.
    expect(componentCenterOfMassM(world.requireComponent("beam"))).toEqual(vec3(4, 1, 0));
  });
});
