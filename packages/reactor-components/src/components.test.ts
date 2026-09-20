import { describe, expect, it } from "vitest";
import { MaterialIds, getMaterial } from "@forgelab/materials";
import {
  QuaternionMath,
  UP,
  Vec3Math,
  localDirectionToWorld,
  transform,
  vec3,
} from "@forgelab/shared";
import { SimulationWorld, createComponent, geometryVolumeM3 } from "@forgelab/sim-core";
import {
  COMPONENT_DEFINITIONS,
  EQUIPMENT_BLOCK,
  REACTOR_CHAMBER,
  STRUCTURAL_BEAM,
  STRUCTURAL_PLATFORM,
  findComponentDefinition,
  getComponentDefinition,
} from "./index.js";

describe("built-in component catalogue", () => {
  it("ships exactly the four Milestone 0 components", () => {
    expect(COMPONENT_DEFINITIONS.map((d) => d.type)).toEqual([
      "structural-beam",
      "structural-platform",
      "reactor-chamber",
      "equipment-block",
    ]);
  });

  it("looks a definition up by type and refuses an unknown one", () => {
    expect(findComponentDefinition("structural-beam")).toBe(STRUCTURAL_BEAM);
    expect(findComponentDefinition("warp-core")).toBeUndefined();
    expect(() => getComponentDefinition("warp-core")).toThrowError(/Unknown component type/);
  });

  it("gives every component a documented default material from the catalogue", () => {
    for (const definition of COMPONENT_DEFINITIONS) {
      expect(() => getMaterial(definition.defaultMaterialId)).not.toThrow();
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });

  it("gives every component at least one structural socket, all with unique ids", () => {
    for (const definition of COMPONENT_DEFINITIONS) {
      const spec = definition.createSpec({ id: "x" });
      const sockets = spec.connectionPoints ?? [];
      expect(sockets.length).toBeGreaterThan(0);
      expect(new Set(sockets.map((s) => s.id)).size).toBe(sockets.length);
      expect(sockets.some((s) => s.connectionType === "structural")).toBe(true);

      for (const socket of sockets) {
        // Socket normals must be unit vectors: the solver reads them as directions.
        expect(Vec3Math.length(socket.localDirection)).toBeCloseTo(1, 12);
      }
    }
  });

  it("rates structural sockets from real section and yield, and leaves mounts unrated", () => {
    const spec = REACTOR_CHAMBER.createSpec({ id: "vessel" });
    const sockets = spec.connectionPoints ?? [];

    const base = sockets.find((s) => s.id === "base")!;
    const stainless = getMaterial(MaterialIds.StainlessSteel);
    // Annulus of a 1.5 m radius shell with a 50 mm wall, at the 316L yield stress.
    const annulusM2 = Math.PI * (1.5 ** 2 - 1.45 ** 2);
    expect(base.maxLoadN).toBeCloseTo(annulusM2 * stainless.yieldStrengthPa, 3);

    const port = sockets.find((s) => s.id === "port-nx")!;
    expect(port.connectionType).toBe("mount");
    expect(port.maxLoadN).toBeUndefined();
  });

  it("computes the beam as a hollow section, not a solid bar", () => {
    const spec = STRUCTURAL_BEAM.createSpec({ id: "beam" });
    const component = createComponent(spec);
    const solidM3 = 4 * 0.15 * 0.15;
    expect(geometryVolumeM3(component.geometry)).toBeLessThan(solidM3 * 0.3);
    // A 4 m length of 150x150x8 SHS is about 137 kg of real steel; the closed-shell
    // approximation adds the two end caps, so ForgeLab lands slightly above that.
    expect(component.massKg).toBeGreaterThan(130);
    expect(component.massKg).toBeLessThan(150);
  });

  it("gives the platform a plausible deck mass per square metre", () => {
    const component = createComponent(STRUCTURAL_PLATFORM.createSpec({ id: "deck" }));
    const areaM2 = 6 * 6;
    const kgPerM2 = component.massKg / areaM2;
    expect(kgPerM2).toBeGreaterThan(100);
    expect(kgPerM2).toBeLessThan(350);
  });

  it("gives the reactor chamber a shell mass, not a billet mass", () => {
    const component = createComponent(REACTOR_CHAMBER.createSpec({ id: "vessel" }));
    const solidMassKg = Math.PI * 1.5 ** 2 * 3 * 8000;
    expect(component.massKg).toBeLessThan(solidMassKg * 0.15);
    expect(component.massKg).toBeGreaterThan(10_000);
  });

  it("stands the equipment block on a solid 1 m aluminium cube", () => {
    const component = createComponent(EQUIPMENT_BLOCK.createSpec({ id: "skid" }));
    expect(component.materialId).toBe(MaterialIds.Aluminum);
    expect(component.massKg).toBeCloseTo(2700, 6);
  });

  it("carries placement options through into the component", () => {
    const component = createComponent(
      STRUCTURAL_PLATFORM.createSpec({
        id: "deck",
        transform: transform(vec3(1, 2, 3)),
        materialId: MaterialIds.Tungsten,
        label: "Main Deck",
        anchored: true,
        additionalMassKg: 400,
      }),
    );
    expect(component.transform.positionM).toEqual(vec3(1, 2, 3));
    expect(component.materialId).toBe(MaterialIds.Tungsten);
    expect(component.label).toBe("Main Deck");
    expect(component.anchored).toBe(true);
    expect(component.additionalMassKg).toBe(400);
  });

  it("rotates a beam's end socket to point upward when stood on end", () => {
    const world = new SimulationWorld();
    const upright = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
    const beam = world.addComponent(
      STRUCTURAL_BEAM.createSpec({ id: "column", transform: transform(vec3(0, 2, 0), upright) }),
    );

    const endB = beam.connectionPoints.find((s) => s.id === "end-b")!;
    const worldDirection = localDirectionToWorld(beam.transform, endB.localDirection);
    expect(Vec3Math.dot(worldDirection, UP)).toBeCloseTo(1, 9);
  });

  it("places every component in a world and solves without diagnostics", () => {
    const world = new SimulationWorld();
    for (const [index, definition] of COMPONENT_DEFINITIONS.entries()) {
      world.addComponent(
        definition.createSpec({
          id: definition.type,
          transform: transform(vec3(index * 12, 0.5, 0)),
        }),
      );
    }
    world.solve();

    const snapshot = world.getSnapshot();
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.components).toHaveLength(4);
    expect(snapshot.assembly.totalMassKg).toBeGreaterThan(0);
    for (const component of snapshot.components) {
      expect(component.massKg).toBeGreaterThan(0);
      expect(Number.isFinite(component.state.structural.utilization)).toBe(true);
    }
  });
});
