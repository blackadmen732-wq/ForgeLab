import { describe, expect, it } from "vitest";
import { findSubstance } from "@forgelab/materials";
import { SimulationWorld, checkPortCompatibility } from "@forgelab/sim-core";
import { COMPONENT_DEFINITIONS, buildReferencePlant, buildStarterAssembly } from "./index.js";

describe("finished-product sheets", () => {
  it("gives every catalogue entry a product sheet with real substances", () => {
    for (const definition of COMPONENT_DEFINITIONS) {
      const product = definition.product;
      expect(product.summary.length, definition.type).toBeGreaterThan(10);
      expect(product.internals.length, definition.type).toBeGreaterThan(0);
      for (const internal of product.internals) {
        expect(
          findSubstance(internal.substanceId),
          `${definition.type}/${internal.id}`,
        ).toBeDefined();
      }
      expect(product.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("types every service socket with a port specification", () => {
    for (const definition of COMPONENT_DEFINITIONS) {
      const spec = definition.createSpec({ id: "x" });
      for (const point of spec.connectionPoints ?? []) {
        expect(point.port, `${definition.type}/${point.id}`).toBeDefined();
      }
    }
  });

  it("wires the shipped designs with compatible ports only", () => {
    for (const build of [buildReferencePlant, buildStarterAssembly]) {
      const world = new SimulationWorld();
      build(world);
      for (const connection of world.listConnections()) {
        const a = world
          .requireComponent(connection.from.componentId)
          .connectionPoints.find((p) => p.id === connection.from.connectionPointId)!;
        const b = world
          .requireComponent(connection.to.componentId)
          .connectionPoints.find((p) => p.id === connection.to.connectionPointId)!;
        const result = checkPortCompatibility(a, b);
        expect(result.compatible, `${connection.id}: ${result.reason ?? ""}`).toBe(true);
      }
    }
  });
});
