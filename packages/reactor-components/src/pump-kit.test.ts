import { getMaterial } from "@forgelab/materials";
import { describe, it, expect } from "vitest";
import { QuaternionMath, transform, vec3, Vec3Math } from "@forgelab/shared";
import {
  SimulationWorld,
  PUMP_CONSTRUCTION_RECIPE as recipe,
  deserializeWorld,
  serializeWorld,
  extractAssembly,
  insertAssembly,
  parseAssemblyFile,
  preflight,
  resolveConstruction,
  constructionMateTransform,
} from "@forgelab/sim-core";
import {
  buildReferencePlant,
  PUMP_PARTS,
  findKit,
  COOLANT_PUMP,
  GRID_CONNECTION,
} from "./index.js";

function pump(complete = true) {
  const world = findKit(recipe.id)!.build();
  const assembly = world.listBuildAssemblies()[0]!;
  if (complete) {
    for (const p of recipe.parts)
      world.setTransform(
        assembly.partIds[p.key]!,
        transform(Vec3Math.add(vec3(0, 1, 0), p.offset)),
      );
    for (const j of recipe.joints)
      world.connect(
        { componentId: assembly.partIds[j.from[0]]!, connectionPointId: j.from[1] },
        { componentId: assembly.partIds[j.to[0]]!, connectionPointId: j.to[1] },
      );
  }
  return { world, assembly };
}

