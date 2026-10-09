import { describe, expect, it } from "vitest";
import { SHOWROOM_SCENARIOS, buildScenario } from "./scenarios.js";

/**
 * The showroom's fault scenarios are ordinary designs. These tests pin down that the
 * simulation — not a script — raises the failure each one is meant to demonstrate.
 */
describe("showroom fault scenarios", () => {
  for (const scenario of SHOWROOM_SCENARIOS) {
    it(`${scenario.name}: ${scenario.expectedFailureType}`, { timeout: 60000 }, () => {
      const world = buildScenario(scenario.id);
      let t = 0;
      const raised = () =>
        world.getSnapshot().failures.some((f) => f.failureType === scenario.expectedFailureType);
      while (t < scenario.withinSec && !raised()) {
        world.stepMany(60);
        t += 1;
      }
      expect(raised()).toBe(true);
    });
  }

  it("the cascade is one causal chain from the switched-off pump", { timeout: 60000 }, () => {
    const world = buildScenario("cascade");
    for (let t = 0; t < 400; t += 1) {
      world.stepMany(60);
      if (world.getSnapshot().failures.some((f) => f.failureType === "disruption")) break;
    }
    const disruption = world.getSnapshot().failures.find((f) => f.failureType === "disruption")!;
    expect(disruption.causalChain!.map((l) => l.failureType)).toEqual([
      "loss_of_flow",
      "over_temperature",
      "disruption",
    ]);
  });

  it(
    "the coolant scene ends with the pump cavitating and the flow collapsing",
    { timeout: 60000 },
    () => {
      const world = buildScenario("coolant-boiling");
      for (let t = 0; t < 700; t += 1) {
        world.stepMany(60);
        if (world.getSnapshot().failures.some((f) => f.failureType === "loss_of_flow")) break;
      }
      const lost = world.getSnapshot().failures.find((f) => f.failureType === "loss_of_flow")!;
      expect(lost.causalChain!.map((l) => l.failureType)).toEqual([
        "coolant_boiling",
        "pump_cavitation",
        "loss_of_flow",
      ]);
    },
  );

  it("the ruptured hot leg opens its loop", () => {
    const world = buildScenario("pipe-rupture");
    world.stepMany(120);
    const snapshot = world.getSnapshot();
    expect(snapshot.failures.find((f) => f.failureType === "pipe_rupture")?.componentId).toBe(
      "pipe-hot",
    );
    expect(snapshot.plant.loops.find((l) => l.componentIds.includes("pipe-hot"))!.closed).toBe(
      false,
    );
  });

  it("every scenario is a distinct design", () => {
    const ids = SHOWROOM_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
  });
});
