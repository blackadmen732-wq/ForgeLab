import { describe, expect, it } from "vitest";
import { MaterialIds } from "@forgelab/materials";
import { QuaternionMath, STANDARD_GRAVITY_MPS2, transform, vec3 } from "@forgelab/shared";
import { makeWorld, place, placeBlock, stack } from "@forgelab/test-utils";

const g = STANDARD_GRAVITY_MPS2;

describe("structural load propagation", () => {
  // REQUIRED TEST 4
  it("transfers load from one structural element into the one below it", () => {
    const world = makeWorld();
    // 1 m steel cube on a 1 m steel cube; the lower one is pinned in place.
    placeBlock(world, { id: "lower", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "upper", positionM: vec3(0, 1.5, 0) });
    stack(world, "lower", "upper", { id: "joint" });
    world.solve();

    const upper = world.requireComponent("upper");
    const lower = world.requireComponent("lower");
    const upperWeightN = 7850 * g;

    expect(upper.state.support.mode).toBe("supported");
    expect(upper.state.support.supportedByComponentIds).toEqual(["lower"]);
    expect(upper.state.support.carriedLoadN).toBe(0);
    expect(upper.state.support.totalLoadN).toBeCloseTo(upperWeightN, 6);

    // The whole of the upper block's weight crosses the single joint...
    expect(upper.state.support.reactions).toHaveLength(1);
    expect(upper.state.support.reactions[0]!.connectionId).toBe("joint");
    expect(upper.state.support.reactions[0]!.loadN).toBeCloseTo(upperWeightN, 6);

    // ...and arrives as carried load on the lower block, on top of its own weight.
    expect(lower.state.support.supportingComponentIds).toEqual(["upper"]);
    expect(lower.state.support.carriedLoadN).toBeCloseTo(upperWeightN, 6);
    expect(lower.state.support.totalLoadN).toBeCloseTo(2 * upperWeightN, 6);

    // Stress is that total over the 1 m x 1 m section.
    expect(lower.state.structural.loadBearingAreaM2).toBeCloseTo(1, 12);
    expect(lower.state.structural.appliedStressPa).toBeCloseTo(2 * upperWeightN, 6);
  });

  it("carries load through a three-element chain, accumulating downward", () => {
    const world = makeWorld();
    placeBlock(world, { id: "a-base", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "b-mid", positionM: vec3(0, 1.5, 0) });
    placeBlock(world, { id: "c-top", positionM: vec3(0, 2.5, 0) });
    stack(world, "a-base", "b-mid", { id: "joint-ab" });
    stack(world, "b-mid", "c-top", { id: "joint-bc" });
    world.solve();

    const weightN = 7850 * g;
    expect(world.requireComponent("c-top").state.support.totalLoadN).toBeCloseTo(weightN, 6);
    expect(world.requireComponent("b-mid").state.support.totalLoadN).toBeCloseTo(2 * weightN, 6);
    expect(world.requireComponent("a-base").state.support.totalLoadN).toBeCloseTo(3 * weightN, 6);
  });

  it("splits a centred load evenly between two supports", () => {
    const world = makeWorld();
    // Two legs 4 m apart, a deck centred between them.
    placeBlock(world, {
      id: "leg-l",
      positionM: vec3(-2, 1, 0),
      sizeM: vec3(0.3, 2, 0.3),
      anchored: true,
    });
    placeBlock(world, {
      id: "leg-r",
      positionM: vec3(2, 1, 0),
      sizeM: vec3(0.3, 2, 0.3),
      anchored: true,
    });
    const deck = world.addComponent({
      id: "deck",
      type: "test-deck",
      geometry: { kind: "box", sizeM: vec3(5, 0.2, 1) },
      materialId: MaterialIds.StructuralSteel,
      transform: transform(vec3(0, 2.1, 0)),
      connectionPoints: [
        {
          id: "l",
          localPosition: vec3(-2, -0.1, 0),
          localDirection: vec3(0, -1, 0),
          connectionType: "structural",
        },
        {
          id: "r",
          localPosition: vec3(2, -0.1, 0),
          localDirection: vec3(0, -1, 0),
          connectionType: "structural",
        },
      ],
    });
    world.connect(
      { componentId: deck.id, connectionPointId: "l" },
      { componentId: "leg-l", connectionPointId: "top" },
      { id: "j-l" },
    );
    world.connect(
      { componentId: deck.id, connectionPointId: "r" },
      { componentId: "leg-r", connectionPointId: "top" },
      { id: "j-r" },
    );
    world.solve();

    const reactions = world.requireComponent("deck").state.support.reactions;
    expect(reactions).toHaveLength(2);
    const [left, right] = reactions;
    expect(left!.loadN).toBeCloseTo(right!.loadN, 6);
    expect(left!.loadN + right!.loadN).toBeCloseTo(
      world.requireComponent("deck").state.support.totalLoadN,
      6,
    );
  });

  it("applies the lever rule when the load sits off-centre", () => {
    const world = makeWorld();
    placeBlock(world, {
      id: "leg-l",
      positionM: vec3(-3, 1, 0),
      sizeM: vec3(0.3, 2, 0.3),
      anchored: true,
    });
    placeBlock(world, {
      id: "leg-r",
      positionM: vec3(1, 1, 0),
      sizeM: vec3(0.3, 2, 0.3),
      anchored: true,
    });
    // Deck centre of mass sits 3 m from the left leg and 1 m from the right leg.
    const deck = world.addComponent({
      id: "deck",
      type: "test-deck",
      geometry: { kind: "box", sizeM: vec3(9, 0.2, 1) },
      materialId: MaterialIds.StructuralSteel,
      transform: transform(vec3(0, 2.1, 0)),
      connectionPoints: [
        {
          id: "l",
          localPosition: vec3(-3, -0.1, 0),
          localDirection: vec3(0, -1, 0),
          connectionType: "structural",
        },
        {
          id: "r",
          localPosition: vec3(1, -0.1, 0),
          localDirection: vec3(0, -1, 0),
          connectionType: "structural",
        },
      ],
    });
    world.connect(
      { componentId: deck.id, connectionPointId: "l" },
      { componentId: "leg-l", connectionPointId: "top" },
      { id: "j-l" },
    );
    world.connect(
      { componentId: deck.id, connectionPointId: "r" },
      { componentId: "leg-r", connectionPointId: "top" },
      { id: "j-r" },
    );
    world.solve();

    const total = world.requireComponent("deck").state.support.totalLoadN;
    const byId = new Map(
      world.requireComponent("deck").state.support.reactions.map((r) => [r.connectionId, r.loadN]),
    );

    // Statics: R_left = W * b / (a + b) with a = 3 m, b = 1 m.
    expect(byId.get("j-l")!).toBeCloseTo(total * (1 / 4), 6);
    expect(byId.get("j-r")!).toBeCloseTo(total * (3 / 4), 6);
    expect(byId.get("j-l")! + byId.get("j-r")!).toBeCloseTo(total, 6);
  });

  it("reports a component with no support and no ground contact as free", () => {
    const world = makeWorld();
    placeBlock(world, { id: "floating", positionM: vec3(0, 30, 0) });
    world.solve();

    const floating = world.requireComponent("floating");
    expect(floating.state.support.mode).toBe("free");
    // Nothing is bearing on it, so it is not stressed: it is simply falling.
    expect(floating.state.structural.appliedStressPa).toBe(0);
    expect(floating.state.structural.utilization).toBe(0);
  });

  it("does not treat a component resting on an unsupported one as supported", () => {
    const world = makeWorld();
    placeBlock(world, { id: "floating", positionM: vec3(0, 30, 0) });
    placeBlock(world, { id: "on-top", positionM: vec3(0, 31, 0) });
    stack(world, "floating", "on-top");
    world.solve();

    expect(world.requireComponent("floating").state.support.mode).toBe("free");
    expect(world.requireComponent("on-top").state.support.mode).toBe("free");
  });

  it("orients a joint from the socket normals, not from component ordering", () => {
    const world = makeWorld();
    placeBlock(world, { id: "z-lower", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "a-upper", positionM: vec3(0, 1.5, 0) });
    // Connect "upper first" so that alphabetical ordering disagrees with physical stacking.
    world.connect(
      { componentId: "a-upper", connectionPointId: "bottom" },
      { componentId: "z-lower", connectionPointId: "top" },
    );
    world.solve();

    expect(world.requireComponent("a-upper").state.support.supportedByComponentIds).toEqual([
      "z-lower",
    ]);
    expect(world.requireComponent("z-lower").state.support.carriedLoadN).toBeGreaterThan(0);
  });

  it("keeps utilization classification on the documented thresholds", () => {
    const world = makeWorld();
    const solvedUtilization = (additionalMassKg: number) => {
      const w = makeWorld();
      placeBlock(w, { id: "column", positionM: vec3(0, 0.5, 0), additionalMassKg });
      w.solve();
      return w.requireComponent("column").state.structural;
    };

    // Steel yield 250 MPa over a 1 m^2 section => 250 MN of capacity.
    const normal = solvedUtilization(0);
    expect(normal.utilization).toBeLessThan(0.7);
    expect(normal.status).toBe("normal");

    const stressed = solvedUtilization(20e6);
    expect(stressed.utilization).toBeGreaterThanOrEqual(0.7);
    expect(stressed.utilization).toBeLessThanOrEqual(1);
    expect(stressed.status).toBe("stressed");

    const failed = solvedUtilization(30e6);
    expect(failed.utilization).toBeGreaterThan(1);
    expect(failed.status).toBe("failed");
    expect(world.getSnapshot().diagnostics).toEqual([]);
  });
});

