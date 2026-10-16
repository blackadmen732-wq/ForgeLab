import { describe, expect, it } from "vitest";
import { fluidFinish, surfaceFinish } from "./finishes.js";

describe("physical surface families", () => {
  it("separates bare conductors from ceramic, polymer and civil materials", () => {
    for (const id of ["stainless-steel", "copper-ofhc", "aluminum", "tungsten", "nbti"])
      expect(surfaceFinish(id).metalness, id).toBeGreaterThan(0.9);
    for (const id of [
      "g10-cr",
      "xlpe",
      "alumina",
      "sic-cvd",
      "graphite-ig110",
      "concrete-c30",
      null,
    ])
      expect(surfaceFinish(id).metalness, String(id)).toBe(0);
  });

  it("keeps rough concrete and graphite distinct from machined stainless steel", () => {
    expect(surfaceFinish("concrete-c30").roughness).toBeGreaterThan(0.9);
    expect(surfaceFinish("graphite-ig110").roughness).toBeGreaterThan(0.85);
    expect(surfaceFinish("stainless-steel").roughness).toBeLessThan(0.45);
  });

  it("does not draw invisible gases as glowing blue liquid or liquid metal as water", () => {
    for (const id of ["helium", "deuterium", "tritium", "dt-fuel"])
      expect(fluidFinish(id).opacity).toBe(0);
    expect(fluidFinish("water").metalness).toBe(0);
    expect(fluidFinish("water").opacity).toBeLessThan(0.25);
    expect(fluidFinish("lithium-lead").metalness).toBeGreaterThan(0.9);
    expect(fluidFinish("lithium-lead").opacity).toBe(1);
  });
});
