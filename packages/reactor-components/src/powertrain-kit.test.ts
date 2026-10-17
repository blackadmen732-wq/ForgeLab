import { describe, expect, it } from "vitest";
import { transform, vec3, Vec3Math } from "@forgelab/shared";
import {
  GENERATOR_CONSTRUCTION_RECIPE,
  TURBINE_CONSTRUCTION_RECIPE,
  SimulationWorld,
  constructionMateTransform,
  resolveConstruction,
  resolveParameters,
  serializeWorld,
  deserializeWorld,
  extractAssembly,
  insertAssembly,
  type ConstructionRecipe,
} from "@forgelab/sim-core";
import { findKit, buildReferencePlant, getComponentDefinition, plantSystemOf } from "./index.js";

const recipes = [GENERATOR_CONSTRUCTION_RECIPE, TURBINE_CONSTRUCTION_RECIPE];
function assembled(recipe: ConstructionRecipe) {
  const world = findKit(recipe.id)!.build();
  const assembly = world.listBuildAssemblies()[0]!;
  for (const p of recipe.parts)
    world.setTransform(assembly.partIds[p.key]!, transform(Vec3Math.add(vec3(0, 2, 0), p.offset)));
  for (const joint of recipe.joints)
    world.connect(
      { componentId: assembly.partIds[joint.from[0]]!, connectionPointId: joint.from[1] },
      { componentId: assembly.partIds[joint.to[0]]!, connectionPointId: joint.to[1] },
    );
  return { world, assembly };
}

