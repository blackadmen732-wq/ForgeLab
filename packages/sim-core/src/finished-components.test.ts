import { describe, expect, it } from "vitest";
import { getMaterial, getSubstance } from "@forgelab/materials";
import { vec3 } from "@forgelab/shared";
import {
  SimulationWorld,
  boxGeometry,
  checkPortCompatibility,
  componentHeatCapacityJK,
  connectionPoint,
  deserializeWorld,
  parseAssemblyFile,
  serializeWorld,
  type ConnectionPoint,
  type FluidPort as FluidPortSpec,
  type MaterialRegion,
  type PortSpec,
} from "./index.js";

const REGIONS: readonly MaterialRegion[] = [
  { id: "case", name: "Stainless case", substanceId: "stainless-steel", volumeFraction: 0.3 },
  { id: "conductor", name: "NbTi strand", substanceId: "nbti", volumeFraction: 0.05 },
  { id: "stabiliser", name: "Copper stabiliser", substanceId: "copper", volumeFraction: 0.1 },
  { id: "insulation", name: "G-10CR insulation", substanceId: "g10-cr", volumeFraction: 0.05 },
];

function world() {
  const w = new SimulationWorld({ name: "finished" });
  w.addComponent({
    id: "magnet",
    type: "magnet-module",
    geometry: boxGeometry(vec3(2, 2, 2)),
    materialId: "stainless-steel",
    composition: REGIONS,
    connectionPoints: [
      port("power-in", "electrical", {
        domain: "electrical",
        label: "POWER IN",
        direction: "in",
        nominalVoltageV: 400,
        ratedCurrentA: 10_000,
      }),
    ],
  });
  return w;
}

function port(
  id: string,
  type: ConnectionPoint["connectionType"],
  spec: PortSpec,
): ConnectionPoint {
  return { ...connectionPoint(id, vec3(0, 0, 0), vec3(1, 0, 0), type), port: spec };
}

describe("multi-material finished components", () => {
  it("takes its mass from its internal regions", () => {
    const magnet = world().requireComponent("magnet");
    const V = 8;
    const expected =
      0.3 * V * getMaterial("stainless-steel").densityKgM3 +
      0.05 * V * getSubstance("nbti").densityKgM3 +
      0.1 * V * getMaterial("copper").densityKgM3 +
      0.05 * V * getSubstance("g10-cr").densityKgM3;
    expect(magnet.massKg).toBeCloseTo(expected, 6);
    // Half the envelope is void (helium channels, clearances): far lighter than solid steel.
    expect(magnet.massKg).toBeLessThan(V * getMaterial("stainless-steel").densityKgM3 * 0.6);
  });

  it("counts heat capacity only for regions with a sourced specific heat", () => {
    const magnet = world().requireComponent("magnet");
    const V = 8;
    const expected =
      0.3 *
        V *
        getMaterial("stainless-steel").densityKgM3 *
        getMaterial("stainless-steel").specificHeatJkgK +
      0.1 * V * getMaterial("copper").densityKgM3 * getMaterial("copper").specificHeatJkgK +
      0.05 * V * getSubstance("g10-cr").densityKgM3 * getSubstance("g10-cr").specificHeatJkgK!;
    expect(componentHeatCapacityJK(magnet)).toBeCloseTo(expected, 3);
  });

  it("rejects impossible compositions", () => {
    const w = new SimulationWorld({ name: "bad" });
    const base = { type: "x", geometry: boxGeometry(vec3(1, 1, 1)), materialId: "copper" } as const;
    expect(() =>
      w.addComponent({
        ...base,
        id: "a",
        composition: [{ id: "r", name: "r", substanceId: "copper", volumeFraction: 1.2 }],
      }),
    ).toThrow(/outside 0–1/);
    expect(() =>
      w.addComponent({
        ...base,
        id: "b",
        composition: [
          { id: "r1", name: "r", substanceId: "copper", volumeFraction: 0.7 },
          { id: "r2", name: "r", substanceId: "copper", volumeFraction: 0.7 },
        ],
      }),
    ).toThrow(/140\.0 %/);
    expect(() =>
      w.addComponent({
        ...base,
        id: "c",
        composition: [{ id: "r", name: "r", substanceId: "kryptonite", volumeFraction: 0.1 }],
      }),
    ).toThrow(/unknown substance/);
  });

  it("round-trips composition and port specifications through the save format", () => {
    const original = world();
    const file = serializeWorld(original);
    const restored = deserializeWorld(parseAssemblyFile(JSON.parse(JSON.stringify(file))));
    const magnet = restored.requireComponent("magnet");
    expect(magnet.composition).toEqual(REGIONS);
    expect(magnet.massKg).toBeCloseTo(original.requireComponent("magnet").massKg, 9);
    expect(magnet.connectionPoints[0]!.port).toMatchObject({
      domain: "electrical",
      nominalVoltageV: 400,
    });
  });

  it("refuses files with malformed ports or compositions", () => {
    const file = JSON.parse(JSON.stringify(serializeWorld(world())));
    const badPort = structuredClone(file);
    badPort.components[0].connectionPoints[0].port.nominalVoltageV = -5;
    expect(() => parseAssemblyFile(badPort)).toThrow(/valid port/);
    const badRegions = structuredClone(file);
    badRegions.components[0].composition[0].volumeFraction = 0.9;
    expect(() => parseAssemblyFile(badRegions)).toThrow(/envelope/);
  });
});