describe("modular pump capability and durable construction", () => {
  it("keeps four loose modules inactive; geometry and grouping alone cannot complete a pump", () => {
    const { world, assembly } = pump(false);
    world.createGroup(Object.values(assembly.partIds));
    world.solve();
    expect(world.constructionStatus()[0]!.state).toBe("incomplete");
    expect(world.plantSummary.metrics.houseLoadW).toBe(0);
    expect(
      preflight(
        world.listComponents(),
        world.listConnections(),
        world.listBuildAssemblies(),
      ).items.some((i) => i.code === "INCOMPLETE_CONSTRUCTION"),
    ).toBe(true);
    expect(world.listComponents().every((c) => c.role === "structure")).toBe(true);
  });
  it("recognizes seated modules AND their actual mount joints; mass and owned interfaces are not duplicated", () => {
    const { world, assembly } = pump();
    expect(world.constructionStatus()[0]!.state).toBe("complete");
    const input = resolveConstruction(
      world.listComponents(),
      world.listConnections(),
      world.listBuildAssemblies(),
    );
    expect(input.components).toHaveLength(1);
    expect(input.components[0]!.role).toBe("coolant-pump");
    const sum = world.listComponents().reduce((n, c) => n + c.massKg, 0);
    expect(input.components[0]!.massKg).toBe(sum);
    expect(world.getSnapshot().assembly.totalMassKg).toBeCloseTo(sum, 8);
    const external = world.constructionStatus()[0]!.externalPorts;
    expect(external["power"]!.componentId).toBe(assembly.partIds["motor"]);
    expect(external["inlet"]!.componentId).toBe(assembly.partIds["casing"]);
    expect(
      world.listComponents().flatMap((c) => c.connectionPoints.filter((p) => p.id === "power")),
    ).toHaveLength(1);
    world.disconnect(world.listConnections()[0]!.id);
    expect(world.constructionStatus()[0]!.state).toBe("incomplete");
  });
  it("resolves to the existing pump demand and remaps the motor's external power connection", () => {
    const { world, assembly } = pump();
    world.addComponent(
      GRID_CONNECTION.createSpec({ id: "grid", transform: transform(vec3(5, 1, 0)) }),
    );
    world.connect(
      { componentId: "grid", connectionPointId: "power" },
      { componentId: assembly.partIds["motor"]!, connectionPointId: "power" },
    );
    world.solve();
    const legacy = findKit(recipe.id)!.build();
    for (const c of legacy.listComponents()) legacy.removeComponent(c.id);
    legacy.addComponent(
      COOLANT_PUMP.createSpec({ id: "legacy", transform: transform(vec3(0, 1, 0)) }),
    );
    legacy.addComponent(
      GRID_CONNECTION.createSpec({ id: "grid", transform: transform(vec3(5, 1, 0)) }),
    );
    legacy.connect(
      { componentId: "grid", connectionPointId: "power" },
      { componentId: "legacy", connectionPointId: "power" },
    );
    legacy.solve();
    const expected = legacy.requireComponent("legacy").state.plant.electrical!;
    const actual = world.requireComponent(assembly.partIds["motor"]!).state.plant.electrical!;
    expect(actual.demandW).toBeGreaterThan(0);
    expect(actual.demandW).toBe(expected.demandW);
    expect(actual.deliveredW).toBeCloseTo(expected.deliveredW, 6);
    expect(world.plantSummary.metrics.houseLoadW).toBe(legacy.plantSummary.metrics.houseLoadW);
    expect(world.requireComponent(assembly.partIds["casing"]!).state.plant.electrical).toBeNull();
  });
  it("refuses unseated, rotated or unsupported substitute modules even when links exist", () => {
    const { world, assembly } = pump();
    const motor = world.requireComponent(assembly.partIds["motor"]!);
    world.setTransform(
      motor.id,
      transform(
        motor.transform.positionM,
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
      ),
    );
    expect(world.constructionStatus()[0]!.state).toBe("incomplete");
    world.setTransform(motor.id, motor.transform);
    world.setMaterial(motor.id, "structural-steel");
    expect(world.constructionStatus()[0]!.state).toBe("unsupported");
    world.solve();
    expect(world.plantSummary.metrics.houseLoadW).toBe(0);
  });
  it("preserves construction through project saves, selection extraction and independent copies", () => {
    const { world, assembly } = pump();
    world.createGroup(Object.values(assembly.partIds), { name: "My pump" });
    const file = serializeWorld(world);
    const loaded = deserializeWorld(file);
    expect(loaded.constructionStatus()[0]!.state).toBe("complete");
    expect(serializeWorld(loaded).buildAssemblies).toEqual(file.buildAssemblies);
    const cut = extractAssembly(world, Object.values(assembly.partIds), "My pump");
    const copy = insertAssembly(world, cut, vec3(8, 0, 0));
    expect(copy.componentIds).toHaveLength(4);
    expect(world.constructionStatus().map((s) => s.state)).toEqual(["complete", "complete"]);
    expect(new Set(world.listBuildAssemblies().flatMap((a) => Object.values(a.partIds))).size).toBe(
      8,
    );
    world.removeComponent(copy.componentIds[0]!);
    expect(() => parseAssemblyFile(serializeWorld(world))).not.toThrow();
    expect(world.constructionStatus().filter((s) => s.state === "complete")).toHaveLength(1);
  });
  it("retains the stock lumped failure model when an assembled pump seizes", () => {
    const { world, assembly } = pump();
    const temperatureK = getMaterial("stainless-steel").maxOperatingTemperatureK + 10;
    world.updateSettings({ ambientTemperatureK: temperatureK, initialThermalState: "cold" });
    world.stepMany(3);
    expect(world.constructionStatus()[0]!.state).toBe("complete");
    expect(world.requireComponent(assembly.partIds["casing"]!).state.plant.disabled).toBe(true);
    const temperatures = world.listComponents().map((c) => c.state.plant.thermal.temperatureK);
    expect(temperatures.every((t) => t > temperatureK - 1)).toBe(true);
    expect(new Set(temperatures).size).toBe(1);
  });
  it("keeps loose modules passive even if a file forges an active plant role", () => {
    const { world } = pump(false),
      file = serializeWorld(world);
    const forged = {
      ...file,
      components: file.components.map((c) =>
        c.type === "pump-motor" ? { ...c, role: "coolant-pump" as const, parameters: {} } : c,
      ),
    };
    const w = deserializeWorld(forged);
    expect(w.constructionStatus()[0]!.state).toBe("unsupported");
    expect(w.listComponents().every((c) => c.state.plant.electrical === null)).toBe(true);
    const { buildAssemblies: _members, ...withoutRecipe } = forged;
    const loose = deserializeWorld(withoutRecipe);
    expect(loose.listComponents().every((c) => c.state.plant.electrical === null)).toBe(true);
  });
  it("keeps construction results independent of membership key insertion order", () => {
    const { world, assembly } = pump();
    const file = serializeWorld(world);
    const reordered = deserializeWorld({
      ...file,
      buildAssemblies: [
        { ...assembly, partIds: Object.fromEntries(Object.entries(assembly.partIds).reverse()) },
      ],
    });
    world.stepMany(3);
    reordered.stepMany(3);
    expect(reordered.getSnapshot().plant).toEqual(world.getSnapshot().plant);
    expect(reordered.listComponents().map((c) => c.state.plant)).toEqual(
      world.listComponents().map((c) => c.state.plant),
    );
  });
  it("rejects corrupt ownership but ignores a forged saved completion flag", () => {
    const { world } = pump(false);
    const file = serializeWorld(world),
      a = file.buildAssemblies![0]!;
    expect(() =>
      parseAssemblyFile({ ...file, buildAssemblies: [{ ...a, partIds: { base: "missing" } }] }),
    ).toThrow(/membership/);
    const tampered = deserializeWorld(
      parseAssemblyFile({
        ...file,
        buildAssemblies: [{ ...a, state: "complete", resolvedComponentType: "coolant-pump" }],
      }),
    );
    expect(tampered.constructionStatus()[0]!.state).toBe("incomplete");
    const unsupported = deserializeWorld({
      ...file,
      buildAssemblies: [{ ...a, recipeId: "unknown-pump" }],
    });
    expect(unsupported.constructionStatus()[0]!.state).toBe("unsupported");
  });
  it("matches a keyed mate's full rotation and preserves old finished-machine saves", () => {
    const { world, assembly } = pump();
    const a = world.requireComponent(assembly.partIds["motor"]!),
      b = world.requireComponent(assembly.partIds["drive"]!);
    const q = QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0.7);
    world.setTransform(b.id, transform(b.transform.positionM, q));
    const pose = constructionMateTransform(
      a,
      a.connectionPoints.find((p) => p.id === "base")!,
      world.requireComponent(b.id),
      b.connectionPoints.find((p) => p.id === "motor-seat")!,
    )!;
    expect(pose.rotation).toEqual(q);
    const old = new SimulationWorld();
    old.addComponent(
      COOLANT_PUMP.createSpec({ id: "old-pump", transform: transform(vec3(0, 1, 0)) }),
    );
    const file = serializeWorld(old);
    expect(file.buildAssemblies).toBeUndefined();
    const loaded = deserializeWorld(file);
    expect(loaded.listBuildAssemblies()).toEqual([]);
    expect(loaded.requireComponent("old-pump").role).toBe("coolant-pump");
    expect(loaded.requireComponent("old-pump").connectionPoints).toEqual(
      old.requireComponent("old-pump").connectionPoints,
    );
  });
});

