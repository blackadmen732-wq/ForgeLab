import { describe, expect, it } from "vitest";
import { MaterialIds } from "@forgelab/materials";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { fingerprintSnapshot, makeWorld, place, placeBlock, stack } from "@forgelab/test-utils";
import { SimulationLoop, type SimulationWorld } from "./index.js";

/**
 * A scenario with something of everything: parts on the ground, parts in the air, a load
 * chain, a rotated member, mixed materials, and a joint that is going to fail.
 */
function buildScenario(): SimulationWorld {
  const world = makeWorld();

  placeBlock(world, { id: "anchor", positionM: vec3(0, 0.5, 0), anchored: true });
  placeBlock(world, { id: "column", positionM: vec3(0, 1.5, 0), materialId: MaterialIds.Copper });
  stack(world, "anchor", "column", { id: "joint-ac", maxLoadN: 5_000 });

  placeBlock(world, { id: "faller-a", positionM: vec3(4, 40, 0) });
  placeBlock(world, {
    id: "faller-b",
    positionM: vec3(-4, 62.5, 3),
    materialId: MaterialIds.Tungsten,
  });

  place(world, "structural-beam", {
    id: "beam",
    transform: transform(vec3(9, 12, -2), QuaternionMath.fromAxisAngle(vec3(0, 0, 1), 0.6)),
  });
  place(world, "reactor-chamber", {
    id: "chamber",
    positionM: vec3(-12, 1.5, -6),
    additionalMassKg: 4_500,
  });
  place(world, "equipment-block", { id: "equipment", positionM: vec3(7, 0.5, 7) });

  return world;
}

