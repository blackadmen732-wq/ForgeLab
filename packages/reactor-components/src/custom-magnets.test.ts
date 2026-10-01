import { describe, expect, it } from "vitest";
import { SimulationWorld, preflight, toroidalFieldT } from "@forgelab/sim-core";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { TOKAMAK_CENTRE_Y, buildReferencePlant, placePart } from "./designs.js";

/** The reference plant with its TF set replaced by a player-built ring of circular coils. */
function ringPlant(count: number, options: { currentA?: number; ringRadiusM?: number } = {}) {
  const world = new SimulationWorld({ name: "Ring" });
  buildReferencePlant(world, { omit: ["tf-coils"] });
  for (let k = 0; k < count; k += 1) {
    const phi = (2 * Math.PI * k) / count;
    placePart(world, "circular-coil", {
      id: `coil-${k}`,
      transform: transform(
        vec3(6.2 * Math.cos(phi), TOKAMAK_CENTRE_Y, -6.2 * Math.sin(phi)),
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), phi),
      ),
      parameters: { currentA: options.currentA ?? 50000 },
    });
    // Mounted in place and fed from the main bus, as a player would wire them.
    world.setAnchored(`coil-${k}`, true);
    world.connect(
      { componentId: `coil-${k}`, connectionPointId: "power" },
      { componentId: "bus", connectionPointId: "a" },
    );
  }
  world.solve();
  return world;
}

const vessel = (world: SimulationWorld) =>
  world.getSnapshot().components.find((c) => c.id === "vessel")!.state.plant.vessel!;
const magnetics = (world: SimulationWorld) =>
  world.getSnapshot().plant.confidence.subsystems.find((s) => s.subsystem === "magnetics")!;

describe("player-built magnets", () => {
  it("confines the plasma with the field its geometry makes", () => {
    const world = ringPlant(18);
    world.stepMany(60);
    const b = vessel(world).plasma.fieldT;
    // 18 coils × 100 turns × 50 kA, ringed round R = 6.2 m: close to an ideal toroid.
    const ideal = toroidalFieldT(18 * 100, 50000, 6.2);
    expect(Math.abs(b - ideal) / ideal).toBeLessThan(0.05);
    // Every coil serves the vessel; none is reported as reaching no plasma.
    for (const c of world.getSnapshot().components.filter((x) => x.type === "circular-coil"))
      expect(c.state.plant.magnet?.servesVesselId).toBe("vessel");
    expect(magnetics(world).level).toBe("approximate");
    expect(magnetics(world).reasons.join(" ")).toMatch(/Biot–Savart/);
  });

  it("scales with what you build: fewer coils, less field and more ripple", () => {
    const full = ringPlant(18);
    const sparse = ringPlant(6);
    full.stepMany(60);
    sparse.stepMany(60);
    expect(vessel(sparse).plasma.fieldT).toBeLessThan(vessel(full).plasma.fieldT * 0.5);
    expect(magnetics(sparse).level).toBe("experimental");
    expect(magnetics(sparse).reasons.join(" ")).toMatch(/ripples/);
  });

  it("passes preflight: the ring is seen as the plasma's magnet, as the run will see it", () => {
    const world = ringPlant(18);
    const codes = preflight(world.getSnapshot().components, world.listConnections()).items.map(
      (i) => i.code,
    );
    expect(codes).not.toContain("NO_CONFINING_FIELD");
    expect(codes).not.toContain("COIL_SERVES_NO_PLASMA");
  });

  it("starts a plasma: coils that serve it through their geometry count as its magnet", () => {
    const world = ringPlant(18);
    const phases = new Set<string>();
    for (let s = 0; s < 30; s += 1) {
      world.stepMany(60);
      phases.add(vessel(world).plasma.phase);
      expect(vessel(world).plasma.statusText).not.toMatch(/no coil/);
    }
    expect([...phases].some((p) => p !== "off")).toBe(true);
  });

  it("is deterministic", () => {
    const a = ringPlant(12);
    const b = ringPlant(12);
    a.stepMany(120);
    b.stepMany(120);
    expect(vessel(a).plasma.fieldT).toBe(vessel(b).plasma.fieldT);
  });
});
