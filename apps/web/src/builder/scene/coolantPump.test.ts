import { describe, expect, it } from "vitest";
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { COOLANT_PUMP, PUMP_PARTS } from "@forgelab/reactor-components";
import { PUMP_CONSTRUCTION_RECIPE, boxGeometry } from "@forgelab/sim-core";
import { vec3 } from "@forgelab/shared";
import { buildCoolantPump, coolantPumpCoupling } from "./coolantPump.js";
import { coolantPumpPartModel } from "./coolantPumpParts.js";
import { flangedRing } from "./industrialGeometry.js";

describe("procedural coolant pump", () => {
  it("preserves the engineering definition and fits its real envelope", () => {
    const spec = COOLANT_PUMP.createSpec({ id: "pump" });
    const before = JSON.stringify(spec);
    const model = buildCoolantPump(spec.geometry, spec.connectionPoints!);
    let triangles = 0;
    for (const g of [model.main, model.trim, model.accent]) {
      expect(g).not.toBeNull();
      g!.computeBoundingBox();
      const b = g!.boundingBox!;
      console.log(
        "pump geometry",
        b.min.toArray(),
        b.max.toArray(),
        g!.getAttribute("position").count / 3,
      );
      for (const n of [...b.min.toArray(), ...b.max.toArray()])
        expect(Number.isFinite(n)).toBe(true);
      for (const n of b.min.toArray()) expect(n).toBeGreaterThanOrEqual(-1.01);
      for (const n of b.max.toArray()) expect(n).toBeLessThanOrEqual(1.01);
      triangles += g!.getAttribute("position").count / 3;
      g!.dispose();
    }
    expect(triangles).toBeLessThan(30000);
    expect(JSON.stringify(spec)).toBe(before);
    expect(spec.connectionPoints!.map((p) => p.id)).toEqual([
      "base",
      "inlet",
      "outlet",
      "power",
      "control",
    ]);
    console.log(`Pump: ${triangles} triangles across three batched surfaces`);
  });

  it.each(["x", "y", "z"] as const)("keeps a %s-axis flange's engineering bore open", (axis) => {
    const g = flangedRing(0.33, 0.48, 0.09, axis, [0, 0, 0]);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(g, material);
    mesh.updateMatrixWorld();
    const direction = new Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
    const origin = direction.clone().multiplyScalar(1);
    const ray = new Raycaster(origin, direction.clone().negate());
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    const offset = new Vector3(axis === "x" ? 0 : 0.41, axis === "x" ? 0.41 : 0, 0);
    ray.set(origin.add(offset), direction.negate());
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
    material.dispose();
    g.dispose();
  });

  it("places the animated coupling inside the guard and scales it with the envelope", () => {
    for (const scale of [0.5, 1, 2]) {
      const rotor = coolantPumpCoupling(boxGeometry(vec3(2 * scale, 2 * scale, 2 * scale)));
      rotor.geometry.computeBoundingBox();
      const b = rotor.geometry.boundingBox!;
      expect(b.max.x).toBeLessThan(0.16 * scale);
      expect(b.max.y + rotor.offset[1]).toBeLessThan(0.04 * scale);
      expect(b.min.y + rotor.offset[1]).toBeGreaterThan(-0.25 * scale);
      expect(rotor.axis).toBe("y");
      rotor.geometry.dispose();
    }
  });
});

describe("modular pump geometry", () => {
  it("reuses the finished pump at its real assembly coordinates within the triangle budget", () => {
    let triangles = 0;
    for (const part of PUMP_CONSTRUCTION_RECIPE.parts) {
      const spec = PUMP_PARTS.find((p) => p.type === part.type)!.createSpec({ id: part.key });
      const before = JSON.stringify(spec);
      const model = coolantPumpPartModel(part.type, spec.connectionPoints!)!;
      expect(model.replacesEnvelope).toBe(true);
      for (const g of [model.main, model.trim, model.accent])
        if (g) {
          g.computeBoundingBox();
          for (const n of [...g.boundingBox!.min.toArray(), ...g.boundingBox!.max.toArray()])
            expect(Number.isFinite(n)).toBe(true);
          const offset = [part.offset.x, part.offset.y, part.offset.z];
          g.boundingBox!.min.toArray().forEach((n, i) =>
            expect(n + offset[i]!).toBeGreaterThanOrEqual(-1.01),
          );
          g.boundingBox!.max.toArray().forEach((n, i) =>
            expect(n + offset[i]!).toBeLessThanOrEqual(1.01),
          );
          triangles += (g.index?.count ?? g.getAttribute("position").count) / 3;
          g.dispose();
        }
      expect(JSON.stringify(spec)).toBe(before);
    }
    expect(triangles).toBeGreaterThan(18000);
    expect(triangles).toBeLessThan(30000);
  });
});