describe("stock powertrain construction", () => {
  for (const recipe of recipes) {
    it(`${recipe.resultType}: loose modules are inactive and seating alone cannot activate them`, () => {
      const world = findKit(recipe.id)!.build(),
        a = world.listBuildAssemblies()[0]!;
      for (const p of recipe.parts)
        world.setTransform(a.partIds[p.key]!, transform(Vec3Math.add(vec3(0, 2, 0), p.offset)));
      world.createGroup(Object.values(a.partIds));
      expect(world.constructionStatus()[0]!.state).toBe("incomplete");
      world.stepMany(3);
      expect(world.plantSummary.metrics.grossElectricW).toBe(0);
      expect(world.listComponents().every((c) => c.role === "structure")).toBe(true);
      expect(world.listComponents().every((c) => plantSystemOf(c) === "power-conversion")).toBe(
        true,
      );
    });
    it(`${recipe.resultType}: actual keyed joints complete one existing model with single-count mass and owned ports`, () => {
      const { world, assembly } = assembled(recipe);
      expect(world.constructionStatus()[0]!.state).toBe("complete");
      const resolved = resolveConstruction(
        world.listComponents(),
        world.listConnections(),
        world.listBuildAssemblies(),
      );
      expect(resolved.components).toHaveLength(1);
      const model = resolved.components[0]!;
      expect(model.role).toBe(recipe.role);
      expect(model.parameters).toEqual(
        resolveParameters(
          recipe.role,
          getComponentDefinition(recipe.resultType).createSpec({ id: "legacy" }).parameters ?? {},
        ),
      );
      expect(model.massKg).toBeCloseTo(
        world.listComponents().reduce((sum, c) => sum + c.massKg, 0),
        8,
      );
      for (const [name, [key]] of Object.entries(recipe.externalPorts))
        expect(world.constructionStatus()[0]!.externalPorts[name]!.componentId).toBe(
          assembly.partIds[key],
        );
      world.disconnect(world.listConnections()[0]!.id);
      expect(world.constructionStatus()[0]!.state).toBe("incomplete");
    });
    it(`${recipe.resultType}: detachment, substitution and forged completion cannot create a working machine`, () => {
      const { world, assembly } = assembled(recipe);
      const rotor = world.requireComponent(assembly.partIds["rotor"]!);
      world.setTransform(
        rotor.id,
        transform(Vec3Math.add(rotor.transform.positionM, vec3(2, 0, 0))),
      );
      expect(world.constructionStatus()[0]!.state).toBe("incomplete");
      const forged = {
        ...serializeWorld(world),
        buildAssemblies: [{ ...assembly, state: "complete" }],
      };
      const loaded = deserializeWorld(forged);
      expect(loaded.constructionStatus()[0]!.state).toBe("incomplete");
      world.setTransform(rotor.id, rotor.transform);
      world.setMaterial(rotor.id, "stainless-steel");
      expect(world.constructionStatus()[0]!.state).toBe("unsupported");
    });
    it(`${recipe.resultType}: save, reload and reusable copies preserve independent construction`, () => {
      const { world, assembly } = assembled(recipe);
      const copy = deserializeWorld(serializeWorld(world));
      expect(copy.constructionStatus()[0]!.state).toBe("complete");
      const file = extractAssembly(world, Object.values(assembly.partIds), recipe.name);
      insertAssembly(copy, file, vec3(16, 0, 0));
      expect(copy.constructionStatus().map((s) => s.state)).toEqual(["complete", "complete"]);
      expect(
        new Set(copy.listBuildAssemblies().flatMap((a) => Object.values(a.partIds))).size,
      ).toBe(8);
    });
    it(`${recipe.resultType}: individually placed modules discover their construction from the actual mount graph`, () => {
      const { world } = assembled(recipe);
      const file = serializeWorld(world),
        { buildAssemblies: _metadata, ...withoutMembership } = file;
      const independent = deserializeWorld(withoutMembership);
      independent.reconcileBuildAssemblies();
      expect(independent.constructionStatus()[0]!.state).toBe("complete");
      const joint = recipe.joints[0]!,
        a = independent.requireComponent(
          independent.listBuildAssemblies()[0]!.partIds[joint.from[0]]!,
        ),
        b = independent.requireComponent(
          independent.listBuildAssemblies()[0]!.partIds[joint.to[0]]!,
        );
      expect(
        constructionMateTransform(
          a,
          a.connectionPoints.find((p) => p.id === joint.from[1])!,
          b,
          b.connectionPoints.find((p) => p.id === joint.to[1])!,
        ),
      ).not.toBeNull();
    });
  }
  it("does not mate matching key names from different machine families", () => {
    const a = assembled(recipes[0]!),
      b = assembled(recipes[1]!);
    const ca = a.world.requireComponent(a.assembly.partIds["base"]!),
      rotor = b.world.requireComponent(b.assembly.partIds["rotor"]!);
    expect(
      constructionMateTransform(
        ca,
        ca.connectionPoints.find((p) => p.id === "rotor-seat")!,
        rotor,
        rotor.connectionPoints.find((p) => p.id === "casing-mate")!,
      ),
    ).toBeNull();
  });
  it("replaces both machines in the operating reference plant without changing power-conversion equations", () => {
    const legacy = new SimulationWorld();
    buildReferencePlant(legacy);
    const world = deserializeWorld(serializeWorld(legacy));
    const totalBefore = world.listComponents().length;
    for (const recipe of recipes) {
      const old = world.listComponents().find((c) => c.type === recipe.resultType)!;
      const external = old.connections.map((c) => ({ ...c }));
      const { world: source, assembly } = assembled(recipe);
      const file = extractAssembly(source, Object.values(assembly.partIds), recipe.name);
      // The extracted file is centred on its selection. Restore its assembled model
      // origin to the legacy machine's origin before mapping service endpoints.
      const copied = insertAssembly(world, file, old.transform.positionM);
      const inserted = world
        .listBuildAssemblies()
        .find((a) => Object.values(a.partIds).some((id) => copied.componentIds.includes(id)))!;
      const base = world.requireComponent(inserted.partIds["base"]!);
      const origin = Vec3Math.subtract(base.transform.positionM, recipe.parts[0]!.offset);
      const delta = Vec3Math.subtract(old.transform.positionM, origin);
      for (const id of Object.values(inserted.partIds)) {
        const c = world.requireComponent(id);
        world.setTransform(
          id,
          transform(Vec3Math.add(c.transform.positionM, delta), old.transform.rotation),
        );
      }
      world.removeComponent(old.id);
      for (const link of external) {
        const map = (e: typeof link.from) => {
          if (e.componentId !== old.id) return e;
          const [key] = recipe.externalPorts[e.connectionPointId]!;
          return { componentId: inserted.partIds[key]!, connectionPointId: e.connectionPointId };
        };
        world.connect(map(link.from), map(link.to));
      }
    }
    expect(world.listComponents()).toHaveLength(totalBefore + 6);
    expect(world.constructionStatus().every((s) => s.state === "complete")).toBe(true);
    legacy.stepMany(3600);
    world.stepMany(3600);
    expect(world.plantSummary.metrics.grossElectricW).toBeGreaterThan(0);
    expect(world.plantSummary.metrics.grossElectricW).toBeCloseTo(
      legacy.plantSummary.metrics.grossElectricW,
      3,
    );
    for (const recipe of recipes) {
      const a = world.listBuildAssemblies().find((a) => a.recipeId === recipe.id)!;
      const rotor = world.requireComponent(a.partIds["rotor"]!);
      expect(
        rotor.state.plant.outputs[
          recipe.role === "generator" ? "electricalOutputW" : "shaftPowerW"
        ],
      ).toBeGreaterThan(0);
    }
    world.reset();
    const reloaded = deserializeWorld(serializeWorld(world));
    world.stepMany(10);
    reloaded.stepMany(10);
    expect(reloaded.plantSummary.metrics).toEqual(world.plantSummary.metrics);
  });
});
