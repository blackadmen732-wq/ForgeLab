import { describe, expect, it } from "vitest";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { GENERATOR_PARTS, TURBINE_PARTS } from "@forgelab/reactor-components";
import { geometryLocalHalfExtentsM } from "@forgelab/sim-core";
import { machineModel } from "./machines.js";

describe("physical powertrain module models", () => {
  for (const definition of [...GENERATOR_PARTS, ...TURBINE_PARTS]) {
    it(`${definition.type} is manufactured geometry inside its module envelope`, () => {
      const spec = definition.createSpec({ id: "module" });
      const model = machineModel(spec.type, spec.geometry, spec.connectionPoints ?? [])!;
      expect(model.replacesEnvelope).toBe(true);
      const h = geometryLocalHalfExtentsM(spec.geometry);
      let triangles = 0;
      for (const g of [model.main, model.trim, model.accent]) {
        if (!g) continue;
        triangles += (g.index?.count ?? g.getAttribute("position").count) / 3;
        g.computeBoundingBox();
        const b = g.boundingBox!;
        for (const axis of ["x", "y", "z"] as const) {
          expect(b.min[axis], `${axis} min`).toBeGreaterThanOrEqual(-h[axis] - 0.15);
          expect(b.max[axis], `${axis} max`).toBeLessThanOrEqual(h[axis] + 0.15);
        }
        g.dispose();
      }
      expect(triangles).toBeLessThan(30000);
    });
  }
  for (const type of ["generator-stator", "turbine-casing"]) {
    it(`${type} has an actual open axial bore instead of a closed decorative cylinder`, () => {
      const def = [...GENERATOR_PARTS, ...TURBINE_PARTS].find((d) => d.type === type)!;
      const spec = def.createSpec({ id: "shell" });
      const model = machineModel(type, spec.geometry, spec.connectionPoints ?? [])!;
      const material = new MeshBasicMaterial({ side: DoubleSide });
      const mesh = new Mesh(model.main!, material);
      mesh.updateMatrixWorld(true);
      expect(
        new Raycaster(new Vector3(-100, -0.1, 0), new Vector3(1, 0, 0)).intersectObject(mesh),
      ).toHaveLength(0);
      for (const g of [model.main, model.trim, model.accent]) g?.dispose();
      material.dispose();
    });
  }
});
