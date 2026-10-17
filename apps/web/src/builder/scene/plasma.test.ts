import { describe, expect, it } from "vitest";
import type { VesselState } from "@forgelab/sim-core";
import {
  animatePlasma,
  applyPlasmaState,
  createPlasmaMaterial,
  filamentTwist,
  plasmaBrightness,
} from "./plasma.js";

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
  it("fits the optical volume to the vessel envelope on every supported symmetry axis", () => {
    for (const [axis, canonicalAxis] of [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ] as const) {
      const geometry = { kind: "torus", majorRadiusM: 6, minorRadiusM: 2, axis } as const;
      const before = JSON.stringify(geometry);
      const material = createPlasmaMaterial(true, geometry);
      expect(material.uniforms["uShape"]!.value.toArray()).toEqual([6, 1.44, 1]);
      expect(material.uniforms["uAxis"]!.value).toBe(canonicalAxis);
      expect(JSON.stringify(geometry)).toBe(before);
      material.dispose();
    }
  });

  it("uses the linear vessel's inner radius and length instead of torus dimensions", () => {
    const material = createPlasmaMaterial(false, {
      kind: "cylinder",
      radiusM: 2,
      heightM: 10,
      axis: "y",
    });
    expect(material.uniforms["uShape"]!.value.toArray()).toEqual([0, 0.9, 4]);
    expect(material.uniforms["uToroidal"]!.value).toBe(0);
    material.dispose();
  });

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

  it("fades continuously to zero density and never fabricates light for invalid readings", () => {
    expect(plasmaBrightness(vessel({ densityM3: 5e17 }))).toBeCloseTo(0.15);
    for (const densityM3 of [0, -1, NaN, Infinity, -Infinity])
      expect(plasmaBrightness(vessel({ densityM3 }))).toBe(0);
  });

  it("clears breakdown light on disruption and reset, even during an animation update", () => {
    const material = createPlasmaMaterial(true);
    const state = vessel({});
    const before = JSON.stringify(state);
    applyPlasmaState(material, state);
    animatePlasma(material, 1, 10);
    expect(material.uniforms["uFlash"]!.value).toBe(1);
    expect(JSON.stringify(state)).toBe(before);
    for (const off of [vessel({ phase: "disrupted" }), null]) {
      applyPlasmaState(material, off);
      animatePlasma(material, 2, 1);
      expect(material.uniforms["uIntensity"]!.value).toBe(0);
      expect(material.uniforms["uFlash"]!.value).toBe(0);
    }
    material.dispose();
  });
});
