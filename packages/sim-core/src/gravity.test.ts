import { describe, expect, it } from "vitest";
import { STANDARD_GRAVITY_MPS2, vec3 } from "@forgelab/shared";
import { makeWorld, placeBlock } from "@forgelab/test-utils";
import { gravitationalForceN, gravitationalForceVectorN } from "./index.js";

describe("gravity", () => {
  // REQUIRED TEST 1
  it("produces 9806.65 N of weight for a 1000 kg mass on Earth", () => {
    expect(gravitationalForceN(1000, STANDARD_GRAVITY_MPS2)).toBeCloseTo(9806.65, 9);
  });

  it("acts straight down and scales linearly with mass", () => {
    const force = gravitationalForceVectorN(2500, STANDARD_GRAVITY_MPS2);
    expect(force.x).toBe(0);
    expect(force.z).toBe(0);
    expect(force.y).toBeCloseTo(-24516.625, 9);
  });

  it("reports a component's own weight as m * g", () => {
    const world = makeWorld();
    // 1 m cube of structural steel: 1 m^3 * 7850 kg/m^3.
    const block = placeBlock(world, { id: "block", positionM: vec3(0, 50, 0) });
    world.solve();

    const solved = world.requireComponent(block.id);
    expect(solved.massKg).toBeCloseTo(7850, 9);
    expect(solved.state.support.ownWeightN).toBeCloseTo(7850 * STANDARD_GRAVITY_MPS2, 6);
  });

  // REQUIRED TEST 2
  it("accelerates an unsupported object downward", () => {
    const world = makeWorld();
    placeBlock(world, { id: "block", positionM: vec3(0, 100, 0) });
    world.solve();
    expect(world.requireComponent("block").state.support.mode).toBe("free");

    const dt = world.settings.fixedTimestepSec;
    const steps = 60;
    world.stepMany(steps);

    const physical = world.requireComponent("block").state.physical;

    // Semi-implicit Euler is exact for constant acceleration in velocity:
    //   v(n) = -g * n * dt
    expect(physical.linearVelocityMps.y).toBeCloseTo(-STANDARD_GRAVITY_MPS2 * steps * dt, 9);
    expect(physical.linearVelocityMps.x).toBe(0);
    expect(physical.linearVelocityMps.z).toBe(0);

    // ...and its position follows the exact discrete sum, not the continuous integral:
    //   y(n) = y0 - g * dt^2 * n(n+1)/2
    const expectedY = 100 - STANDARD_GRAVITY_MPS2 * dt * dt * ((steps * (steps + 1)) / 2);
    expect(physical.positionM.y).toBeCloseTo(expectedY, 9);
    expect(physical.positionM.y).toBeLessThan(100);

    // The integrator's known bias against the analytic solution stays under 2% after 1 s.
    const analyticY = 100 - 0.5 * STANDARD_GRAVITY_MPS2 * (steps * dt) ** 2;
    expect(Math.abs(physical.positionM.y - analyticY)).toBeLessThan(0.02 * (100 - analyticY));
  });

  it("holds everything still when gravity is switched off", () => {
    const world = makeWorld({ gravityMps2: 0 });
    placeBlock(world, { id: "block", positionM: vec3(0, 100, 0) });
    world.stepMany(120);

    const physical = world.requireComponent("block").state.physical;
    expect(physical.positionM).toEqual(vec3(0, 100, 0));
    expect(physical.linearVelocityMps).toEqual(vec3(0, 0, 0));
    expect(world.requireComponent("block").state.support.ownWeightN).toBe(0);
  });

  it("stops a falling object at the ground plane rather than through it", () => {
    const world = makeWorld();
    placeBlock(world, { id: "block", positionM: vec3(0, 5, 0), sizeM: vec3(1, 1, 1) });
    world.stepMany(300);

    const physical = world.requireComponent("block").state.physical;
    // A 1 m cube rests with its centre half a metre above the ground plane.
    expect(physical.positionM.y).toBeCloseTo(0.5, 6);
    expect(world.requireComponent("block").state.support.mode).toBe("grounded");
  });

  // REQUIRED TEST 3
  it("leaves a supported stationary object exactly where it is", () => {
    const world = makeWorld();
    placeBlock(world, { id: "anchor", positionM: vec3(0, 20, 0), anchored: true });
    placeBlock(world, { id: "resting", positionM: vec3(3, 0.5, 0) });
    world.solve();

    expect(world.requireComponent("anchor").state.support.mode).toBe("anchored");
    expect(world.requireComponent("resting").state.support.mode).toBe("grounded");

    world.stepMany(600);

    for (const [id, expected] of [
      ["anchor", vec3(0, 20, 0)],
      ["resting", vec3(3, 0.5, 0)],
    ] as const) {
      const physical = world.requireComponent(id).state.physical;
      expect(physical.positionM).toEqual(expected);
      expect(physical.linearVelocityMps).toEqual(vec3(0, 0, 0));
    }
  });
});
