import { describe, expect, it } from "vitest";
import { buildReferencePlant } from "@forgelab/reactor-components";
import { SimulationWorld } from "@forgelab/sim-core";
import { familyOf, materialUsage, materialsIn } from "./materialView.js";

describe("material view", () => {
  const world = new SimulationWorld({ name: "Reference" });
  buildReferencePlant(world);
  const parts = world.getSnapshot().components;

  it("groups materials by the library's own categories", () => {
    expect(familyOf("stainless-steel")).toBe("structural-metal");
    expect(familyOf("tungsten")).toBe("plasma-facing");
    expect(familyOf("nb3sn")).toBe("superconductor");
    expect(familyOf("water")).toBe("fluid");
    expect(familyOf("not-a-material")).toBe("other");
  });

  it("finds a material inside machines, not only in their casings", () => {
    const tf = parts.find((c) => c.id === "tf-coils")!;
    expect(materialsIn(tf).has("nb3sn")).toBe(true);
    const usage = materialUsage(parts);
    expect(usage.get("superconductor")!.get("nb3sn")).toContain("tf-coils");
    // Tungsten armour lines the vessel, though the vessel itself is steel.
    expect(usage.get("plasma-facing")!.get("tungsten")).toContain("vessel");
  });
});