describe("failure events", () => {
  // REQUIRED TEST 5
  it("raises a structured FailureEvent when a joint is loaded past its rating", () => {
    const world = makeWorld();
    placeBlock(world, { id: "base", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "load", positionM: vec3(0, 1.5, 0) });
    // The 1 m steel cube above weighs about 76.98 kN; rate the joint far below that.
    stack(world, "base", "load", { id: "weak-joint", maxLoadN: 10_000 });
    world.solve();

    const failures = world
      .getSnapshot()
      .failures.filter((f) => f.failureType === "connection_overload");
    expect(failures).toHaveLength(1);

    const failure = failures[0]!;
    expect(failure.system).toBe("structural");
    expect(failure.componentId).toBe("load");
    expect(failure.connectionId).toBe("weak-joint");
    expect(failure.unit).toBe("N");
    expect(failure.limitValue).toBe(10_000);
    expect(failure.measuredValue).toBeCloseTo(7850 * g, 6);
    expect(failure.utilization).toBeCloseTo((7850 * g) / 10_000, 9);
    expect(failure.timestampSec).toBe(0);
    expect(failure.tick).toBe(0);

    // The explanation names the parts, the load and the limit - never a bare "FAILED".
    expect(failure.cause).toContain("weak-joint");
    expect(failure.cause).toContain("load");
    expect(failure.cause).toContain("base");
    expect(failure.cause).toMatch(/exceeding its rated capacity/);
  });

  it("raises a yield failure that explains the whole load chain", () => {
    const world = makeWorld();
    placeBlock(world, {
      id: "column",
      positionM: vec3(0, 0.5, 0),
      sizeM: vec3(0.1, 1, 0.1),
      anchored: true,
    });
    placeBlock(world, {
      id: "mass",
      positionM: vec3(0, 1.5, 0),
      sizeM: vec3(1, 1, 1),
      materialId: MaterialIds.Tungsten,
      additionalMassKg: 500_000,
    });
    stack(world, "column", "mass");
    world.solve();

    const failure = world
      .getSnapshot()
      .failures.find((f) => f.failureType === "yield_exceeded" && f.componentId === "column");
    expect(failure).toBeDefined();
    expect(failure!.unit).toBe("Pa");
    // 100 mm square column of structural steel: 0.01 m^2 at 250 MPa.
    expect(failure!.limitValue).toBeCloseTo(250e6, 3);
    expect(failure!.measuredValue).toBeGreaterThan(250e6);
    expect(failure!.loadPathComponentIds).toContain("mass");
    expect(failure!.cause).toContain("Structural Steel");
    expect(failure!.cause).toContain("mass");
    expect(failure!.cause).toMatch(/compressive stress/);
  });

  it("raises each distinct failure once, not once per tick", () => {
    const world = makeWorld();
    placeBlock(world, { id: "base", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "load", positionM: vec3(0, 1.5, 0) });
    stack(world, "base", "load", { id: "weak-joint", maxLoadN: 10_000 });

    world.stepMany(120);
    const overloads = world
      .getSnapshot()
      .failures.filter((f) => f.failureType === "connection_overload");
    expect(overloads).toHaveLength(1);
  });

  it("clears the failure log on reset", () => {
    const world = makeWorld();
    placeBlock(world, { id: "base", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "load", positionM: vec3(0, 1.5, 0) });
    stack(world, "base", "load", { id: "weak-joint", maxLoadN: 10_000 });
    world.stepMany(10);
    expect(world.getSnapshot().failures.length).toBeGreaterThan(0);

    world.reset();
    expect(world.tick).toBe(0);
    // Reset re-solves at t = 0, so a standing overload is reported again from scratch.
    expect(world.getSnapshot().failures.every((f) => f.tick === 0)).toBe(true);
  });

  it("drops what a yielded member was holding when failure propagation is set to detach", () => {
    const world = makeWorld({ failurePropagation: "detach" });
    // A tall column so the released mass is still in the air after half a second.
    placeBlock(world, {
      id: "column",
      positionM: vec3(0, 2, 0),
      sizeM: vec3(0.05, 4, 0.05),
      anchored: true,
    });
    placeBlock(world, {
      id: "mass",
      positionM: vec3(0, 4.5, 0),
      materialId: MaterialIds.Tungsten,
      additionalMassKg: 2_000_000,
    });
    stack(world, "column", "mass");

    world.solve();
    expect(world.requireComponent("column").state.structural.failed).toBe(true);

    const startY = world.requireComponent("mass").state.physical.positionM.y;
    world.stepMany(30);
    expect(world.requireComponent("mass").state.support.mode).toBe("free");
    expect(world.requireComponent("mass").state.physical.positionM.y).toBeLessThan(startY);
  });
});

