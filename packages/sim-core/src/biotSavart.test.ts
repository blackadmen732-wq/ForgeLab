import { describe, expect, it } from "vitest";
import { MaterialIds } from "@forgelab/materials";
import { VACUUM_PERMEABILITY_H_PER_M as MU0, transform, vec3 } from "@forgelab/shared";
import { coilSegments, fieldPerAmp, ripple, vesselAxisCoupling } from "./plant/biotSavart.js";
import { solenoidOnAxisFieldT, toroidalFieldT } from "./plant/magnetics.js";
import { SimulationWorld, cylinderGeometry, torusGeometry } from "./index.js";

const world = new SimulationWorld({ name: "fields" });
let n = 0;
const add = (
  geometry: Parameters<SimulationWorld["addComponent"]>[0]["geometry"],
  parameters: Record<string, unknown>,
  role: "magnet-coil" | "vacuum-vessel" = "magnet-coil",
  at = vec3(0, 0, 0),
) =>
  world.addComponent({
    id: `c${(n += 1)}`,
    type: "test",
    geometry,
    materialId: MaterialIds.StainlessSteel,
    role,
    parameters,
    transform: transform(at),
  });

describe("Biot–Savart field from coil geometry", () => {
  it("matches a circular loop's centre and on-axis field", () => {
    const loop = add(torusGeometry(2, 0.1), { winding: "loop", turns: 100, currentA: 1000 });
    const segments = coilSegments(loop);
    const centre = fieldPerAmp(segments, vec3(0, 0, 0)).y * 1000;
    expect(centre).toBeCloseTo((MU0 * 100 * 1000) / (2 * 2), 4);
    const z = 1.5;
    const onAxis = fieldPerAmp(segments, vec3(0, z, 0)).y * 1000;
    const exact = (MU0 * 100 * 1000 * 4) / (2 * Math.pow(4 + z * z, 1.5));
    expect(Math.abs(onAxis - exact) / exact).toBeLessThan(2e-3);
  });

  it("matches the finite-solenoid formula at the centre", () => {
    const coil = add(cylinderGeometry(1, 4), { turns: 2000, currentA: 500 });
    const b = fieldPerAmp(coilSegments(coil), vec3(0, 0, 0)).y * 500;
    const exact = solenoidOnAxisFieldT({
      turns: 2000,
      currentA: 500,
      lengthM: 4,
      radiusM: 1,
      axialOffsetM: 0,
    });
    expect(Math.abs(b - exact) / exact).toBeLessThan(0.01);
  });

  it("reproduces the ideal toroid on the plasma axis from 18 discrete coils", () => {
    const tf = add(torusGeometry(6.2, 4.35), { turns: 2412, currentA: 68000 });
    const vessel = add(torusGeometry(6.2, 2.3), {}, "vacuum-vessel");
    const c = vesselAxisCoupling(vessel, coilSegments(tf))!;
    const ideal = toroidalFieldT(2412, 68000, 6.2);
    expect(Math.abs(c.meanTPerA * 68000 - ideal) / ideal).toBeLessThan(0.01);
    // Discrete coils ripple; on the axis, at R = 6.2 m with 18 coils, it is small.
    expect(ripple(c)).toBeLessThan(0.01);
  });

  it("finds the toroidal field of a player-built ring of circular coils", () => {
    // 18 loops of radius 3 m standing in meridian planes round a 6 m ring.
    const segments = [];
    for (let k = 0; k < 18; k += 1) {
      const phi = (2 * Math.PI * k) / 18;
      const coil = world.addComponent({
        id: `ring-${k}`,
        type: "test",
        geometry: torusGeometry(3, 0.2, "z"),
        materialId: MaterialIds.StainlessSteel,
        role: "magnet-coil",
        parameters: { winding: "loop", turns: 100, currentA: 1000 },
        transform: transform(vec3(6 * Math.cos(phi), 0, -6 * Math.sin(phi)), {
          x: 0,
          y: Math.sin(phi / 2),
          z: 0,
          w: Math.cos(phi / 2),
        }),
      });
      segments.push(...coilSegments(coil));
    }
    const vessel = add(torusGeometry(6, 2), {}, "vacuum-vessel");
    const c = vesselAxisCoupling(vessel, segments)!;
    // Close to an ideal toroidal winding of 18 × 100 turns.
    const ideal = toroidalFieldT(1800, 1, 6);
    expect(Math.abs(Math.abs(c.meanTPerA) - ideal) / ideal).toBeLessThan(0.03);
    expect(ripple(c)).toBeLessThan(0.05);
  });

  it("is deterministic and falls off far from the coil", () => {
    const loop = add(torusGeometry(1, 0.05), { winding: "loop", turns: 10, currentA: 100 });
    const s = coilSegments(loop);
    expect(fieldPerAmp(s, vec3(0.3, 2, 0.1))).toEqual(
      fieldPerAmp(coilSegments(loop), vec3(0.3, 2, 0.1)),
    );
    const near = Math.abs(fieldPerAmp(s, vec3(0, 5, 0)).y);
    const far = Math.abs(fieldPerAmp(s, vec3(0, 10, 0)).y);
    // A dipole: eight times weaker at twice the distance.
    expect(near / far).toBeGreaterThan(7.5);
    expect(near / far).toBeLessThan(8.5);
  });

  it("never diverges on a winding's own centreline", () => {
    const loop = add(torusGeometry(1, 0.05), { winding: "loop", turns: 10, currentA: 100 });
    const b = fieldPerAmp(coilSegments(loop), vec3(1, 0, 0));
    expect(Number.isFinite(b.x + b.y + b.z)).toBe(true);
  });
});
