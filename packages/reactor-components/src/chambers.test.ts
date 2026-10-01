import { describe, expect, it } from "vitest";
import {
  SimulationWorld,
  buildTopology,
  deserializeWorld,
  geometryInteriorVolumeM3,
  preflight,
  serializeWorld,
  torusGeometry,
  type VesselLayout,
} from "@forgelab/sim-core";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { placePart } from "./designs.js";

/**
 * Free-form vacuum chambers: what a chamber is comes from how its segments join, never
 * from a reactor-type name.
 */
const Y = 3;
const R = 4;

/** `count` bends of 360°/count, arrayed round the vertical axis and joined flange to flange. */
function ring(world: SimulationWorld, count = 8, options: { skipJoint?: number } = {}) {
  const sweepDeg = 360 / count;
  for (let k = 0; k < count; k += 1) {
    const phi = (2 * Math.PI * k) / count;
    placePart(world, "chamber-bend", {
      id: `seg-${k}`,
      transform: transform(
        vec3(R * Math.cos(phi), Y, -R * Math.sin(phi)),
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), phi),
      ),
      dimensions: { bendRadiusM: R, sweepDeg },
    });
    world.setAnchored(`seg-${k}`, true);
  }
  for (let k = 0; k < count; k += 1) {
    if (k === options.skipJoint) continue;
    world.connect(
      { componentId: `seg-${k}`, connectionPointId: "flange-b" },
      { componentId: `seg-${(k + 1) % count}`, connectionPointId: "flange-a" },
    );
  }
}

function layoutOf(world: SimulationWorld): VesselLayout {
  const topology = buildTopology(world.getSnapshot().components, world.listConnections());
  expect(topology.vessels).toHaveLength(1);
  return topology.vessels[0]!;
}

const vesselState = (world: SimulationWorld, id = "seg-0") =>
  world.getSnapshot().components.find((c) => c.id === id)!.state.plant.vessel!;

const codes = (world: SimulationWorld) =>
  preflight(world.getSnapshot().components, world.listConnections()).items.map((i) => i.code);

/** Grid, bus, cryopump, injector and neutral beam on the lead segment's spare ports. */
function services(world: SimulationWorld, chamberId: string) {
  placePart(world, "grid-connection", { id: "grid", position: vec3(20, 1.2, 8) });
  placePart(world, "bus-bar", { id: "bus", position: vec3(16, 0.05, 4) });
  placePart(world, "vacuum-pump", { id: "pump", position: vec3(12, 1, 2) });
  placePart(world, "fuel-injector", { id: "injector", position: vec3(12, 0.7, -2) });
  placePart(world, "neutral-beam", { id: "nbi", position: vec3(12, 1.2, -8) });
  const join = (a: [string, string], b: [string, string]) =>
    world.connect(
      { componentId: a[0], connectionPointId: a[1] },
      { componentId: b[0], connectionPointId: b[1] },
    );
  join(["grid", "power"], ["bus", "b"]);
  for (const id of ["pump", "injector", "nbi"]) join([id, "power"], ["bus", "a"]);
  join(["pump", "vacuum"], [chamberId, "vacuum"]);
  join(["injector", "fuel"], [chamberId, "fuel"]);
  join(["nbi", "port"], [chamberId, "heating"]);
}