describe("built-in components under load", () => {
  it("fails copper legs under a heavily loaded reactor chamber and explains why", () => {
    const world = makeWorld();
    const legRotation = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
    const corners = [
      ["bottom-nx-nz", -2.7, -2.7],
      ["bottom-nx-pz", -2.7, 2.7],
      ["bottom-px-nz", 2.7, -2.7],
      ["bottom-px-pz", 2.7, 2.7],
    ] as const;

    place(world, "structural-platform", { id: "platform", positionM: vec3(0, 4.1, 0) });
    for (const [socket, x, z] of corners) {
      const legId = `leg-${socket}`;
      place(world, "structural-beam", {
        id: legId,
        transform: transform(vec3(x, 2, z), legRotation),
        materialId: MaterialIds.Copper,
      });
      world.connect(
        { componentId: "platform", connectionPointId: socket },
        { componentId: legId, connectionPointId: "end-b" },
      );
    }
    place(world, "reactor-chamber", { id: "chamber", positionM: vec3(0, 5.7, 0) });
    world.connect(
      { componentId: "chamber", connectionPointId: "base" },
      { componentId: "platform", connectionPointId: "top" },
    );

    world.solve();
    const legBefore = world.requireComponent("leg-bottom-nx-nz").state.structural;
    expect(legBefore.status).toBe("normal");
    expect(world.getSnapshot().failures).toHaveLength(0);

    // Fill the vessel until the copper legs give way.
    world.setAdditionalMass("chamber", 110_000);
    world.solve();

    const legAfter = world.requireComponent("leg-bottom-nx-nz").state.structural;
    expect(legAfter.status).toBe("failed");
    expect(legAfter.utilization).toBeGreaterThan(1);

    const yieldFailure = world
      .getSnapshot()
      .failures.find(
        (f) => f.failureType === "yield_exceeded" && f.componentId === "leg-bottom-nx-nz",
      );
    expect(yieldFailure).toBeDefined();
    expect(yieldFailure!.cause).toContain("Copper");
    expect(yieldFailure!.loadPathComponentIds).toContain("platform");
    expect(yieldFailure!.loadPathComponentIds).toContain("chamber");
  });

  it("holds the same assembly with steel legs", () => {
    const world = makeWorld();
    const legRotation = QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2);
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
        transform: transform(vec3(x, 2, z), legRotation),
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

    expect(world.requireComponent("leg-bottom-nx-nz").state.structural.status).toBe("normal");
    expect(world.getSnapshot().failures).toHaveLength(0);
  });
});
