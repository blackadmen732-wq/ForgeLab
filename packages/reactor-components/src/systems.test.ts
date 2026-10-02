import { describe, expect, it } from "vitest";
import { SimulationWorld } from "@forgelab/sim-core";
import { COMPONENT_DEFINITIONS } from "./builtin.js";
import { buildReferencePlant } from "./designs.js";
import { PLANT_SYSTEMS, plantSystemOf, plantSystemOfConnection } from "./systems.js";

describe("plant systems", () => {
  it("place every catalogue part in exactly one known system", () => {
    for (const d of COMPONENT_DEFINITIONS) {
      const spec = d.createSpec({ id: "x" });
      expect(PLANT_SYSTEMS).toContain(
        plantSystemOf({ role: spec.role!, parameters: spec.parameters ?? {} }),
      );
    }
  });

  it("group the reference plant as an engineer would", () => {
    const world = new SimulationWorld({ name: "Reference" });
    buildReferencePlant(world);
    const systemOf = (id: string) => plantSystemOf(world.requireComponent(id));
    expect(systemOf("vessel")).toBe("reactor");
    expect(systemOf("blanket")).toBe("reactor");
    expect(systemOf("tf-coils")).toBe("magnets");
    expect(systemOf("pump")).toBe("cooling");
    expect(systemOf("cryopump")).toBe("vacuum");
    expect(systemOf("turbine")).toBe("power-conversion");
    expect(systemOf("wall-sensor")).toBe("controls");
  });

  it("put warm helium in cooling and only cryogenic fluids in cryogenics", () => {
    const pump = (fluid: string) => plantSystemOf({ role: "coolant-pump", parameters: { fluid } });
    expect(pump("helium")).toBe("cooling");
    expect(pump("pressurized-water")).toBe("cooling");
    expect(pump("cryogenic-helium")).toBe("cryogenics");
    expect(plantSystemOfConnection("cryo")).toBe("cryogenics");
    expect(plantSystemOfConnection("steam")).toBe("power-conversion");
  });
});