describe("assembled chambers", () => {
  it("eight 45° bends joined round an axis close into one toroidal chamber", () => {
    const world = new SimulationWorld({ name: "Ring" });
    ring(world);
    world.solve();
    const layout = layoutOf(world);
    expect(layout.vesselId).toBe("seg-0");
    expect(layout.chamber.memberIds).toHaveLength(8);
    expect(layout.chamber.path).toBe("loop");
    expect(layout.configuration).toBe("tokamak");
    // 8 × R·π/4 of centreline = 2πR: the ring's major radius is the bend radius.
    expect(layout.chamber.majorRadiusM).toBeCloseTo(R, 9);
    expect(layout.chamber.departureM).toBeLessThan(1e-6);
    expect(layout.chamber.regular).toBe(true);
    expect(layout.chamber.openings).toHaveLength(0);
    // One vacuum: the volume is the whole ring's, the same as a torus of the same size.
    const bend = world.getSnapshot().components.find((c) => c.id === "seg-0")!.geometry;
    if (bend.kind !== "arc") throw new Error("expected an arc");
    const torus = torusGeometry(R, bend.radiusM, "y", bend.wallThicknessM);
    expect(vesselState(world).interiorVolumeM3).toBeCloseTo(geometryInteriorVolumeM3(torus), 6);
    expect(codes(world)).not.toContain("OPEN_CHAMBER");
  });

  it("one unjoined flange pair is an opening: the chamber cannot be pumped down", () => {
    const sealed = new SimulationWorld({ name: "Sealed" });
    ring(sealed);
    services(sealed, "seg-0");
    const open = new SimulationWorld({ name: "Open" });
    ring(open, 8, { skipJoint: 3 });
    services(open, "seg-0");
    for (const w of [sealed, open]) w.stepMany(600);

    const layout = layoutOf(open);
    expect(layout.chamber.path).toBe("chain");
    expect(layout.chamber.openings.map((o) => `${o.componentId}/${o.connectionPointId}`)).toEqual([
      "seg-3/flange-b",
      "seg-4/flange-a",
    ]);
    expect(vesselState(sealed).pressurePa).toBeLessThan(1);
    expect(vesselState(open).pressurePa).toBeGreaterThan(1e4);
    expect(codes(open)).toContain("OPEN_CHAMBER");
    // The open flanges are reported once, as an opening, not as forgotten ports; spare
    // service ports are blanked, not forgotten.
    const unconnected = preflight(open.getSnapshot().components, open.listConnections())
      .items.filter((i) => i.code === "UNCONNECTED_PORT")
      .map((i) => i.message)
      .join(" ");
    expect(unconnected).not.toMatch(/CHAMBER FLANGE|PUMPING PORT|DIAGNOSTICS/);
  });

  it("an assembled ring with a ring of coils round it makes a plasma", () => {
    const world = new SimulationWorld({ name: "Built ring" });
    ring(world);
    services(world, "seg-0");
    const coils = 16;
    for (let k = 0; k < coils; k += 1) {
      const phi = (2 * Math.PI * (k + 0.5)) / coils;
      placePart(world, "circular-coil", {
        id: `coil-${k}`,
        transform: transform(
          vec3(R * Math.cos(phi), Y, -R * Math.sin(phi)),
          QuaternionMath.fromAxisAngle(vec3(0, 1, 0), phi),
        ),
        // Sized to sit round the 1 m tube, with a case thick enough for its own hoop
        // force at 5 MA-turns (the 60 mm default overstresses at this radius).
        dimensions: { ringRadiusM: 1.5, windingRadiusM: 0.2, wallM: 0.12 },
      });
      world.setAnchored(`coil-${k}`, true);
      world.connect(
        { componentId: `coil-${k}`, connectionPointId: "power" },
        { componentId: "bus", connectionPointId: "a" },
      );
    }
    world.solve();
    const phases = new Set<string>();
    for (let s = 0; s < 40; s += 1) {
      world.stepMany(60);
      phases.add(vesselState(world).plasma.phase);
    }
    const state = vesselState(world);
    expect(state.plasma.fieldT).toBeGreaterThan(1);
    expect(state.plasma.majorRadiusM).toBeCloseTo(R, 6);
    expect([...phases].some((p) => p !== "off")).toBe(true);
    expect(
      world
        .getSnapshot()
        .failures.map((f) => f.summary)
        .join("\n"),
    ).not.toMatch(/casing/);
    const plasma = world
      .getSnapshot()
      .plant.confidence.subsystems.find((s) => s.subsystem === "plasma:seg-0")!;
    expect(plasma.reasons.join(" ")).toMatch(/assembled from 8 segments/);
  });

  it("a capped column of straight segments is a linear chamber", () => {
    const world = new SimulationWorld({ name: "Column" });
    placePart(world, "chamber-end-cap", {
      id: "cap-a",
      transform: transform(vec3(0, Y, -2.15), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), 0)),
    });
    placePart(world, "chamber-straight", { id: "tube-1", position: vec3(0, Y, -1) });
    placePart(world, "chamber-straight", { id: "tube-2", position: vec3(0, Y, 1) });
    placePart(world, "chamber-end-cap", {
      id: "cap-b",
      transform: transform(vec3(0, Y, 2.15), QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI)),
    });
    const join = (a: string, ap: string, b: string, bp: string) =>
      world.connect(
        { componentId: a, connectionPointId: ap },
        { componentId: b, connectionPointId: bp },
      );
    join("cap-a", "flange", "tube-1", "flange-a");
    join("tube-1", "flange-b", "tube-2", "flange-a");
    join("tube-2", "flange-b", "cap-b", "flange");
    world.solve();
    const layout = layoutOf(world);
    expect(layout.vesselId).toBe("cap-a");
    expect(layout.chamber.path).toBe("chain");
    expect(layout.configuration).toBe("linear");
    expect(layout.chamber.openings).toHaveLength(0);
    expect(layout.chamber.regular).toBe(true);
    expect(layout.chamber.lengthM).toBeCloseTo(4.6, 9);
  });

  it("a branched chamber has its vacuum computed and its plasma declared unsupported", () => {
    const world = new SimulationWorld({ name: "Branched" });
    placePart(world, "tokamak-vessel", { id: "vessel", position: vec3(0, 4.35, 0) });
    // A duct segment bolted straight onto the vessel's pumping port.
    const vessel = world.getSnapshot().components.find((c) => c.id === "vessel")!;
    const port = vessel.connectionPoints.find((p) => p.id === "vacuum")!;
    placePart(world, "chamber-straight", {
      id: "duct",
      transform: transform(
        vec3(port.localPosition.x + 1, 4.35 + port.localPosition.y, port.localPosition.z),
        QuaternionMath.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
      ),
    });
    world.connect(
      { componentId: "vessel", connectionPointId: "vacuum" },
      { componentId: "duct", connectionPointId: "flange-a" },
    );
    services(world, "duct");
    world.stepMany(30);
    const layout = layoutOf(world);
    expect(layout.chamber.path).toBe("branched");
    expect(layout.configuration).toBe("none");
    const confidence = world.getSnapshot().plant.confidence;
    expect(confidence.level).toBe("unsupported");
    expect(codes(world)).toContain("BRANCHED_CHAMBER");
    // The lead is the lowest id; the vacuum is the vessel's and the duct's together.
    expect(layout.vesselId).toBe("duct");
    expect(vesselState(world, "duct").interiorVolumeM3).toBeGreaterThan(0);
  });

  it("round-trips through a save file and runs identically", () => {
    const a = new SimulationWorld({ name: "Ring" });
    ring(a);
    services(a, "seg-0");
    const b = deserializeWorld(serializeWorld(a));
    a.stepMany(120);
    b.stepMany(120);
    expect(vesselState(b).pressurePa).toBe(vesselState(a).pressurePa);
    expect(layoutOf(b).chamber.path).toBe("loop");
  });
});
