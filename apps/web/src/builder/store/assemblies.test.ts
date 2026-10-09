import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { extractAssembly } from "@forgelab/sim-core";
import { findKit } from "@forgelab/reactor-components";
import { EditorStore } from "./editor.js";

/** The sandbox loop: put a kit down, pick it as one, take it apart, rebuild, reuse. */
function kitFile(id: string) {
  const world = findKit(id)!.build();
  return extractAssembly(
    world,
    world.listComponents().map((c) => c.id),
    findKit(id)!.name,
  );
}

describe("assemblies in the builder", () => {
  it("places a kit grouped and selected, as one undo step", () => {
    const store = new EditorStore();
    expect(store.placeAssembly(kitFile("blanket-module"), "Blanket Module", vec3(5, 0, 5))).toBe(
      true,
    );
    const view = store.getView();
    expect(view.selection).toHaveLength(2);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.name).toBe("Blanket Module");
    expect(store.world.listConnections()).toHaveLength(3);
    store.undo();
    expect(store.getView().snapshot.components).toHaveLength(0);
    expect(store.getView().groups).toHaveLength(0);
  });

  it("clicking a grouped part picks the group; Alt picks the part", () => {
    const store = new EditorStore();
    store.placeAssembly(kitFile("blanket-module"), undefined, vec3(0, 0, 0));
    const [a, b] = store.getView().groups[0]!.componentIds;
    store.select([]);
    store.pickPart(a!, false, false);
    expect([...store.getView().selection].sort()).toEqual([a, b].sort());
    store.pickPart(a!, false, true);
    expect(store.getView().selection).toEqual([a]);
  });

  it("takes a group apart without moving or unlinking anything, and groups it again", () => {
    const store = new EditorStore();
    store.placeAssembly(kitFile("primary-coolant-loop"), undefined, vec3(0, 0, 0));
    const before = JSON.stringify(store.world.listConnections());
    store.takeApartSelected();
    expect(store.getView().groups).toEqual([]);
    expect(JSON.stringify(store.world.listConnections())).toBe(before);
    store.groupSelected("My loop");
    expect(store.getView().groups.map((g) => g.name)).toEqual(["My loop"]);
    store.renameGroup(store.getView().groups[0]!.id, "Loop A");
    expect(store.getView().groups[0]!.name).toBe("Loop A");
  });

  it("saves a selection as an assembly and places copies of it with their links", () => {
    const store = new EditorStore();
    store.placeAssembly(kitFile("protected-feed"), undefined, vec3(0, 0, 0));
    const file = store.selectionAsAssembly("Feed")!;
    expect(file.components).toHaveLength(4);
    store.placeAssembly(file, "Feed", vec3(30, 0, 0));
    expect(store.world.listComponents()).toHaveLength(8);
    expect(store.world.listConnections()).toHaveLength(6);
    expect(
      store
        .getView()
        .groups.map((g) => g.name)
        .sort(),
    ).toEqual(["Feed", "Protected Power Feed"]);
  });

  it("duplicating a group makes a second group", () => {
    const store = new EditorStore();
    store.placeAssembly(kitFile("blanket-module"), undefined, vec3(0, 0, 0));
    store.duplicateSelected();
    expect(store.getView().groups).toHaveLength(2);
  });

  it("refuses something that is not an assembly, changing nothing", () => {
    const store = new EditorStore();
    expect(store.placeAssembly({ junk: 1 })).toBe(false);
    expect(store.getView().snapshot.components).toHaveLength(0);
  });
});