describe("determinism", () => {
  // REQUIRED TEST 8
  it("produces identical results across repeated runs from identical initial conditions", () => {
    const runs = [0, 1, 2].map(() => {
      const world = buildScenario();
      world.stepMany(600);
      return fingerprintSnapshot(world.getSnapshot());
    });

    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    // Guard against a fingerprint that is accidentally trivial.
    expect(runs[0]!.length).toBeGreaterThan(500);
  });

  it("produces identical results whether stepped one at a time or in bulk", () => {
    const oneAtATime = buildScenario();
    for (let i = 0; i < 300; i += 1) oneAtATime.step();

    const inBulk = buildScenario();
    inBulk.stepMany(300);

    expect(fingerprintSnapshot(inBulk.getSnapshot())).toBe(
      fingerprintSnapshot(oneAtATime.getSnapshot()),
    );
  });

  it("returns to the identical starting state on reset, and re-runs identically", () => {
    const world = buildScenario();
    const atStart = fingerprintSnapshot(world.getSnapshot());

    world.stepMany(240);
    const afterFirstRun = fingerprintSnapshot(world.getSnapshot());
    expect(afterFirstRun).not.toBe(atStart);

    world.reset();
    expect(fingerprintSnapshot(world.getSnapshot())).toBe(atStart);

    world.stepMany(240);
    expect(fingerprintSnapshot(world.getSnapshot())).toBe(afterFirstRun);
  });

  it("does not depend on the order components were added in", () => {
    const forward = makeWorld();
    placeBlock(forward, { id: "a", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(forward, { id: "b", positionM: vec3(0, 1.5, 0) });
    placeBlock(forward, { id: "c", positionM: vec3(0, 2.5, 0) });
    stack(forward, "a", "b", { id: "j-ab" });
    stack(forward, "b", "c", { id: "j-bc" });
    forward.stepMany(120);

    const backward = makeWorld();
    placeBlock(backward, { id: "c", positionM: vec3(0, 2.5, 0) });
    placeBlock(backward, { id: "b", positionM: vec3(0, 1.5, 0) });
    placeBlock(backward, { id: "a", positionM: vec3(0, 0.5, 0), anchored: true });
    stack(backward, "b", "c", { id: "j-bc" });
    stack(backward, "a", "b", { id: "j-ab" });
    backward.stepMany(120);

    expect(fingerprintSnapshot(backward.getSnapshot())).toBe(
      fingerprintSnapshot(forward.getSnapshot()),
    );
  });

  it("generates ids without randomness", () => {
    const first = makeWorld();
    const second = makeWorld();
    for (let i = 0; i < 5; i += 1) {
      expect(second.nextId("part")).toBe(first.nextId("part"));
    }
  });
});

describe("fixed timestep and frame-rate independence", () => {
  // REQUIRED TEST 9
  it("produces identical results regardless of how the frames were paced", () => {
    // One second of simulated time, delivered three different ways.
    const steady = new SimulationLoop(buildScenario());
    for (let i = 0; i < 60; i += 1) steady.advance(1 / 60);

    // Wildly irregular frames. Dyadic fractions so the total is exactly one second.
    const jittery = new SimulationLoop(buildScenario());
    for (const sixtyFourths of [4, 1, 9, 2, 16, 3, 7, 5, 11, 6]) {
      jittery.advance(sixtyFourths / 64);
    }

    // A quarter of a second of real time at 4x speed is also one second of simulation.
    const fast = new SimulationLoop(buildScenario(), { speed: 4 });
    for (const sixtyFourths of [8, 4, 2, 1, 1]) {
      fast.advance(sixtyFourths / 64);
    }

    expect(steady.stepsExecuted).toBe(60);
    expect(jittery.stepsExecuted).toBe(60);
    expect(fast.stepsExecuted).toBe(60);

    const reference = fingerprintSnapshot(steady.world.getSnapshot());
    expect(fingerprintSnapshot(jittery.world.getSnapshot())).toBe(reference);
    expect(fingerprintSnapshot(fast.world.getSnapshot())).toBe(reference);
  });

  it("matches a directly stepped world exactly", () => {
    const direct = buildScenario();
    direct.stepMany(60);

    const looped = new SimulationLoop(buildScenario());
    for (let i = 0; i < 60; i += 1) looped.advance(1 / 60);

    expect(fingerprintSnapshot(looped.world.getSnapshot())).toBe(
      fingerprintSnapshot(direct.getSnapshot()),
    );
  });

  it("runs the same states at every supported playback speed", () => {
    const reference = buildScenario();
    reference.stepMany(120);
    const expected = fingerprintSnapshot(reference.getSnapshot());

    for (const speed of [1, 2, 5, 10]) {
      const loop = new SimulationLoop(buildScenario(), { speed });
      const realSeconds = 2 / speed;
      const frames = 40;
      for (let i = 0; i < frames; i += 1) loop.advance(realSeconds / frames);
      expect(loop.stepsExecuted).toBe(120);
      expect(fingerprintSnapshot(loop.world.getSnapshot())).toBe(expected);
    }
  });

  it("runs nothing at all while paused", () => {
    const loop = new SimulationLoop(buildScenario(), { speed: 0 });
    const before = fingerprintSnapshot(loop.world.getSnapshot());
    for (let i = 0; i < 100; i += 1) loop.advance(1 / 30);
    expect(loop.stepsExecuted).toBe(0);
    expect(loop.paused).toBe(true);
    expect(fingerprintSnapshot(loop.world.getSnapshot())).toBe(before);
  });

  it("never drifts across a long, irregular session", () => {
    const loop = new SimulationLoop(buildScenario());
    let simulatedSeconds = 0;
    // A deterministic pseudo-random-looking but exactly representable frame sequence.
    const pattern = [1 / 64, 1 / 32, 3 / 64, 1 / 16, 1 / 128, 5 / 64];
    for (let i = 0; i < 6000; i += 1) {
      const delta = pattern[i % pattern.length]!;
      simulatedSeconds += delta;
      loop.advance(delta);
    }
    const expectedSteps = Math.floor(simulatedSeconds * 60 + 1e-9);
    expect(loop.stepsExecuted).toBe(expectedSteps);
    expect(loop.world.tick).toBe(expectedSteps);
    expect(loop.droppedTimeSec).toBe(0);
  });

  it("falls behind rather than freezing when a frame demands more steps than the cap", () => {
    const loop = new SimulationLoop(buildScenario(), { maxStepsPerFrame: 10 });
    loop.advance(60); // A minute of simulated time arriving in one frame.
    expect(loop.stepsExecuted).toBe(10);
    expect(loop.droppedTimeSec).toBeCloseTo(60 - 10 / 60, 9);
  });

  it("changes nothing physical when the speed is changed mid-run", () => {
    const reference = buildScenario();
    reference.stepMany(120);

    const switched = new SimulationLoop(buildScenario(), { speed: 1 });
    for (let i = 0; i < 60; i += 1) switched.advance(1 / 60);
    switched.speed = 10;
    for (let i = 0; i < 60; i += 1) switched.advance(1 / 600);

    expect(switched.stepsExecuted).toBe(120);
    expect(fingerprintSnapshot(switched.world.getSnapshot())).toBe(
      fingerprintSnapshot(reference.getSnapshot()),
    );
  });

  it("rejects a negative speed instead of running time backwards", () => {
    const loop = new SimulationLoop(makeWorld());
    expect(() => {
      loop.speed = -1;
    }).toThrowError(/non-negative/);
  });
});

describe("generated ids", () => {
  it("never collide with ids an editor chose itself, and stay deterministic", () => {
    const make = () => {
      const world = makeWorld();
      placeBlock(world, { id: "block-1", positionM: vec3(0, 0.5, 0) });
      placeBlock(world, { id: "block-2", positionM: vec3(2, 0.5, 0) });
      return [world.duplicateComponent("block-1").id, world.duplicateComponent("block-1").id];
    };
    const ids = make();
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain("block-1");
    expect(ids).not.toContain("block-2");
    expect(make()).toEqual(ids);
  });
});
