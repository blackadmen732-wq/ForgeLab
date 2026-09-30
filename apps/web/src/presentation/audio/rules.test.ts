import { describe, expect, it } from "vitest";
import type { DestructionEvent } from "../destruction.js";
import { facilityActions, failureActions, pickVoices, stageActions } from "./rules.js";

const event = (family: DestructionEvent["family"], severity: number): DestructionEvent => ({
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
