import { describe, expect, it } from "vitest";
import { serializeWorld } from "@forgelab/sim-core";
import { buildScenario } from "@forgelab/reactor-components";
import { createReplay, parseReplay, reproduceReplay } from "./index.js";

/** Runs the bus-fault scenario until its first failure, as a player's run would. */
function failingRun() {
  const world = buildScenario("electrical-bus-fault");
  const design = serializeWorld(world);
  world.reset();
  while (world.failureCount === 0 && world.simulatedTimeSec < 120) world.step();
  return { design, failures: world.getSnapshot().failures, timeSec: world.simulatedTimeSec };
}

describe("replay files", () => {
  it("re-simulate to the same root failure at the same tick", { timeout: 60000 }, () => {
    const run = failingRun();
    expect(run.failures.length).toBeGreaterThan(0);
    const replay = createReplay({
      title: "Bus fault",
      design: run.design,
      failures: run.failures,
      durationSec: run.timeSec,
      createdAtIso: "2026-10-11T00:00:00Z",
    });
    const opened = parseReplay(JSON.parse(JSON.stringify(replay)));
    expect(opened.failures[0]!.componentId).toBe("bus");
    const result = reproduceReplay(opened);
    expect(result.sameEngine).toBe(true);
    expect(result.reproduced).toBe(true);
    expect(result.actual!.timestampSec).toBeCloseTo(run.failures[0]!.timestampSec, 9);
  });

  it(
    "refuses a tampered design or a claimed failure that does not happen",
    { timeout: 60000 },
    () => {
      const run = failingRun();
      const replay = createReplay({
        title: "x",
        design: run.design,
        failures: run.failures,
        durationSec: run.timeSec,
        createdAtIso: "",
      });
      const tampered = {
        ...replay,
        design: { ...replay.design, name: "renamed is fine" },
      };
      expect(() => parseReplay(tampered)).not.toThrow(); // the name is not part of the hash
      const moved = JSON.parse(JSON.stringify(replay));
      moved.design.components[0].transform.positionM.x += 1;
      expect(() => parseReplay(moved)).toThrow(/fingerprint/);
      expect(() => parseReplay({ kind: "something-else" })).toThrow(/Not a ForgeLab replay/);

      const lie = parseReplay({
        ...replay,
        failures: [{ ...replay.failures[0]!, componentId: "vessel" }],
      });
      expect(reproduceReplay(lie).reproduced).toBe(false);
    },
  );
});
