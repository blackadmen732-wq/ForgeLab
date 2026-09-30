import { describe, expect, it } from "vitest";
import { SimulationWorld, failureKey, serializeWorld } from "@forgelab/sim-core";
import { buildReferencePlant, buildScenario } from "@forgelab/reactor-components";
import { SimulationSession, type SessionFrame } from "@forgelab/sim-runner";
import { ActivationTracker, currentStage, type StageProgress } from "./activation.js";
import { destructionEvent, type DestructionEvent } from "./destruction.js";
import { alarmTier, facilityState, type RaisedFailure } from "./facility.js";
import { readingFromFrame, type PlantReading } from "./reading.js";
import { RunRecorder } from "./replay.js";
import { DEFAULT_SETTINGS, TIER_BUDGETS, parseSettings } from "./settings.js";

/**
 * Drives the real simulation session headlessly and runs the presentation derivations on
 * every frame, exactly as the director does in the browser.
 */
function run(world: SimulationWorld, seconds: number, until?: (d: DestructionEvent[]) => boolean) {
  const session = new SimulationSession(() => 0);
  session.handle({ type: "load", runId: 1, file: serializeWorld(world) });
  const components = world.getSnapshot().components;
  const tracker = new ActivationTracker();
  const recorder = new RunRecorder();
  const destructions: DestructionEvent[] = [];
  const failures: RaisedFailure[] = [];
  let previous: PlantReading | null = null;
  let reading: PlantReading | null = null;
  let stages: StageProgress[] = [];
  for (let s = 0; s < seconds * 2; s += 1) {
    const frame = session.handle({ type: "step", count: 30 })[0] as SessionFrame;
    reading = readingFromFrame(frame, components);
    stages = tracker.update(reading);
    const fresh = frame.newFailures.map((f) => destructionEvent(f, reading!, previous));
    for (const d of fresh) {
      destructions.push(d);
      failures.push({ timeSec: d.simulationTime, family: d.family, severity: d.severity });
    }
    recorder.record(frame, fresh);
    previous = reading;
    if (until?.(destructions)) break;
  }
  const facility = facilityState({ mode: "simulate", reading, stages, failures });
  return { reading: reading!, stages, destructions, facility, recorder };
}

const plant = (overrides?: Record<string, Record<string, unknown>>) => {
  const world = new SimulationWorld({ name: "ref" });
  buildReferencePlant(world, overrides === undefined ? {} : { parameterOverrides: overrides });
  return world;
};

describe("activation stages follow the physics", () => {
  it("the reference plant passes every stage to fusion", { timeout: 60000 }, () => {
    const { stages, facility } = run(plant(), 40);
    const status = Object.fromEntries(stages.map((s) => [s.id, s.status]));
    expect(status).toEqual({
      electrical: "done",
      cooling: "done",
      cryogenics: "done",
      vacuum: "done",
      magnets: "done",
      fuel: "done",
      ignition: "done",
      fusion: "done",
    });
    // Reached in order.
    const times = stages.map((s) => s.reachedAtSec!);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(facility).toBe("RUNNING");
    expect(alarmTier(facility)).toBe("NONE");
  });

  it("stalls at electrical on a starved grid and says why", { timeout: 60000 }, () => {
    const { stages, destructions, facility } = run(plant({ grid: { maxPowerW: 5e6 } }), 20);
    const stage = currentStage(stages)!;
    expect(stage.id).toBe("electrical");
    expect(stage.status).toBe("stalled");
    expect(stage.detail).toMatch(/Network supplies \d+ %/);
    expect(destructions.some((d) => d.family === "brownout")).toBe(true);
    expect(["POST_FAILURE", "EMERGENCY", "POWER_LOSS"]).toContain(facility);
  });

  it("does not claim fusion for a vessel with no fuel injector", { timeout: 60000 }, () => {
    const world = new SimulationWorld({ name: "no fuel" });
    buildReferencePlant(world, { omit: ["injector"] });
    const { stages } = run(world, 20);
    const stage = currentStage(stages)!;
    expect(stage.id).toBe("fuel");
    expect(stages.find((s) => s.id === "fusion")!.status).toBe("pending");
  });
});

describe("destruction events mirror raised failures", () => {
  it(
    "a quench and the disruption it causes are distinct families, chained",
    { timeout: 120000 },
    () => {
      const { destructions, recorder } = run(buildScenario("magnet-quench"), 120, (d) =>
        d.some((e) => e.family === "disruption"),
      );
      const quench = destructions.find((d) => d.family === "quench")!;
      const disruption = destructions.find((d) => d.family === "disruption")!;
      expect(quench.componentId).toBe("tf-coils");
      expect(quench.estimatedEnergy).toBeGreaterThan(1e9); // ~5 T over a large coil volume
      expect(quench.severity).toBeGreaterThan(0.45);
      expect(disruption.componentId).toBe("vessel");
      expect(disruption.causalFailureId).toBe(quench.eventId);
      expect(disruption.affectedComponentIds).toContain("tf-coils");
      expect(recorder.rootDestruction()!.eventId).toBe(quench.eventId);
      // Only failures the simulation raised become destruction events.
      for (const d of destructions) expect(d.eventId).toBe(failureKey(d));
    },
  );

  it("an undersized bus burns out as an electrical fault", { timeout: 120000 }, () => {
    const { destructions } = run(buildScenario("electrical-bus-fault"), 60, (d) =>
      d.some((e) => e.family === "electrical"),
    );
    const fault = destructions.find((d) => d.family === "electrical")!;
    expect(fault.componentId).toBe("bus");
    expect(fault.combustible).toBe(true);
  });
});

describe("facility state", () => {
  const empty = { mode: "simulate" as const, reading: null, stages: [], failures: [] };
  it("is BUILD in build mode and READY before the first frame", () => {
    expect(facilityState({ ...empty, mode: "build" })).toBe("BUILD");
    expect(facilityState(empty)).toBe("READY");
  });
});

describe("presentation settings", () => {
  it("falls back to defaults for anything malformed", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const parsed = parseSettings({ quality: "INSANE", cameraEffectsIntensity: 7, muted: "yes" });
    expect(parsed.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(parsed.cameraEffectsIntensity).toBe(1);
    expect(parsed.muted).toBe(false);
  });

  it("tiers change drawing budgets only", () => {
    for (const budget of Object.values(TIER_BUDGETS))
      expect(Object.keys(budget).sort()).toEqual([
        "bloom",
        "debrisRigid",
        "debrisSimple",
        "haze",
        "lightPools",
        "particles",
        "pixelRatio",
        "props",
        "shadowMapSize",
      ]);
  });
});
