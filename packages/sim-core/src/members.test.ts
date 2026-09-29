import { describe, expect, it } from "vitest";
import { MaterialIds, getMaterial } from "@forgelab/materials";
import { QuaternionMath, STANDARD_GRAVITY_MPS2, transform, vec3 } from "@forgelab/shared";
import { makeWorld, place } from "@forgelab/test-utils";
import { boxGeometry, cylinderGeometry, connectionPoint } from "./index.js";
import {
  beamMaxBendingMoment,
  columnBuckling,
  elasticSectionModulusM3,
  secondMomentOfAreaM4,
  sectionProperties,
} from "./systems/members.js";

const g = STANDARD_GRAVITY_MPS2;

describe("section properties (Structural 0.1)", () => {
  it("gives b*d^3/12 for a solid rectangle", () => {
    const geometry = boxGeometry(vec3(4, 0.3, 0.1));
    // Member along x, bending across y (depth 0.3), width z = 0.1.
    expect(secondMomentOfAreaM4(geometry, "x", "y")).toBeCloseTo((0.1 * 0.3 ** 3) / 12, 15);
    expect(elasticSectionModulusM3(geometry, "x", "y")).toBeCloseTo((0.1 * 0.3 ** 2) / 6, 15);
  });

  it("subtracts the void of a rectangular hollow section", () => {
    const geometry = boxGeometry(vec3(4, 0.15, 0.15), 0.008);
    const expected = (0.15 ** 4 - 0.134 ** 4) / 12;
    expect(secondMomentOfAreaM4(geometry, "x", "y")).toBeCloseTo(expected, 15);
  });

  it("gives pi*(r^4 - ri^4)/4 for a tube along its own axis", () => {
    const geometry = cylinderGeometry(0.1, 3, "y", 0.01);
    expect(secondMomentOfAreaM4(geometry, "y", "x")).toBeCloseTo(
      (Math.PI * (0.1 ** 4 - 0.09 ** 4)) / 4,
      15,
    );
  });
});

describe("column buckling (Euler and Johnson)", () => {
  const steel = getMaterial(MaterialIds.StructuralSteel);

  it("reproduces Euler's P_cr = pi^2 E I / (K L)^2 for a slender column", () => {
    // 50 mm solid square bar, 6 m long: slenderness ~416, far into the Euler range.
    const geometry = boxGeometry(vec3(0.05, 6, 0.05));
    const section = sectionProperties(geometry, "y", 0.05 * 0.05);
    const result = columnBuckling({
      lengthM: 6,
      effectiveLengthFactor: 1,
      section,
      youngsModulusPa: steel.youngsModulusPa,
      yieldStrengthPa: steel.yieldStrengthPa,
    });
    const I = 0.05 ** 4 / 12;
    expect(result.regime).toBe("euler");
    expect(result.criticalLoadN).toBeCloseTo((Math.PI ** 2 * 200e9 * I) / 36, 3);
  });

  it("quadruples the capacity when the effective length halves (K = 0.5)", () => {
    const geometry = boxGeometry(vec3(0.05, 6, 0.05));
    const section = sectionProperties(geometry, "y", 0.0025);
    const common = {
      lengthM: 6,
      section,
      youngsModulusPa: steel.youngsModulusPa,
      yieldStrengthPa: steel.yieldStrengthPa,
    };
    const pinned = columnBuckling({ ...common, effectiveLengthFactor: 1 });
    const fixed = columnBuckling({ ...common, effectiveLengthFactor: 0.5 });
    expect(fixed.criticalLoadN / pinned.criticalLoadN).toBeCloseTo(4, 9);
  });

  it("switches to the Johnson parabola for stocky columns and never exceeds yield", () => {
    const geometry = boxGeometry(vec3(0.2, 1, 0.2));
    const section = sectionProperties(geometry, "y", 0.04);
    const result = columnBuckling({
      lengthM: 1,
      effectiveLengthFactor: 1,
      section,
      youngsModulusPa: steel.youngsModulusPa,
      yieldStrengthPa: steel.yieldStrengthPa,
    });
    expect(result.regime).toBe("johnson");
    expect(result.criticalStressPa).toBeLessThan(steel.yieldStrengthPa);
    expect(result.criticalStressPa).toBeGreaterThan(0.99 * steel.yieldStrengthPa);
  });

  it("meets the Euler curve tangentially at the transition slenderness", () => {
    const E = steel.youngsModulusPa;
    const sy = steel.yieldStrengthPa;
    const cc = Math.sqrt((2 * Math.PI ** 2 * E) / sy);
    // At KL/r = Cc both formulas give sigma_y / 2.
    expect((Math.PI ** 2 * E) / cc ** 2).toBeCloseTo(sy / 2, 0);
    expect(sy - (sy ** 2 / (4 * Math.PI ** 2 * E)) * cc ** 2).toBeCloseTo(sy / 2, 0);
  });
});

