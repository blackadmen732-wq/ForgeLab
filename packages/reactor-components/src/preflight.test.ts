import { describe, expect, it } from "vitest";
import { preflight, SimulationWorld, type PreflightCode } from "@forgelab/sim-core";
import { buildReferencePlant, type ReferencePlantOptions } from "./designs.js";
import { buildScenario } from "./scenarios.js";

const plant = (options: ReferencePlantOptions = {}) => {
  const world = new SimulationWorld({ name: "preflight" });
  buildReferencePlant(world, options);
  return world;
};
const check = (world: SimulationWorld) =>
  preflight(world.getSnapshot().components, world.listConnections());
const codes = (world: SimulationWorld) => check(world).items.map((i) => i.code);

describe("preflight", () => {
  it("finds nothing to report on the reference plant", () => {
    expect(check(plant()).items).toEqual([]);
  });

  it("names the thin hot leg before the run that ruptures it", () => {
    const report = check(buildScenario("pipe-rupture"));
    const item = report.items.find((i) => i.code === "PIPE_PRESSURE_LIMIT");
    expect(item?.componentIds).toEqual(["pipe-hot"]);
    expect(item?.message).toMatch(/hoop stress/);
  });

  it("explains missing plant systems without prescribing a part", () => {
    const missing: [string, PreflightCode][] = [
      ["cryopump", "NO_VACUUM_PUMP"],
      ["injector", "NO_FUEL"],
      ["nbi", "NO_HEATING"],
    ];
    for (const [id, code] of missing) expect(codes(plant({ omit: [id] }))).toContain(code);
    for (const item of check(plant({ omit: ["cryopump"] })).items)
      expect(item.message).not.toMatch(/replace|use a|install/i);
  });

  it("sees an open coolant loop and an unpowered plant the way the solver will", () => {
    const open = plant();
    const pipe = open.listConnections().find((c) => c.type === "coolant")!;
    open.disconnect(pipe.id);
    expect(codes(open)).toContain("OPEN_COOLANT_LOOP");
    expect(codes(plant({ omit: ["grid"] }))).toEqual(expect.arrayContaining(["NO_STARTUP_POWER"]));
  });

  it("never stops a well-formed design, however bad; only an empty one", () => {
    const collapse = check(buildScenario("structural-collapse"));
    expect(collapse.items.length).toBeGreaterThan(0);
    expect(collapse.canActivate).toBe(true);
    expect(collapse.items.every((i) => i.severity === "warning")).toBe(true);
    const empty = check(new SimulationWorld({ name: "empty" }));
    expect(empty.canActivate).toBe(false);
    expect(empty.items[0]!.code).toBe("EMPTY_DESIGN");
  });

  it("does not flag the case-cooling ports of a cryogenically cooled magnet", () => {
    expect(check(plant()).items.some((i) => i.componentIds.includes("tf-coils"))).toBe(false);
  });
});
