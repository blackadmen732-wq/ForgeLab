import { describe, expect, it } from "vitest";
import type { Box3, BufferAttribute } from "three";
import { COMPONENT_DEFINITIONS } from "@forgelab/reactor-components";
import { geometryLocalHalfExtentsM } from "@forgelab/sim-core";
import { machineModel } from "./machines.js";

describe("finished machine models", () => {
  for (const definition of COMPONENT_DEFINITIONS) {
    it(`${definition.type} builds a model that stays close to its envelope`, () => {
      const spec = definition.createSpec({ id: "x" });
      const model = machineModel(definition.type, spec.geometry, spec.connectionPoints ?? []);
      if (model === null) return; // drawn as its envelope
      const h = geometryLocalHalfExtentsM(spec.geometry);
      for (const g of [model.main, model.trim, model.accent]) {
        if (g === null) continue;
        const pos = g.getAttribute("position") as BufferAttribute;
        expect(pos.count).toBeGreaterThan(0);
        for (let i = 0; i < pos.array.length; i += 1)
          expect(Number.isFinite(pos.array[i])).toBe(true);
        g.computeBoundingBox();
        const b = g.boundingBox as Box3;
        // Fittings stand proud of the envelope at ports; nothing else strays far.
        const margin = 1.0;
        expect(b.max.x).toBeLessThanOrEqual(h.x + margin);
        expect(b.max.y).toBeLessThanOrEqual(h.y + margin);
        expect(b.max.z).toBeLessThanOrEqual(h.z + margin);
        expect(b.min.x).toBeGreaterThanOrEqual(-h.x - margin);
        expect(b.min.y).toBeGreaterThanOrEqual(-h.y - margin);
        expect(b.min.z).toBeGreaterThanOrEqual(-h.z - margin);
      }
    });
  }

  it("gives the plant's machines their own models", () => {
    const withModel = COMPONENT_DEFINITIONS.filter((d) => {
      const spec = d.createSpec({ id: "x" });
      return machineModel(d.type, spec.geometry, spec.connectionPoints ?? [])?.replacesEnvelope;
    }).map((d) => d.type);
    for (const type of [
      "coolant-pump",
      "steam-generator",
      "steam-turbine",
      "generator",
      "grid-connection",
      "neutral-beam",
    ])
      expect(withModel).toContain(type);
  });
});
