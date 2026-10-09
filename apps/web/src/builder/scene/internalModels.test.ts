import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { COMPONENT_DEFINITIONS } from "@forgelab/reactor-components";
import { hasBespokeInternals, internalModel } from "./internalModels.js";
import { halfExtents } from "./machines.js";
import { SYSTEM_OF } from "./Internals.js";

describe("machine internals (schematic)", () => {
  const bespoke = COMPONENT_DEFINITIONS.filter((d) => hasBespokeInternals(d.type));

  it("models the major machines", () => {
    expect(bespoke.map((d) => d.type).sort()).toEqual(
      [
        "breaker",
        "coolant-pump",
        "fuel-injector",
        "generator",
        "grid-connection",
        "neutral-beam",
        "steam-generator",
        "steam-turbine",
        "vacuum-pump",
      ].sort(),
    );
  });

  it("gives every region of the product sheet its own geometry, inside the part", () => {
    for (const definition of bespoke) {
      const spec = definition.createSpec({ id: "x" });
      const internals = definition.product.internals;
      const model = internalModel(definition.type, spec.geometry, internals);
      const [hx, hy, hz] = halfExtents(spec.geometry);
      for (const internal of internals) {
        const g = model.get(internal.id);
        expect(g, `${definition.type}/${internal.id}`).toBeDefined();
        const box = new Box3().setFromBufferAttribute(g!.getAttribute("position") as never);
        // Bushings and drives may reach the envelope's skin; nothing goes far beyond it.
        const slack = 1.15;
        expect(Math.max(-box.min.x, box.max.x), definition.type).toBeLessThanOrEqual(hx * slack);
        expect(Math.max(-box.min.y, box.max.y), definition.type).toBeLessThanOrEqual(hy * slack);
        expect(Math.max(-box.min.z, box.max.z), definition.type).toBeLessThanOrEqual(hz * slack);
      }
    }
  });

  it("falls back to nested bands for parts without a bespoke model", () => {
    const tf = COMPONENT_DEFINITIONS.find((d) => d.type === "tf-coil-set")!;
    const model = internalModel(tf.type, tf.createSpec({ id: "x" }).geometry, tf.product.internals);
    expect([...model.keys()]).toEqual(tf.product.internals.map((i) => i.id));
  });

  it("assigns every region kind to a system", () => {
    for (const d of COMPONENT_DEFINITIONS)
      for (const i of d.product.internals) expect(SYSTEM_OF[i.kind]).toBeDefined();
  });
});
