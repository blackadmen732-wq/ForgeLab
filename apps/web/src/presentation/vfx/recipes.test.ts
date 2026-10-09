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
    .map((c) => (c.type === "emit" || c.type === "follow" ? `emit:${c.system}` : c.type))
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

describe("failure sequences", () => {
  const starts = (family: FailureFamily, over?: Partial<DestructionEvent>) =>
    recipeFor(event(family, over), ctx).map((c) =>
      c.type === "emit" ? c.delay : "delay" in c ? (c.delay ?? 0) : 0,
    );

  it("unfolds over time: a first break, secondary reactions, then a lingering aftermath", () => {
    for (const f of ["electrical", "quench", "structural"] as const) {
      const t = starts(f);
      expect(Math.min(...t)).toBe(0);
      expect(Math.max(...t)).toBeGreaterThan(0.3);
    }
    // Each of these leaves something behind for at least half a minute.
    for (const f of ["electrical", "quench", "structural"] as const) {
      const lasts = recipeFor(event(f), ctx).flatMap((c) =>
        c.type === "emit" ? [c.delay + c.duration] : c.type === "follow" ? [c.duration] : [],
      );
      expect(Math.max(...lasts)).toBeGreaterThanOrEqual(20);
    }
  });

  it("couples a quench's helium vent to the published boil-off rather than a canned length", () => {
    const follows = recipeFor(event("quench"), ctx).filter((c) => c.type === "follow");
    expect(follows).toHaveLength(1);
    expect(follows[0]).toMatchObject({ field: "heliumBoilOffKgS", componentId: "x" });
  });

  it("gives electrical faults their own thin smoke, and sooty smoke only where insulation burns", () => {
    expect(signature("electrical")).toContain("emit:esmoke");
    expect(signature("electrical")).not.toContain("emit:smoke");
    expect(signature("electrical", { combustible: true })).toContain("emit:smoke");
  });

  it("only sets insulation alight above its ignition temperature", () => {
    expect(signature("thermal", { combustible: true, temperature: 610 })).not.toContain("fire");
    expect(signature("thermal", { combustible: true, temperature: 700 })).toContain("emit:fire");
    expect(recipeFor(event("thermal", { combustible: false }), ctx)).toEqual([]);
  });

  it("jets a ruptured pipe sideways off its axis, narrow for a pinhole and wide for a break", () => {
    const jet = (severity: number) => {
      const c = recipeFor(
        event("coolant", { failureType: "pipe_rupture", severity, pressure: 1.5e7 }),
        ctx,
      ).find((x) => x.type === "emit" && x.system === "steam");
      if (c?.type !== "emit") throw new Error("no jet");
      return c;
    };
    const small = jet(0.2);
    const large = jet(0.9);
    // The pipe runs along x in ctx: the jet is perpendicular to it.
    expect(Math.abs(small.direction[0])).toBeLessThan(1e-9);
    expect(small.spread).toBeLessThan(large.spread);
    expect(small.rate).toBeLessThan(large.rate);
    expect(large.duration).toBeGreaterThan(small.duration);
    expect(large.decay).toBeDefined();
    // Higher pressure, faster jet.
    const slow = recipeFor(
      event("coolant", { failureType: "pipe_rupture", severity: 0.9, pressure: 1e6 }),
      ctx,
    ).find((x) => x.type === "emit" && x.system === "steam");
    if (slow?.type !== "emit") throw new Error("no jet");
    expect(slow.speed[1]).toBeLessThan(large.speed[1]);
  });
});

describe("damage marks", () => {
  const marks = (family: FailureFamily, over?: Partial<DestructionEvent>) =>
    recipeFor(event(family, over), ctx).flatMap((c) => (c.type === "mark" ? [c.kind] : []));

  it("leaves the mark each physical event leaves, on the part where it happened", () => {
    expect(marks("electrical")).toEqual(["scorch"]);
    expect(marks("electrical", { combustible: true })).toEqual(["scorch", "soot"]);
    expect(marks("quench")).toEqual(["frost"]);
    expect(marks("cryogenic")).toEqual(["frost"]);
    expect(marks("structural")).toEqual(["crack"]);
    expect(marks("coolant", { failureType: "pipe_rupture" })).toEqual(["tear"]);
    // A relief-valve steam release does not tear anything.
    expect(marks("coolant", { failureType: "coolant_boiling" })).toEqual([]);
    expect(marks("disruption")).toEqual([]);
    for (const c of recipeFor(event("electrical"), ctx))
      if (c.type === "mark") expect(c.componentId).toBe("x");
  });
});
