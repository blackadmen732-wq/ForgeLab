import { Color } from "three";
import { describe, expect, it } from "vitest";
import type { VesselState } from "@forgelab/sim-core";
import { appearanceFor, ghostedIn, PALETTE, type Readout } from "./appearance.js";

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
