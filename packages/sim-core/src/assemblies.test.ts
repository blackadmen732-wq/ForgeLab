import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { makeWorld, placeBlock, stack } from "@forgelab/test-utils";
import {
  deserializeWorld,
  extractAssembly,
  insertAssembly,
  parseAssemblyFile,
  serializeWorld,
} from "./index.js";

/** Two stacked blocks on a third, beside a fourth that is not part of the assembly. */
function tower() {
  const world = makeWorld();
  placeBlock(world, { id: "base", positionM: vec3(10, 0.5, 4) });
  placeBlock(world, { id: "mid", positionM: vec3(10, 1.5, 4) });
  placeBlock(world, { id: "top", positionM: vec3(10, 2.5, 4) });
  placeBlock(world, { id: "other", positionM: vec3(20, 0.5, 4) });
  stack(world, "base", "mid");
  stack(world, "mid", "top");
  world.connect(
    { componentId: "other", connectionPointId: "top" },
    { componentId: "top", connectionPointId: "top" },
  );
  world.solve();
  return world;
}

describe("groups", () => {
  it("group parts without changing a single physical result", () => {
    const world = tower();
    const before = JSON.stringify(world.getSnapshot().components);
    const group = world.createGroup(["base", "mid", "top"], { name: "Tower" });
    expect(group.componentIds).toEqual(["base", "mid", "top"]);
    expect(world.groupOf("mid")?.id).toBe(group.id);
    world.solve();
    expect(JSON.stringify(world.getSnapshot().components)).toBe(before);
  });

  it("survive a save and a load, and a part belongs to one group at a time", () => {
    const world = tower();
    const a = world.createGroup(["base", "mid"], { name: "A" });
    world.createGroup(["mid", "top"], { name: "B" });
    // "mid" moved to B, which left A with one part: A is gone.
    expect(world.listGroups().map((g) => g.name)).toEqual(["B"]);
    expect(world.groupOf("base")).toBeUndefined();
    expect(a.componentIds).toEqual(["base", "mid"]); // the old value is frozen, not edited
    const loaded = deserializeWorld(parseAssemblyFile(serializeWorld(world)));
    expect(loaded.listGroups()).toEqual(world.listGroups());
  });

  it("take apart: ungrouping and deleting members leave the parts and their links alone", () => {
    const world = tower();
    const g = world.createGroup(["base", "mid", "top"]);
    world.ungroup(g.id);
    expect(world.listGroups()).toEqual([]);
    expect(world.listConnections()).toHaveLength(3);
    const h = world.createGroup(["base", "mid"]);
    world.removeComponent("mid");
    expect(world.listGroups().find((x) => x.id === h.id)).toBeUndefined();
  });

  it("ignore malformed or dangling group entries in a file", () => {
    const file = serializeWorld(tower());
    const parsed = parseAssemblyFile({
      ...file,
      groups: [
        { id: "g1", name: "ok", componentIds: ["base", "mid"] },
        { id: "g2", name: "dangling", componentIds: ["base", "ghost"] },
        "nonsense",
      ],
    });
    expect(parsed.groups?.map((g) => g.id)).toEqual(["g1"]);
  });
});

describe("assemblies", () => {
  it("cut out a piece with only its internal links, centred on its footprint", () => {
    const file = extractAssembly(tower(), ["base", "mid", "top"], "Tower");
    expect(file.components.map((c) => c.id)).toEqual(["base", "mid", "top"]);
    // The link to "other" stays behind.
    expect(file.connections).toHaveLength(2);
    expect(file.components[0]!.transform.positionM).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(file.components.every((c) => c.physical === undefined)).toBe(true);
  });

  it("put down anywhere, any number of times, with fresh ids, links and a group", () => {
    const piece = extractAssembly(tower(), ["base", "mid", "top"], "Tower");
    const world = makeWorld();
    const first = insertAssembly(world, piece, { x: -5, y: 0, z: 2 });
    const second = insertAssembly(world, piece, { x: 5, y: 0, z: 2 });
    expect(new Set([...first.componentIds, ...second.componentIds]).size).toBe(6);
    expect(world.listConnections()).toHaveLength(4);
    expect(world.listGroups().map((g) => g.name)).toEqual(["Tower", "Tower"]);
    const base = world.requireComponent(first.componentIds[0]!);
    expect(base.transform.positionM).toEqual(vec3(-5, 0.5, 2));
    // A placed copy behaves like the original: the tower stands.
    world.solve();
    expect(world.getSnapshot().failures).toEqual([]);
  });

  it("rejects a file that is not an assembly", () => {
    expect(() => insertAssembly(makeWorld(), { nope: true }, { x: 0, y: 0, z: 0 })).toThrow();
  });
});
