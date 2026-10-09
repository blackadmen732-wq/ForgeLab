import { describe, expect, it } from "vitest";
import type { DestructionEvent } from "../destruction.js";
import type { ComponentReading } from "../reading.js";
import {
  conditionSounds,
  cueEnd,
  facilityActions,
  failureActions,
  failureScore,
  pickVoices,
  stageActions,
  type SoundCue,
} from "./rules.js";

const event = (
  family: DestructionEvent["family"],
  severity: number,
  over: Partial<DestructionEvent> = {},
): DestructionEvent => ({
  eventId: `x::${family}::`,
  simulationTime: 1,
  componentId: "x",
  siteComponentId: "x",
  worldPosition: [1, 2, 3],
  worldDirection: [0, 1, 0],
  failureType: family,
  family,
  severity,
  estimatedEnergy: 1e6,
  temperature: 300,
  pressure: null,
  electricalState: "none",
  structuralState: "intact",
  affectedComponentIds: [],
  radiusM: 1,
  summary: "",
  combustible: false,
  ...over,
});

describe("audio rules", () => {
  it("places a failure sound where the failure is, and ducks the hall for violent ones", () => {
    const disruption = failureActions(event("disruption", 1));
    expect(disruption[0]).toMatchObject({ kind: "failure", position: [1, 2, 3] });
    expect(disruption.find((a) => a.kind === "duck")).toMatchObject({ depthDb: -14 });
    // A relay click does not duck anything.
    expect(failureActions(event("control", 0)).some((a) => a.kind === "duck")).toBe(false);
  });

  it("changes the alarm only when the tier changes", () => {
    expect(facilityActions("EMERGENCY", "RUNNING")).toContainEqual({
      kind: "alarm",
      tier: "EMERGENCY",
    });
    expect(facilityActions("FAILURE", "EMERGENCY").some((a) => a.kind === "alarm")).toBe(false);
    expect(facilityActions("BUILD", "POST_FAILURE")).toContainEqual({ kind: "stop-all" });
  });

  it("chimes when a stage is reached and when one stalls", () => {
    const s = (status: "active" | "done" | "stalled") =>
      ({ id: "vacuum", label: "Vacuum", status, detail: "", reachedAtSec: null }) as const;
    expect(stageActions(s("done"), s("active"))).toEqual([{ kind: "stage", reached: true }]);
    expect(stageActions(s("stalled"), s("active"))).toEqual([{ kind: "stage", reached: false }]);
    expect(stageActions(s("done"), s("done"))).toEqual([]);
  });

  it("drops the least important one-shots when voices run out", () => {
    const picked = pickVoices(
      [
        { priority: 1, severity: 1, id: "relay" },
        { priority: 10, severity: 0.5, id: "disruption" },
        { priority: 7, severity: 0.9, id: "arc" },
      ],
      2,
    );
    expect(picked.map((p) => p.id)).toEqual(["disruption", "arc"]);
  });
});

describe("failure score", () => {
  const shape = (cues: readonly SoundCue[]) =>
    cues
      .map((c) => (c.type === "noise" ? `${c.type}:${c.color}:${c.filter}` : c.type))
      .sort()
      .join(",");
  const lasts = (cues: readonly SoundCue[]) => Math.max(...cues.map(cueEnd));

  it("sounds different for every violent family", () => {
    const families = ["electrical", "coolant", "quench", "disruption", "structural"] as const;
    const shapes = families.map((f) => shape(failureScore(event(f, 0.8))));
    expect(new Set(shapes).size).toBe(families.length);
  });

  it("is the same every time the same failure plays (a replay sounds like the original)", () => {
    const e = event("structural", 0.7);
    expect(failureScore(e)).toEqual(failureScore(e));
  });

  it("unfolds in stages: the breaker clears after the arc, the relief valve after the quench", () => {
    const arc = failureScore(event("electrical", 0.8));
    const breaker = arc.find((c) => c.type === "thud")!;
    const lastCrackle = Math.max(
      ...arc.filter((c) => c.type === "noise" && c.filter === "highpass").map((c) => c.at),
    );
    expect(breaker.at).toBeGreaterThan(lastCrackle);
    const quench = failureScore(event("quench", 0.8));
    expect(quench.some((c) => c.at === 0)).toBe(true);
    expect(quench.some((c) => c.at >= 0.4)).toBe(true);
  });

  it("whistles for a pinhole and roars for a break, longer for a bigger break", () => {
    const pin = failureScore(
      event("coolant", 0.2, { failureType: "pipe_rupture", pressure: 1.5e7 }),
    );
    const brk = failureScore(
      event("coolant", 0.9, { failureType: "pipe_rupture", pressure: 1.5e7 }),
    );
    expect(pin.some((c) => c.type === "noise" && c.filter === "bandpass" && c.q >= 8)).toBe(true);
    expect(brk.some((c) => c.type === "thud")).toBe(true);
    expect(pin.some((c) => c.type === "thud")).toBe(false);
  });

  it("crackles with fire only where insulation burns", () => {
    const quiet = failureScore(event("electrical", 0.8));
    const burning = failureScore(event("electrical", 0.8, { combustible: true }));
    expect(lasts(burning)).toBeGreaterThan(lasts(quiet) + 5);
    const ticking = failureScore(event("thermal", 1, { combustible: true, temperature: 600 }));
    const fire = failureScore(event("thermal", 1, { combustible: true, temperature: 700 }));
    expect(lasts(fire)).toBeGreaterThan(lasts(ticking));
  });

  it("vents while helium boils off and rattles while a pump cavitates", () => {
    const part = (over: Partial<ComponentReading>) =>
      ({ heliumBoilOffKgS: 0, headFraction: 1, ...over }) as ComponentReading;
    expect(conditionSounds(part({}))).toEqual({ vent: 0, cavitation: 0 });
    expect(conditionSounds(part({ heliumBoilOffKgS: 100 })).vent).toBe(1);
    const small = conditionSounds(part({ heliumBoilOffKgS: 0.1 })).vent;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.5);
    expect(conditionSounds(part({ headFraction: 0.4 })).cavitation).toBeCloseTo(0.6);
  });
});
