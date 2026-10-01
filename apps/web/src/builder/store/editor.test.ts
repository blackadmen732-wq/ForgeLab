import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { worldAabb } from "@forgelab/sim-core";
import { EditorStore } from "./editor.js";

/** Editing semantics of the builder store, run against the real engine in Node. */

function setup() {
  const store = new EditorStore();
  const platform = store.addPart("structural-platform", vec3(0, 0, 0))!;
  return { store, platform };
}

const bottomOf = (store: EditorStore, id: string) => {
  const c = store.world.requireComponent(id);
  return worldAabb(c.geometry, c.transform).minM.y;
};

const linked = (store: EditorStore, a: string, b: string) =>
  store.world
    .listConnections()
    .some(
      (c) =>
        (c.from.componentId === a && c.to.componentId === b) ||
        (c.from.componentId === b && c.to.componentId === a),
    );

describe("editor store", () => {
  it("places new parts resting on the ground and selects them", () => {
    const { store, platform } = setup();
    expect(bottomOf(store, platform)).toBeCloseTo(0, 9);
    expect(store.getView().selection).toEqual([platform]);
    expect(store.getView().snapshot.components).toHaveLength(1);
    expect(store.getView().canUndo).toBe(true);
  });

  it("snaps a dropped part onto a nearby compatible socket and connects it", () => {
    const { store, platform } = setup();
    const block = store.addPart("equipment-block", vec3(0.2, 0, 0.1))!;
    const position = store.world.requireComponent(block).transform.positionM;
    // The block's bottom socket now sits exactly on the deck's top socket (deck top at 0.2 m).
    expect(position.x).toBeCloseTo(0, 9);
    expect(position.z).toBeCloseTo(0, 9);
    expect(bottomOf(store, block)).toBeCloseTo(0.2, 9);
    expect(linked(store, block, platform)).toBe(true);
    // The engine now carries the block's weight through the deck.
    const deck = store.getView().snapshot.components.find((c) => c.id === platform)!;
    expect(deck.state.structural.appliedStressPa).toBeGreaterThan(0);
  });

  it("breaks load-bearing links when parts are pulled apart, and undo restores them", () => {
    const { store, platform } = setup();
    const block = store.addPart("equipment-block", vec3(0.2, 0, 0.1))!;
    const rotation = store.world.requireComponent(block).transform.rotation;
    store.moveComponents([{ id: block, position: vec3(8, 0.5, 8), rotation }], true);
    expect(linked(store, block, platform)).toBe(false);
    store.undo();
    expect(linked(store, block, platform)).toBe(true);
    store.redo();
    expect(linked(store, block, platform)).toBe(false);
  });

  it("snaps moves to the grid unless overridden", () => {
    const { store, platform } = setup();
    const rotation = store.world.requireComponent(platform).transform.rotation;
    store.moveComponents([{ id: platform, position: vec3(10.13, 0.1, -3.61), rotation }]);
    let p = store.world.requireComponent(platform).transform.positionM;
    expect([p.x, p.z]).toEqual([10.25, -3.5]);
    store.moveComponents([{ id: platform, position: vec3(10.13, 0.1, -3.61), rotation }], true);
    p = store.world.requireComponent(platform).transform.positionM;
    expect([p.x, p.z]).toEqual([10.13, -3.61]);
  });

  it("connects matching sockets with the connect tool and refuses mismatched ones", () => {
    const store = new EditorStore();
    const pump = store.addPart("coolant-pump", vec3(0, 0, 0))!;
    const pipe = store.addPart("coolant-pipe", vec3(20, 0, 0))!;
    store.pickSocket({ componentId: pump, connectionPointId: "outlet" });
    store.pickSocket({ componentId: pipe, connectionPointId: "a" });
    expect(linked(store, pump, pipe)).toBe(true);
    const before = store.world.listConnections().length;
    store.pickSocket({ componentId: pump, connectionPointId: "power" });
    store.pickSocket({ componentId: pipe, connectionPointId: "b" });
    expect(store.world.listConnections()).toHaveLength(before);
  });

  it("changes material, recomputing mass and socket ratings", () => {
    const { store, platform } = setup();
    const before = store.world.requireComponent(platform);
    store.setMaterial([platform], "aluminum");
    const after = store.world.requireComponent(platform);
    expect(after.massKg).toBeLessThan(before.massKg);
    const rating = (c: typeof before) => c.connectionPoints.find((p) => p.id === "top")!.maxLoadN!;
    expect(rating(after)).not.toBeCloseTo(rating(before));
  });

  it("resizes parametric parts and keeps grounded parts on the ground", () => {
    const { store, platform } = setup();
    store.setDimension(platform, "depthM", 1);
    const c = store.world.requireComponent(platform);
    expect(c.geometry.kind === "box" && c.geometry.sizeM.y).toBeCloseTo(1, 9);
    expect(bottomOf(store, platform)).toBeCloseTo(0, 9);
  });

  it("duplicates a selection with the links inside it", () => {
    const { store, platform } = setup();
    const block = store.addPart("equipment-block", vec3(0.2, 0, 0.1))!;
    store.select([platform, block]);
    store.duplicateSelected();
    const view = store.getView();
    expect(view.snapshot.components).toHaveLength(4);
    const [copyA, copyB] = view.selection;
    expect(linked(store, copyA!, copyB!)).toBe(true);
  });

  it("rings a coil round an axis in one undoable edit", () => {
    const store = new EditorStore();
    const coil = store.addPart("solenoid-coil", vec3(6, 0, 0))!;
    store.select([coil]);
    store.patternSelected({ kind: "radial", origin: vec3(0, 0, 0), axis: vec3(0, 1, 0), count: 6 });
    const coils = store.getView().snapshot.components;
    expect(coils).toHaveLength(6);
    // All six sit on the same 6 m ring, 60° apart.
    for (const c of coils)
      expect(Math.hypot(c.transform.positionM.x, c.transform.positionM.z)).toBeCloseTo(6, 6);
    expect(store.getView().selection).toHaveLength(6);
    store.undo();
    expect(store.getView().snapshot.components).toHaveLength(1);
  });

  it("rows and mirrors a linked selection, copying its links into each instance", () => {
    const { store, platform } = setup();
    const block = store.addPart("equipment-block", vec3(0.2, 0, 0.1))!;
    store.select([platform, block]);
    store.patternSelected({ kind: "linear", step: vec3(0, 0, 6), count: 3 });
    const view = store.getView();
    expect(view.snapshot.components).toHaveLength(6);
    const copies = view.selection.slice(2);
    expect(linked(store, copies[0]!, copies[1]!)).toBe(true);
    expect(linked(store, copies[2]!, copies[3]!)).toBe(true);
    // Nothing is linked across instances.
    expect(linked(store, platform, copies[0]!)).toBe(false);

    const mirror = new EditorStore();
    const part = mirror.addPart("structural-platform", vec3(4, 0, 1))!;
    mirror.select([part]);
    mirror.patternSelected({ kind: "mirror", point: vec3(0, 0, 0), normal: vec3(1, 0, 0) });
    const [a, b] = mirror.getView().snapshot.components;
    expect(b!.transform.positionM.x).toBeCloseTo(-a!.transform.positionM.x, 9);
    expect(b!.transform.positionM.z).toBeCloseTo(a!.transform.positionM.z, 9);
  });

  it("keeps parameters as engine-validated SI values", () => {
    const store = new EditorStore();
    const pump = store.addPart("coolant-pump", vec3(0, 0, 0))!;
    store.setParameter([pump], "enabled", false);
    expect(store.world.requireComponent(pump).parameters["enabled"]).toBe(false);
  });

  it("round-trips through the design file with a stable hash", () => {
    const { store } = setup();
    store.addPart("equipment-block", vec3(0.2, 0, 0.1));
    const hash = store.designHash();
    const file = store.exportFile();
    const other = new EditorStore();
    other.loadFile(JSON.parse(JSON.stringify(file)));
    expect(other.designHash()).toBe(hash);
    expect(other.getView().canUndo).toBe(false);
  });

  it("hides, isolates and shows parts without touching the design", () => {
    const { store, platform } = setup();
    const block = store.addPart("equipment-block", vec3(9, 0, 9))!;
    const revision = store.getView().designRevision;
    store.select([block]);
    store.toggleIsolate();
    expect([...store.getView().hidden]).toEqual([platform]);
    store.toggleIsolate();
    expect(store.getView().hidden.size).toBe(0);
    store.hideSelected();
    expect(store.getView().hidden.has(block)).toBe(true);
    expect(store.getView().designRevision).toBe(revision);
  });
});
