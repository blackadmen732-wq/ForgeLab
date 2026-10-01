import { Color } from "three";
import { describe, expect, it } from "vitest";
import type { VesselState } from "@forgelab/sim-core";
import {
  appearanceFor,
  ghostedIn,
  PALETTE,
  surfaceMaterial,
  thermalSurface,
  type Readout,
} from "./appearance.js";

const readout = (over: Partial<Readout> = {}): Readout => ({
  utilization: 0,
  status: 0,
  temperatureK: 293.15,
  limitTemperatureK: 0,
  supplyFraction: 1,
  powerW: 0,
  massFlowKgS: 0,
  fieldT: 0,
  role: "structure",
  neutronHeatingW: 0,
  hoopUtilization: 0,
  headFraction: 1,
  disabled: false,
  free: false,
  isLoad: false,
  vessel: null,
  ...over,
});

const vessel = (pressurePa: number) => ({ pressurePa }) as unknown as VesselState;

const paint = (overlay: Parameters<typeof appearanceFor>[0], r: Readout) => {
  const out = { color: new Color(), emissive: new Color() };
  const emissive = appearanceFor(overlay, r, new Color("#888888"), out);
  return { color: out.color, emissive };
};

describe("vacuum view", () => {
  it("shows a vessel at atmosphere as red and a pumped-down vessel as blue", () => {
    const air = paint("vacuum", readout({ vessel: vessel(1.013e5) })).color;
    expect(air.equals(PALETTE.fail)).toBe(true);
    const pumped = paint("vacuum", readout({ vessel: vessel(1e-6) })).color;
    expect(pumped.b).toBeGreaterThan(pumped.r);
    expect(pumped.b).toBeGreaterThan(0.5);
  });

  it("ghosts everything outside the vacuum system", () => {
    expect(ghostedIn("vacuum", readout())).toBe(true);
    expect(ghostedIn("vacuum", readout({ role: "vacuum-pump" }))).toBe(false);
    expect(ghostedIn("vacuum", readout({ vessel: vessel(1) }))).toBe(false);
    expect(ghostedIn("none", readout())).toBe(false);
  });
});

describe("neutron view", () => {
  it("brightens with deposited neutron power and leaves unexposed parts dim", () => {
    const low = paint("neutron", readout({ neutronHeatingW: 1e4 }));
    const high = paint("neutron", readout({ neutronHeatingW: 1e8 }));
    expect(high.emissive).toBeGreaterThan(low.emissive);
    expect(high.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
      low.color.getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    expect(paint("neutron", readout()).color.equals(PALETTE.dim)).toBe(true);
  });
});

describe("materials hot, in the Normal view", () => {
  const look = (materialId: string, temperatureK: number) => {
    const out = { color: new Color(), emissive: new Color() };
    const base = new Color("#888888");
    const emissive = thermalSurface(surfaceMaterial(materialId), temperatureK, base, out);
    return { color: out.color, emissive, base };
  };

  it("gives steel its oxide temper colours, then a glow above the Draper point", () => {
    const cool = look("structural-steel", 400);
    expect(cool.color.equals(cool.base)).toBe(true);
    const blue = look("structural-steel", 563); // ~290 °C: blue temper
    expect(blue.color.b).toBeGreaterThan(blue.color.r);
    expect(look("structural-steel", 700).emissive).toBe(0);
    expect(look("structural-steel", 1000).emissive).toBeGreaterThan(0);
  });

  it("blackens copper with oxide, chars insulation, and leaves superconductors unchanged", () => {
    const cu = look("copper", 700);
    expect(cu.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(
      cu.base.getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    const g10 = look("g10-cr", 600); // above its ~130 °C service limit
    expect(g10.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.3);
    const sc = look("nb3sn", 300);
    expect(sc.color.equals(sc.base)).toBe(true);
    expect(sc.emissive).toBe(0);
  });

  it("does not make aluminium glow like steel or tungsten", () => {
    expect(look("aluminum", 1000).emissive).toBeLessThan(look("tungsten", 1000).emissive * 0.5);
  });
});
