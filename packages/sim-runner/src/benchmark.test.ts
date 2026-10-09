import { describe, expect, it } from "vitest";
import { buildBenchmark, buildReferencePlant } from "@forgelab/reactor-components";
import { SimulationWorld, serializeWorld } from "@forgelab/sim-core";
import { SimulationSession, designHash } from "./index.js";

/**
 * Performance regression guards. Budgets are deliberately loose (CI machines vary); the
 * printed figures are what docs/PERFORMANCE.md records.
 */
function time<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

describe("performance", () => {
  it("builds, solves and steps the 384-part benchmark lattice", () => {
    const world = new SimulationWorld();
    const built = time(() => buildBenchmark(world, 8));
    expect(world.listComponents()).toHaveLength(384);
    const solve = time(() => {
      world.updateSettings({});
      world.solve();
    });
    const steps = 120;
    const step = time(() => world.stepMany(steps));
    const snapshot = time(() => world.getSnapshot());
    const file = serializeWorld(world);
    const hash = time(() => designHash(file));
    const perTick = step.ms / steps;
    console.log(
      `benchmark lattice (384 parts, ${world.listConnections().length} links): build ${built.ms.toFixed(0)} ms, ` +
        `re-solve ${solve.ms.toFixed(1)} ms, ${perTick.toFixed(2)} ms/tick, snapshot ${snapshot.ms.toFixed(1)} ms, hash ${hash.ms.toFixed(1)} ms`,
    );
    expect(perTick).toBeLessThan(16); // one 60 Hz tick must fit in a frame
    expect(solve.ms).toBeLessThan(500);
  });

  it("publishes worker frames for the benchmark quickly", () => {
    const world = new SimulationWorld();
    buildBenchmark(world, 8);
    const session = new SimulationSession(() => performance.now());
    session.handle({ type: "load", runId: 1, file: serializeWorld(world) });
    const frame = time(() => session.handle({ type: "step", count: 1 }));
    console.log(`benchmark frame build: ${frame.ms.toFixed(1)} ms`);
    expect(frame.ms).toBeLessThan(100);
  });

  it("steps the reference plant well inside real time", () => {
    const world = new SimulationWorld();
    buildReferencePlant(world);
    world.stepMany(60);
    const steps = 600;
    const step = time(() => world.stepMany(steps));
    const perTick = step.ms / steps;
    console.log(
      `reference plant (16 parts): ${perTick.toFixed(3)} ms/tick (${(1000 / 60 / perTick).toFixed(0)}× real time)`,
    );
    expect(perTick).toBeLessThan(5);
  });
});