describe("beam bending moments", () => {
  it("gives PL/4 for a central point load on a simple span", () => {
    const result = beamMaxBendingMoment({
      lengthM: 4,
      distributedLoadN: 0,
      pointLoads: [{ atM: 0, loadN: 1000 }],
      supportsAtM: [-2, 2],
    });
    expect(result.idealisation).toBe("simply-supported");
    expect(result.maxMomentNm).toBeCloseTo((1000 * 4) / 4, 6);
  });

  it("gives wL^2/8 for a uniform load on a simple span", () => {
    const result = beamMaxBendingMoment({
      lengthM: 6,
      distributedLoadN: 6000, // w = 1000 N/m
      pointLoads: [],
      supportsAtM: [-3, 3],
    });
    expect(result.maxMomentNm).toBeCloseTo((1000 * 36) / 8, 6);
    expect(result.atM).toBeCloseTo(0, 6);
  });

  it("gives P*a*b/L under an off-centre point load", () => {
    const result = beamMaxBendingMoment({
      lengthM: 10,
      distributedLoadN: 0,
      pointLoads: [{ atM: -2, loadN: 500 }],
      supportsAtM: [-5, 5],
    });
    // a = 3, b = 7, L = 10
    expect(result.maxMomentNm).toBeCloseTo((500 * 3 * 7) / 10, 6);
  });

  it("gives P*L for an end load on a cantilever", () => {
    const result = beamMaxBendingMoment({
      lengthM: 3,
      distributedLoadN: 0,
      pointLoads: [{ atM: 1.5, loadN: 200 }],
      supportsAtM: [-1.5],
    });
    expect(result.idealisation).toBe("cantilever");
    expect(result.maxMomentNm).toBeCloseTo(200 * 3, 6);
  });

  it("gives wL^2/2 for a uniformly loaded cantilever", () => {
    const result = beamMaxBendingMoment({
      lengthM: 2,
      distributedLoadN: 400,
      pointLoads: [],
      supportsAtM: [-1],
    });
    expect(result.maxMomentNm).toBeCloseTo((200 * 2 * 2) / 2, 6);
  });
});

