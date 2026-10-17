import { describe, expect, it } from "vitest";
import { rawActivity } from "./visualState.js";
import type { ComponentReading, PlantReading } from "./reading.js";

describe("construction rotor activity", () => {
  const plant = { metrics: { grossElectricW: 1e9 } } as PlantReading;
  it("does not animate an idle modular rotor from another machine's output", () => {
    for (const type of ["generator-rotor", "turbine-rotor"]) {
      const c = {
        type,
        role: "structure",
        disabled: false,
        shaftPowerW: 0,
        electricalOutputW: 0,
      } as ComponentReading;
      expect(rawActivity(c, plant)).toBe(0);
    }
  });
  it("uses each rotor's own published output and stops on failure", () => {
    const generator = {
      type: "generator-rotor",
      role: "structure",
      disabled: false,
      electricalOutputW: 4e6,
    } as ComponentReading;
    const turbine = {
      type: "turbine-rotor",
      role: "structure",
      disabled: false,
      shaftPowerW: 5e6,
    } as ComponentReading;
    expect(rawActivity(generator, plant)).toBe(4e6);
    expect(rawActivity(turbine, plant)).toBe(5e6);
    expect(rawActivity({ ...generator, disabled: true }, plant)).toBe(0);
  });
});
