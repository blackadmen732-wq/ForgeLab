import { describe, expect, it } from "vitest";
import { SimulationWorld, preflight } from "@forgelab/sim-core";
import { buildIterClassPlant } from "./designs.js";

describe("ITER-class plant at true scale", () => {
  const build = () => {
    const world = new SimulationWorld({ name: "ITER-class" });
    buildIterClassPlant(world);
    return world;
  };

  it("is an ITER-class machine: tens of thousands of tonnes, tens of metres", () => {
    const world = build();
    const s = world.getSnapshot();
    // What its parts weigh (ITER itself is ~23 kt with far more systems than this).
    expect(s.assembly.totalMassKg).toBeGreaterThan(15e6);
    const cryostat = s.components.find((c) => c.id === "cryostat")!;
    expect(cryostat.massKg).toBeGreaterThan(2e6);
    expect(cryostat.massKg).toBeLessThan(4.5e6);
  });

  it("stands on its gravity supports without failing them", () => {
    const world = build();
    const s = world.getSnapshot();
    for (const id of ["support-px", "support-nx", "support-pz", "support-nz"]) {
      const c = s.components.find((x) => x.id === id)!;
      expect(c.state.structural.failed).toBe(false);
      expect(c.state.structural.utilization).toBeGreaterThan(0.05);
      expect(c.state.structural.utilization).toBeLessThan(1);
    }
    expect(s.failures).toHaveLength(0);
  });

  it("says plainly what the model does not use: PF coils and the solenoid", () => {
    const world = build();
    world.stepMany(60);
    const magnetics = world
      .getSnapshot()
      .plant.confidence.subsystems.find((x) => x.subsystem === "magnetics")!;
    expect(magnetics.reasons.join(" ")).toMatch(/7 coil\(s\) are coaxial with a toroidal vessel/);
    // Preflight does not call them misplaced.
    const codes = preflight(world.getSnapshot().components, world.listConnections()).items.map(
      (i) => i.code,
    );
    expect(codes).not.toContain("COIL_SERVES_NO_PLASMA");
  });

  it("runs deterministically", () => {
    const a = build();
    const b = build();
    a.stepMany(240);
    b.stepMany(240);
    const vessel = (w: SimulationWorld) =>
      w.getSnapshot().components.find((c) => c.id === "vessel")!.state.plant.vessel!;
    expect(vessel(b).pressurePa).toBe(vessel(a).pressurePa);
    expect(vessel(b).plasma.phase).toBe(vessel(a).plasma.phase);
  });
});
