import { describe, expect, it } from "vitest";
import { damageStage, type DamageInputs } from "./damage.js";

const healthy: DamageInputs = {
  utilization: 0.2,
  temperatureK: 400,
  limitTemperatureK: 673,
  hoopUtilization: 0.3,
  headFraction: 1,
  disabled: false,
  failureTypes: [],
  fractured: false,
};
const stage = (over: Partial<DamageInputs>) => damageStage({ ...healthy, ...over }).stage;

describe("damage progression (read from published values)", () => {
  it("climbs normal → stressed → local → severe → ruptured → destroyed", () => {
    expect(stage({})).toBe("normal");
    expect(stage({ utilization: 0.8 })).toBe("stressed");
    expect(stage({ hoopUtilization: 0.9 })).toBe("stressed");
    expect(stage({ temperatureK: 600 })).toBe("stressed");
    expect(stage({ temperatureK: 700 })).toBe("local");
    expect(stage({ headFraction: 0.8 })).toBe("local");
    expect(stage({ failureTypes: ["over_temperature"], temperatureK: 700 })).toBe("local");
    expect(stage({ temperatureK: 800 })).toBe("severe");
    expect(stage({ headFraction: 0.3 })).toBe("severe");
    expect(stage({ failureTypes: ["pipe_rupture"] })).toBe("ruptured");
    expect(stage({ failureTypes: ["quench"] })).toBe("ruptured");
    expect(stage({ failureTypes: ["over_temperature"], disabled: true })).toBe("ruptured");
    expect(stage({ fractured: true })).toBe("destroyed");
  });

  it("does not call a starved load damaged", () => {
    expect(stage({ failureTypes: ["supply_shortfall"] })).toBe("normal");
  });

  it("names the published value behind the stage", () => {
    expect(damageStage({ ...healthy, utilization: 0.92 }).reason).toContain("92 %");
    expect(damageStage({ ...healthy, temperatureK: 800 }).reason).toContain("127 K over");
  });
});