describe("typed port compatibility", () => {
  const power = (v: number, a = 10_000, dir: "in" | "out" = "in") =>
    port("p", "electrical", {
      domain: "electrical",
      label: dir === "in" ? "POWER IN" : "POWER OUT",
      direction: dir,
      nominalVoltageV: v,
      ratedCurrentA: a,
    });
  const pipe = (fluid: "pressurized-water" | "cryogenic-helium", d: number, dir: "in" | "out") =>
    port("c", fluid === "cryogenic-helium" ? "cryo" : "coolant", {
      domain: "fluid",
      label: dir === "in" ? "IN" : "OUT",
      direction: dir,
      fluid,
      innerDiameterM: d,
      ratedPressurePa: 1.5e7,
      ratedTemperatureK: 620,
    });

  it("joins an outlet to an inlet of the same service", () => {
    expect(checkPortCompatibility(power(400, 1e4, "out"), power(400))).toEqual({
      state: "compatible",
      reasons: [],
      compatible: true,
      warnings: [],
    });
  });

  it("refuses different systems, facing outlets, other fluids and other voltages", () => {
    expect(
      checkPortCompatibility(power(400, 1e4, "out"), pipe("pressurized-water", 0.3, "in"))
        .compatible,
    ).toBe(false);
    expect(checkPortCompatibility(power(400), power(400)).reason).toMatch(/inlets/);
    expect(
      checkPortCompatibility(pipe("pressurized-water", 0.3, "out"), {
        ...pipe("cryogenic-helium", 0.3, "in"),
        connectionType: "coolant",
      }).reason,
    ).toMatch(/fluids/);
    expect(checkPortCompatibility(power(20_000, 1e4, "out"), power(400)).reason).toMatch(/Voltage/);
  });

  it("warns about rating differences instead of refusing them", () => {
    const narrow = checkPortCompatibility(
      pipe("pressurized-water", 0.3, "out"),
      pipe("pressurized-water", 0.1, "in"),
    );
    expect(narrow.compatible).toBe(true);
    expect(narrow.warnings[0]).toMatch(/reducer/);
    const current = checkPortCompatibility(power(400, 20_000, "out"), power(400, 5_000));
    expect(current.compatible).toBe(true);
    expect(current.warnings[0]).toMatch(/Current ratings/);
  });

  it("returns three states with machine-readable reason codes", () => {
    const code = (a: ConnectionPoint, b: ConnectionPoint) => {
      const r = checkPortCompatibility(a, b);
      return [r.state, ...r.reasons.map((x) => x.code)].join(" ");
    };
    const water = (d: number, dir: "in" | "out", over: Partial<FluidPortSpec> = {}) => ({
      ...pipe("pressurized-water", d, dir),
      port: { ...(pipe("pressurized-water", d, dir).port as FluidPortSpec), ...over },
    });
    // water out → water in
    expect(code(water(0.4, "out"), water(0.4, "in"))).toBe("compatible");
    // water → helium
    expect(
      code(water(0.4, "out"), {
        ...pipe("cryogenic-helium", 0.4, "in"),
        connectionType: "coolant",
      }),
    ).toBe("incompatible FLUID_MISMATCH");
    // fluid → electrical
    expect(code(water(0.4, "out"), power(400))).toBe("incompatible NETWORK_MISMATCH");
    // matching and mismatched voltages
    expect(code(power(20_000, 1e4, "out"), power(20_000))).toBe("compatible");
    expect(code(power(20_000, 1e4, "out"), power(400))).toBe("incompatible VOLTAGE_MISMATCH");
    // 400 mm → 300 mm
    const reducer = checkPortCompatibility(water(0.4, "out"), water(0.3, "in"));
    expect(reducer.state).toBe("warning");
    expect(reducer.reasons[0]).toMatchObject({ code: "BORE_MISMATCH", source: 0.4, target: 0.3 });
    // pressure and temperature ratings below the other side
    expect(code(water(0.4, "out"), water(0.4, "in", { ratedPressurePa: 5e6 }))).toBe(
      "warning PRESSURE_RATING_MISMATCH",
    );
    expect(code(water(0.4, "out"), water(0.4, "in", { ratedTemperatureK: 400 }))).toBe(
      "warning TEMPERATURE_RATING_MISMATCH",
    );
    // two outlets
    expect(code(water(0.4, "out"), water(0.4, "out"))).toBe("incompatible SAME_DIRECTION");
  });

  it("treats ports without a specification as network-typed sockets", () => {
    const plain = connectionPoint("s", vec3(0, 0, 0), vec3(0, 1, 0), "structural");
    const mount = connectionPoint("m", vec3(0, 0, 0), vec3(0, -1, 0), "mount");
    expect(checkPortCompatibility(plain, mount).compatible).toBe(true);
  });
});
