import { describe, expect, it } from "vitest";
import type { DestructionEvent, FailureFamily } from "../destruction.js";
import { recipeFor, type RecipeContext } from "./recipes.js";

const ctx: RecipeContext = {
  ends: [
    [-2, 1, 0],
    [2, 1, 0],
  ],
  top: [0, 3, 0],
};
const event = (family: FailureFamily, over: Partial<DestructionEvent> = {}): DestructionEvent => ({
  eventId: `x::${family}::`,
  simulationTime: 1,
  componentId: "x",
  siteComponentId: "x",
  worldPosition: [0, 2, 0],
  worldDirection: [1, 0.5, 0],
  failureType: family,
  family,
  severity: 0.8,
  estimatedEnergy: 1e8,
  temperature: 900,
  pressure: null,
  electricalState: "energised",
  structuralState: "severe",
  affectedComponentIds: [],
  radiusM: 3,
  summary: "",
  combustible: false,
  ...over,
});

/** A family's visual fingerprint: which effect types and particle systems it uses. */
const signature = (family: FailureFamily, over?: Partial<DestructionEvent>) =>
  recipeFor(event(family, over), ctx)
    .map((c) => (c.type === "emit" ? `emit:${c.system}` : c.type))
    .sort()
    .join(",");

describe("failure effect recipes", () => {
  it("gives the six showroom failure families distinct looks", () => {
    const families: FailureFamily[] = [
      "electrical",
      "coolant",
      "cryogenic",
      "structural",
      "quench",
      "disruption",
    ];
    const signatures = families.map((f) => signature(f));
    expect(new Set(signatures).size).toBe(families.length);
  });

  it("only shows fire where something can burn, and never for a disruption or quench", () => {
    expect(signature("electrical", { combustible: false })).not.toContain("emit:fire");
    expect(signature("electrical", { combustible: true })).toContain("emit:fire");
    for (const f of ["disruption", "quench", "coolant", "cryogenic", "structural"] as const)
      expect(signature(f, { combustible: true })).not.toContain("emit:fire");
  });

  it("vents steam for coolant, cold vapour for cryogenics, and arcs only for electrical faults", () => {
    expect(signature("coolant")).toContain("emit:steam");
    expect(signature("quench")).toContain("emit:vapor");
    expect(signature("cryogenic")).toContain("emit:vapor");
    for (const f of ["coolant", "quench", "disruption", "structural"] as const)
      expect(signature(f)).not.toContain("arc");
    expect(signature("electrical")).toContain("arc");
  });

  it("throws debris only when the part is structurally damaged enough", () => {
    expect(signature("structural")).toContain("debris");
    expect(signature("disruption", { structuralState: "damaged" })).not.toContain("debris");
    expect(signature("disruption", { structuralState: "fractured" })).toContain("debris");
  });

  it("keeps camera effects bounded and shows nothing for brown-outs or interlocks", () => {
    for (const f of ["electrical", "coolant", "quench", "disruption", "structural"] as const) {
      for (const c of recipeFor(event(f, { severity: 1 }), ctx))
        if (c.type === "camera") {
          expect(c.trauma).toBeLessThanOrEqual(1);
          expect(c.kick).toBeLessThanOrEqual(1);
        }
    }
    expect(recipeFor(event("brownout"), ctx)).toEqual([]);
    expect(recipeFor(event("control"), ctx)).toEqual([]);
  });
});