describe("modular pump in an existing operating plant", () => {
  it("uses the stock hydraulic solver, external networks and deterministic reload", () => {
    const world = new SimulationWorld();
    buildReferencePlant(world);
    const old = world.listComponents().find((c) => c.type === "coolant-pump")!;
    const links = old.connections;
    world.removeComponent(old.id);
    const ids: Record<string, string> = {};
    for (const p of recipe.parts) {
      const id = p.key === "casing" ? old.id : `${old.id}-${p.key}`;
      ids[p.key] = id;
      const position = Vec3Math.add(
        old.transform.positionM,
        QuaternionMath.rotateVec3(old.transform.rotation, p.offset),
      );
      world.addComponent(
        PUMP_PARTS.find((d) => d.type === p.type)!.createSpec({
          id,
          transform: transform(position, old.transform.rotation),
        }),
      );
    }
    world.setBuildAssembly({ id: "plant-pump", recipeId: recipe.id, partIds: ids });
    for (const j of recipe.joints)
      world.connect(
        { componentId: ids[j.from[0]]!, connectionPointId: j.from[1] },
        { componentId: ids[j.to[0]]!, connectionPointId: j.to[1] },
      );
    for (const link of links) {
      const endpoint = (e: typeof link.from) =>
        e.componentId !== old.id
          ? e
          : {
              componentId:
                ids[
                  recipe.externalPorts[e.connectionPointId as keyof typeof recipe.externalPorts][0]
                ]!,
              connectionPointId: e.connectionPointId,
            };
      world.connect(endpoint(link.from), endpoint(link.to), { id: link.id, type: link.type });
    }
    expect(world.constructionStatus()[0]!.state).toBe("complete");
    const restored = deserializeWorld(serializeWorld(world));
    world.stepMany(60);
    restored.stepMany(60);
    const state = world.requireComponent(ids["casing"]!).state.plant;
    expect(state.coolant?.massFlowKgS).toBeGreaterThan(100);
    expect(
      world.requireComponent(ids["motor"]!).state.plant.electrical?.deliveredW,
    ).toBeGreaterThan(1e6);
    expect(restored.plantSummary.metrics).toEqual(world.plantSummary.metrics);
    expect(
      world.plantSummary.loops.find((l) => l.componentIds.includes(ids["casing"]!))?.closed,
    ).toBe(true);
    world.disconnect(
      world.listConnections().find((c) => c.type === "mount" && c.to.componentId === ids["motor"])!
        .id,
    );
    world.step();
    expect(world.constructionStatus()[0]!.state).toBe("incomplete");
    expect(world.requireComponent(ids["casing"]!).state.plant.coolant).toBeNull();
  });
});
