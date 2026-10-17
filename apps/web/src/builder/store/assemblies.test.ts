import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { extractAssembly, constructionRecipe, worldAabb } from "@forgelab/sim-core";
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
  for (const recipeId of ["generator-kit-v1", "steam-turbine-kit-v1"]) {
    it(`${recipeId}: snapping forms actual construction and detaching a long rotor clears the machine`, () => {
      const store = new EditorStore();
      store.placeAssembly(kitFile(recipeId));
      const recipe = constructionRecipe(recipeId)!;
      const a = store.world.listBuildAssemblies()[0]!;
      store.setPosition(a.partIds["base"]!, vec3(0, 2 + recipe.parts[0]!.offset.y, 0));
      for (const p of recipe.parts.slice(1)) {
        const c = store.world.requireComponent(a.partIds[p.key]!);
        store.moveComponents([
          {
            id: c.id,
            position: vec3(p.offset.x + 0.04, 2 + p.offset.y, p.offset.z),
            rotation: c.transform.rotation,
          },
        ]);
      }
      expect(store.world.constructionStatus()[0]!.state).toBe("complete");
      const before = store.designHash();
      store.detachConstructionPart(a.partIds["rotor"]!);
      expect(store.world.constructionStatus()[0]!.state).toBe("incomplete");
      const rotor = store.world.requireComponent(a.partIds["rotor"]!);
      const box = worldAabb(rotor.geometry, rotor.transform);
      for (const p of recipe.parts.filter((p) => p.key !== "rotor")) {
        const c = store.world.requireComponent(a.partIds[p.key]!);
        expect(box.minM.x).toBeGreaterThan(worldAabb(c.geometry, c.transform).maxM.x);
      }
      store.undo();
      expect(store.designHash()).toBe(before);
      expect(store.world.constructionStatus()[0]!.state).toBe("complete");
    });
  }
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

/** Construction is physical membership; ordinary grouping remains only organisation. */
describe("pump construction in the builder", () => {
  function loose() {
    const store = new EditorStore();
    store.placeAssembly(kitFile("coolant-pump-kit-v1"), "Pump Kit", vec3(0, 0, 0));
    return { store, assembly: store.world.listBuildAssemblies()[0]! };
  }
  function seat(store: EditorStore, partIds: Readonly<Record<string, string>>, key: string) {
    const base = store.world.requireComponent(partIds["base"]!);
    const offsetY: Record<string, number> = { casing: 0.725, drive: 0.775, motor: 1.375 };
    const c = store.world.requireComponent(partIds[key]!);
    store.moveComponents([
      {
        id: c.id,
        position: vec3(
          base.transform.positionM.x + 0.12,
          base.transform.positionM.y + offsetY[key]!,
          base.transform.positionM.z,
        ),
        rotation: base.transform.rotation,
      },
    ]);
  }
  it("seats three meaningful modules, undoes completion, detaches and reassembles", () => {
    const { store, assembly } = loose();
    expect(store.getView().groups).toHaveLength(0);
    for (const key of ["casing", "drive", "motor"]) seat(store, assembly.partIds, key);
    expect(store.world.constructionStatus()[0]!.state).toBe("complete");
    expect(store.world.listConnections().filter((c) => c.type === "mount")).toHaveLength(3);
    store.undo();
    expect(store.world.constructionStatus()[0]!.state).toBe("incomplete");
    store.redo();
    expect(store.world.constructionStatus()[0]!.state).toBe("complete");
    store.detachConstructionPart(assembly.partIds["motor"]!);
    expect(store.world.constructionStatus()[0]!.state).toBe("incomplete");
    seat(store, assembly.partIds, "motor");
    expect(store.world.constructionStatus()[0]!.state).toBe("complete");
  });
  it("attaches a complete pump's skid to an existing structural platform", () => {
    const { store, assembly } = loose();
    for (const key of ["casing", "drive", "motor"]) seat(store, assembly.partIds, key);
    const base = store.world.requireComponent(assembly.partIds["base"]!),
      p = base.transform.positionM;
    const deck = store.addPart("structural-platform", vec3(p.x + 8, 0, p.z))!;
    const c = store.world.requireComponent(deck),
      top = c.connectionPoints.find((p) => p.id === "top")!;
    const destination = vec3(
      c.transform.positionM.x,
      c.transform.positionM.y + top.localPosition.y + 0.125,
      c.transform.positionM.z,
    );
    const delta = vec3(destination.x - p.x, destination.y - p.y, destination.z - p.z);
    store.moveComponents(
      Object.values(assembly.partIds).map((id) => {
        const c = store.world.requireComponent(id),
          p = c.transform.positionM;
        return {
          id,
          position: vec3(p.x + delta.x, p.y + delta.y, p.z + delta.z),
          rotation: c.transform.rotation,
        };
      }),
    );
    expect(store.world.constructionStatus()[0]!.state).toBe("complete");
    expect(
      store.world
        .requireComponent(base.id)
        .connections.some(
          (c) =>
            c.type === "structural" && (c.from.componentId === deck || c.to.componentId === deck),
        ),
    ).toBe(true);
  });
  it("previews a keyed mount without editing the world and supports bypass/cancel", () => {
    const { store, assembly } = loose();
    const before = store.designHash();
    const base = store.world.requireComponent(assembly.partIds["base"]!);
    store.beginPlacement("pump-casing");
    const at = vec3(base.transform.positionM.x + 0.1, 0.17, base.transform.positionM.z);
    store.previewPlacement(at);
    expect(store.getView().placement!.mate?.componentId).toBe(base.id);
    expect(store.designHash()).toBe(before);
    store.previewPlacement(at, true);
    expect(store.getView().placement!.mate).toBeNull();
    store.previewPlacement(at);
    store.cancelPlacement();
    expect(store.getView().placement).toBeNull();
    expect(store.designHash()).toBe(before);
  });
  it("preserves complete construction in saved copies, duplicate, group rotation and reload", () => {
    const { store, assembly } = loose();
    for (const key of ["casing", "drive", "motor"]) seat(store, assembly.partIds, key);
    store.select(Object.values(assembly.partIds));
    store.groupSelected("My pump");
    store.rotateSelection90();
    expect(store.world.constructionStatus()[0]!.state).toBe("complete");
    const file = store.selectionAsAssembly("My pump")!;
    store.placeAssembly(file, "My pump", vec3(12, 0, 0));
    expect(store.world.constructionStatus().map((s) => s.state)).toEqual(["complete", "complete"]);
    store.duplicateSelected();
    expect(store.world.constructionStatus().map((s) => s.state)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    const saved = store.exportFile(),
      hash = store.designHash();
    store.loadFile(saved);
    expect(store.designHash()).toBe(hash);
    expect(store.world.constructionStatus().map((s) => s.state)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
  });
});
