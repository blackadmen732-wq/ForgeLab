import { describe, expect, it } from "vitest";
import type { VesselState } from "@forgelab/sim-core";
import { filamentTwist, plasmaBrightness } from "./plasma.js";

const vessel = (plasma: Partial<VesselState["plasma"]>): VesselState =>
  ({
    pressurePa: 1e-6,
    pumpingSpeedM3PerS: 1,
    gasLoadPaM3PerS: 0,
    interiorVolumeM3: 800,
    plasma: {
      phase: "flat-top",
      densityM3: 1e20,
      safetyFactorQ95: 3,
      ...plasma,
    },
  }) as unknown as VesselState;

describe("plasma presentation", () => {
  it("is dark with no plasma and glows only while one exists", () => {
    expect(plasmaBrightness(null)).toBe(0);
    for (const phase of ["off", "ended", "disrupted"] as const)
      expect(plasmaBrightness(vessel({ phase }))).toBe(0);
    for (const phase of ["ramp-up", "flat-top", "shutdown"] as const)
      expect(plasmaBrightness(vessel({ phase }))).toBeGreaterThan(0);
  });

  it("brightens with density over the range of real devices", () => {
    const thin = plasmaBrightness(vessel({ densityM3: 1e18 }));
    const dense = plasmaBrightness(vessel({ densityM3: 1e20 }));
    expect(thin).toBeCloseTo(0.3, 6);
    expect(dense).toBeCloseTo(1, 6);
    expect(plasmaBrightness(vessel({ densityM3: 1e22 }))).toBe(1);
  });

  it("winds filaments by the published safety factor: tighter at low q95", () => {
    expect(filamentTwist(vessel({ safetyFactorQ95: 3 }))).toBe(8);
    expect(filamentTwist(vessel({ safetyFactorQ95: 6 }))).toBe(4);
    expect(filamentTwist(vessel({ safetyFactorQ95: 2 }))).toBeGreaterThan(
      filamentTwist(vessel({ safetyFactorQ95: 4 })),
    );
    // Whole stripes only, so the pattern closes around the torus.
    expect(Number.isInteger(filamentTwist(vessel({ safetyFactorQ95: 3.7 })))).toBe(true);
  });
});
