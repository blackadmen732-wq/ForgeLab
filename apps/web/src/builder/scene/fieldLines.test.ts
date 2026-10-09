import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import { SimulationWorld } from "@forgelab/sim-core";
import { buildReferencePlant } from "@forgelab/reactor-components";
import { fieldCoils, traceFieldLines, traceLine } from "./fieldLines.js";

describe("field lines", () => {
  const world = new SimulationWorld({ name: "fl" });
  buildReferencePlant(world);
  const components = world.getSnapshot().components;
  const coils = fieldCoils(components, (c) => Number(c.parameters["currentA"]));

  it("closes round the torus inside a toroidal-field set", () => {
    const tf = coils.find((c) => c.id === "tf-coils")!;
    // A seed on the plasma axis follows the toroidal field all the way round.
    const vessel = components.find((c) => c.id === "vessel")!;
    const p = vessel.transform.positionM;
    const line = traceLine([tf], vec3(p.x + 6.2, p.y, p.z), {
      stepM: 0.3,
      maxSteps: 400,
      centre: p,
      radiusM: 30,
    });
    const last = line.points[line.points.length - 1]!;
    expect(Math.hypot(last.x - (p.x + 6.2), last.y - p.y, last.z - p.z)).toBeLessThan(0.5);
    // Strength on the axis close to the published 5.3 T.
    expect(line.fieldT[0]!).toBeGreaterThan(4.8);
    expect(line.fieldT[0]!).toBeLessThan(5.8);
  });

  it("traces a handful of lines for a whole plant, deterministically", () => {
    const a = traceFieldLines(components, coils);
    const b = traceFieldLines(components, coils);
    expect(a.length).toBeGreaterThan(3);
    expect(a).toEqual(b);
  });

  it("draws nothing when no coil carries current", () => {
    expect(
      traceFieldLines(
        components,
        fieldCoils(components, () => 0),
      ),
    ).toEqual([]);
  });
});