describe("structural solver with Structural 0.1 member checks", () => {
  const UPRIGHT = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);

  function slenderColumnWorld(heightM: number, massOnTopKg: number) {
    const world = makeWorld();
    world.addComponent({
      id: "column",
      type: "test-column",
      geometry: boxGeometry(vec3(0.05, heightM, 0.05)),
      materialId: MaterialIds.StructuralSteel,
      transform: transform(vec3(0, heightM / 2, 0)),
      connectionPoints: [
        connectionPoint("top", vec3(0, heightM / 2, 0), vec3(0, 1, 0)),
        connectionPoint("bottom", vec3(0, -heightM / 2, 0), vec3(0, -1, 0)),
      ],
    });
    world.addComponent({
      id: "mass",
      type: "test-mass",
      geometry: boxGeometry(vec3(0.3, 0.3, 0.3)),
      materialId: MaterialIds.StructuralSteel,
      transform: transform(vec3(0, heightM + 0.15, 0)),
      additionalMassKg: massOnTopKg,
      connectionPoints: [connectionPoint("bottom", vec3(0, -0.15, 0), vec3(0, -1, 0))],
    });
    world.connect(
      { componentId: "mass", connectionPointId: "bottom" },
      { componentId: "column", connectionPointId: "top" },
    );
    world.solve();
    return world;
  }

  it("buckles a slender column long before it yields", () => {
    // 50 mm square steel bar, 6 m tall, carrying about 3.7 t. Euler: P_cr = 28.6 kN.
    const world = slenderColumnWorld(6, 3500);
    const state = world.requireComponent("column").state.structural;

    expect(state.memberRole).toBe("column");
    expect(state.axialUtilization).toBeLessThan(0.1); // nowhere near yield...
    expect(state.bucklingUtilization).toBeGreaterThan(1); // ...but past Euler's limit.
    expect(state.governingMode).toBe("buckling");
    expect(state.status).toBe("failed");

    const failure = world.getSnapshot().failures.find((f) => f.failureType === "buckling");
    expect(failure).toBeDefined();
    expect(failure!.componentId).toBe("column");
    expect(failure!.cause).toContain("Euler");
    expect(failure!.limitValue).toBeCloseTo(state.criticalBucklingLoadN, 6);
  });

  it("holds the same load on a column a quarter of the height", () => {
    const world = slenderColumnWorld(1.5, 3500);
    expect(world.requireComponent("column").state.structural.status).toBe("normal");
  });

  it("buckles the copper legs of the overload rig in addition to yielding them", () => {
    const world = makeWorld();
    place(world, "structural-platform", { id: "platform", positionM: vec3(0, 4.1, 0) });
    for (const [socket, x, z] of [
      ["bottom-nx-nz", -2.7, -2.7],
      ["bottom-nx-pz", -2.7, 2.7],
      ["bottom-px-nz", 2.7, -2.7],
      ["bottom-px-pz", 2.7, 2.7],
    ] as const) {
      const legId = `leg-${socket}`;
      place(world, "structural-beam", {
        id: legId,
        transform: transform(vec3(x, 2, z), UPRIGHT),
        materialId: MaterialIds.Copper,
      });
      world.connect(
        { componentId: "platform", connectionPointId: socket },
        { componentId: legId, connectionPointId: "end-b" },
      );
    }
    place(world, "reactor-chamber", {
      id: "chamber",
      positionM: vec3(0, 5.7, 0),
      additionalMassKg: 110_000,
    });
    world.connect(
      { componentId: "chamber", connectionPointId: "base" },
      { componentId: "platform", connectionPointId: "top" },
    );
    world.solve();

    const leg = world.requireComponent("leg-bottom-nx-nz").state.structural;
    expect(leg.memberRole).toBe("column");
    // 150x150x8 SHS, 4 m: KL/r ~ 69, which is Johnson territory for annealed copper.
    expect(leg.slendernessRatio).toBeGreaterThan(60);
    expect(leg.slendernessRatio).toBeLessThan(80);
    expect(leg.bucklingUtilization).toBeGreaterThan(leg.axialUtilization);
    expect(leg.governingMode).toBe("buckling");

    // The platform spans 5.4 m between its legs and is checked in bending.
    const deck = world.requireComponent("platform").state.structural;
    expect(deck.memberRole).toBe("beam");
    expect(deck.bendingMomentNm).toBeGreaterThan(0);
    expect(deck.bendingUtilization).toBeLessThan(1);
  });

  it("fails a long thin plank in bending under a heavy central load", () => {
    const world = makeWorld();
    for (const [id, x] of [
      ["pier-l", -2.5],
      ["pier-r", 2.5],
    ] as const) {
      world.addComponent({
        id,
        type: "test-pier",
        geometry: boxGeometry(vec3(0.4, 1, 0.4)),
        materialId: MaterialIds.StructuralSteel,
        transform: transform(vec3(x, 0.5, 0)),
        connectionPoints: [connectionPoint("top", vec3(0, 0.5, 0), vec3(0, 1, 0))],
      });
    }
    // A 6 m x 50 mm x 300 mm aluminium plank laid flat across the piers.
    world.addComponent({
      id: "plank",
      type: "test-plank",
      geometry: boxGeometry(vec3(6, 0.05, 0.3)),
      materialId: MaterialIds.Aluminum,
      transform: transform(vec3(0, 1.025, 0)),
      connectionPoints: [
        connectionPoint("l", vec3(-2.5, -0.025, 0), vec3(0, -1, 0)),
        connectionPoint("r", vec3(2.5, -0.025, 0), vec3(0, -1, 0)),
        connectionPoint("mid", vec3(0, 0.025, 0), vec3(0, 1, 0)),
      ],
    });
    world.addComponent({
      id: "load",
      type: "test-mass",
      geometry: boxGeometry(vec3(0.3, 0.3, 0.3)),
      materialId: MaterialIds.StructuralSteel,
      transform: transform(vec3(0, 1.2, 0)),
      additionalMassKg: 3000,
      connectionPoints: [connectionPoint("bottom", vec3(0, -0.15, 0), vec3(0, -1, 0))],
    });
    world.connect(
      { componentId: "plank", connectionPointId: "l" },
      { componentId: "pier-l", connectionPointId: "top" },
    );
    world.connect(
      { componentId: "plank", connectionPointId: "r" },
      { componentId: "pier-r", connectionPointId: "top" },
    );
    world.connect(
      { componentId: "load", connectionPointId: "bottom" },
      { componentId: "plank", connectionPointId: "mid" },
    );
    world.solve();

    const plank = world.requireComponent("plank");
    const state = plank.state.structural;
    expect(state.memberRole).toBe("beam");
    expect(state.governingMode).toBe("bending");

    // Hand calculation: P L/4 + w L^2/8 over the 5 m span, S = b d^2 / 6.
    const loadN = world.requireComponent("load").massKg * g;
    const selfN = plank.massKg * g;
    const span = 5;
    // Self weight is spread over 6 m but only the 5 m span is between supports; the
    // overhangs relieve the mid-span moment slightly. Bound it from both sides.
    const upper = (loadN * span) / 4 + (selfN / 6) * (span ** 2 / 8);
    expect(state.bendingMomentNm).toBeLessThanOrEqual(upper + 1e-6);
    expect(state.bendingMomentNm).toBeGreaterThan((loadN * span) / 4);
    const S = (0.3 * 0.05 ** 2) / 6;
    expect(state.bendingStressPa).toBeCloseTo(state.bendingMomentNm / S, 3);
    expect(state.status).toBe("failed");

    const failure = world.getSnapshot().failures.find((f) => f.failureType === "bending_yield");
    expect(failure).toBeDefined();
    expect(failure!.cause).toContain("5.00 m span");
    expect(failure!.cause).toContain("Aluminum");
  });

  it("treats a stocky block as a block, not a column", () => {
    const world = makeWorld();
    place(world, "equipment-block", { id: "skid", positionM: vec3(0, 0.5, 0) });
    world.solve();
    const state = world.requireComponent("skid").state.structural;
    expect(state.memberRole).toBe("block");
    expect(state.bucklingUtilization).toBe(0);
    expect(state.bendingUtilization).toBe(0);
  });

  it("round-trips the effective length factor through a save file", async () => {
    const { deserializeWorld, serializeWorld } = await import("./index.js");
    const world = makeWorld({ bucklingEffectiveLengthFactor: 2 });
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored.settings.bucklingEffectiveLengthFactor).toBe(2);
  });
});
