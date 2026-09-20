import { describe, expect, it } from "vitest";
import { MaterialIds } from "@forgelab/materials";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { fingerprintSnapshot, makeWorld, place, placeBlock, stack } from "@forgelab/test-utils";
import {
  AssemblyFileError,
  CURRENT_SCHEMA_VERSION,
  fromJson,
  parseAssemblyFile,
  serializeWorld,
  toJson,
  worldFromJson,
  type SimulationWorld,
} from "./index.js";

function buildAssembly(): SimulationWorld {
  const world = makeWorld({ designSafetyFactor: 1.5, gravityMps2: 9.80665 });
  world.name = "Test Rig";

  placeBlock(world, { id: "pedestal", positionM: vec3(0, 0.5, 0), anchored: true });
  placeBlock(world, {
    id: "load",
    positionM: vec3(0, 1.5, 0),
    materialId: MaterialIds.Tungsten,
    additionalMassKg: 125.5,
  });
  stack(world, "pedestal", "load", { id: "joint", maxLoadN: 2.5e6 });

  place(world, "structural-beam", {
    id: "beam",
    transform: transform(vec3(6, 3, -2), QuaternionMath.fromAxisAngle(vec3(0, 0, 1), 0.4)),
  });
  place(world, "reactor-chamber", {
    id: "vessel",
    positionM: vec3(-8, 20, 4),
    additionalMassKg: 9_000,
  });
  return world;
}

describe("save format", () => {
  it("writes the documented shape at the current schema version", () => {
    const file = serializeWorld(buildAssembly());
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(file.name).toBe("Test Rig");
    expect(file.components).toHaveLength(4);
    expect(file.connections).toHaveLength(1);
    expect(file.simulationSettings.gravityMps2).toBe(9.80665);
    expect(file.simulationSettings.fixedTimestepSec).toBeCloseTo(1 / 60, 15);
    expect(file.simulationSettings.designSafetyFactor).toBe(1.5);
  });

  it("stores no derived state, so a file can never disagree with the solver", () => {
    const world = buildAssembly();
    world.solve();
    const raw = JSON.parse(toJson(world)) as Record<string, unknown>;
    const serialized = JSON.stringify(raw);

    for (const derived of ["utilization", "appliedStressPa", "totalLoadN", "supportMode"]) {
      expect(serialized).not.toContain(derived);
    }
  });

  // REQUIRED TEST 10
  it("preserves component state across serialization and deserialization", () => {
    const original = buildAssembly();
    // Run far enough that parts have moved and picked up velocity.
    original.stepMany(45);
    const before = original.getSnapshot();

    const restored = worldFromJson(toJson(original));
    const after = restored.getSnapshot();

    expect(after.tick).toBe(before.tick);
    expect(after.simulatedTimeSec).toBeCloseTo(before.simulatedTimeSec, 15);
    expect(after.components).toHaveLength(before.components.length);
    expect(after.connections).toHaveLength(before.connections.length);

    for (const [index, expected] of before.components.entries()) {
      const actual = after.components[index]!;
      expect(actual.id).toBe(expected.id);
      expect(actual.type).toBe(expected.type);
      expect(actual.label).toBe(expected.label);
      expect(actual.materialId).toBe(expected.materialId);
      expect(actual.anchored).toBe(expected.anchored);
      expect(actual.additionalMassKg).toBe(expected.additionalMassKg);
      expect(actual.massKg).toBeCloseTo(expected.massKg, 12);
      expect(actual.geometry).toEqual(expected.geometry);
      expect(actual.transform).toEqual(expected.transform);
      expect(actual.connectionPoints).toEqual(expected.connectionPoints);

      // The live kinematic state, which is what actually changed during the run.
      expect(actual.state.physical).toEqual(expected.state.physical);

      // ...and the derived state, recomputed rather than restored, agrees.
      expect(actual.state.support.mode).toBe(expected.state.support.mode);
      expect(actual.state.support.totalLoadN).toBeCloseTo(expected.state.support.totalLoadN, 9);
      expect(actual.state.structural.utilization).toBeCloseTo(
        expected.state.structural.utilization,
        12,
      );
      expect(actual.state.structural.status).toBe(expected.state.structural.status);
    }

    expect(after.assembly.totalMassKg).toBeCloseTo(before.assembly.totalMassKg, 9);
    expect(fingerprintSnapshot(after)).toBe(fingerprintSnapshot(before));
  });

  it("keeps running identically after a save and load mid-run", () => {
    const original = buildAssembly();
    original.stepMany(30);
    const restored = worldFromJson(toJson(original));

    original.stepMany(90);
    restored.stepMany(90);

    expect(fingerprintSnapshot(restored.getSnapshot())).toBe(
      fingerprintSnapshot(original.getSnapshot()),
    );
  });

  it("round-trips an untouched assembly without writing kinematic state at all", () => {
    const world = buildAssembly();
    const file = serializeWorld(world);
    // Nothing has moved yet, so the authored transform is the whole story.
    expect(file.components.every((component) => component.physical === undefined)).toBe(true);
    expect(fingerprintSnapshot(worldFromJson(toJson(world)).getSnapshot())).toBe(
      fingerprintSnapshot(world.getSnapshot()),
    );
  });

  it("round-trips connection ratings and socket capacities", () => {
    const restored = worldFromJson(toJson(buildAssembly()));
    const connection = restored.listConnections()[0]!;
    expect(connection.id).toBe("joint");
    expect(connection.maxLoadN).toBe(2.5e6);

    const beam = restored.requireComponent("beam");
    const endSocket = beam.connectionPoints.find((point) => point.id === "end-a")!;
    expect(endSocket.maxLoadN).toBeGreaterThan(0);
    expect(endSocket.connectionType).toBe("structural");
    expect(beam.connectionPoints.find((p) => p.id === "top")!.connectionType).toBe("structural");
  });

  it("round-trips a mount-type socket unchanged", () => {
    const restored = worldFromJson(toJson(buildAssembly()));
    const port = restored
      .requireComponent("vessel")
      .connectionPoints.find((p) => p.id === "port-nx")!;
    expect(port.connectionType).toBe("mount");
    // Mount sockets carry no invented capacity.
    expect(port.maxLoadN).toBeUndefined();
  });

  it("re-derives a standing failure on load", () => {
    const world = makeWorld();
    placeBlock(world, { id: "base", positionM: vec3(0, 0.5, 0), anchored: true });
    placeBlock(world, { id: "load", positionM: vec3(0, 1.5, 0) });
    stack(world, "base", "load", { id: "weak", maxLoadN: 1_000 });
    world.stepMany(20);
    expect(world.getSnapshot().failures).toHaveLength(1);

    const restored = worldFromJson(toJson(world));
    const failures = restored.getSnapshot().failures;
    expect(failures).toHaveLength(1);
    expect(failures[0]!.failureType).toBe("connection_overload");
    expect(failures[0]!.tick).toBe(20);
  });

  it("accepts the minimal documented example file", () => {
    const file = parseAssemblyFile({
      schemaVersion: 1,
      name: "Test Assembly",
      components: [],
      connections: [],
      simulationSettings: { gravityMps2: 9.80665 },
    });
    expect(file.name).toBe("Test Assembly");
    expect(file.simulationSettings.gravityMps2).toBe(9.80665);
    // Unstated settings fall back to documented defaults rather than to zero.
    expect(file.simulationSettings.fixedTimestepSec).toBeCloseTo(1 / 60, 15);
    expect(file.simulationSettings.designSafetyFactor).toBe(1);
  });

  it("refuses a file from a newer ForgeLab instead of silently misreading it", () => {
    expect(() =>
      parseAssemblyFile({
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        name: "From the future",
        components: [],
        connections: [],
        simulationSettings: {},
      }),
    ).toThrowError(/Update ForgeLab/);
  });

  it("reports what is wrong with a malformed file", () => {
    expect(() => parseAssemblyFile(null)).toThrowError(AssemblyFileError);
    expect(() => parseAssemblyFile({})).toThrowError(/schemaVersion/);
    expect(() => fromJson("{not json")).toThrowError(/not valid JSON/);

    expect(() =>
      parseAssemblyFile({
        schemaVersion: 1,
        name: "Broken",
        components: [],
        connections: [
          {
            id: "dangling",
            type: "structural",
            from: { componentId: "ghost", connectionPointId: "top" },
            to: { componentId: "ghost2", connectionPointId: "bottom" },
          },
        ],
        simulationSettings: {},
      }),
    ).toThrowError(/unknown component/);

    expect(() =>
      parseAssemblyFile({
        schemaVersion: 1,
        name: "Bad geometry",
        components: [
          {
            id: "x",
            type: "test",
            materialId: "structural-steel",
            geometry: { kind: "pyramid" },
            transform: { positionM: { x: 0, y: 0, z: 0 } },
            connectionPoints: [],
            additionalMassKg: 0,
            anchored: false,
          },
        ],
        connections: [],
        simulationSettings: {},
      }),
    ).toThrowError(/must be "box" or "cylinder"/);
  });

  it("rejects duplicate component ids", () => {
    const duplicate = {
      id: "same",
      type: "test",
      materialId: "structural-steel",
      geometry: { kind: "box", sizeM: { x: 1, y: 1, z: 1 } },
      transform: { positionM: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      connectionPoints: [],
      additionalMassKg: 0,
      anchored: false,
    };
    expect(() =>
      parseAssemblyFile({
        schemaVersion: 1,
        name: "Dupes",
        components: [duplicate, duplicate],
        connections: [],
        simulationSettings: {},
      }),
    ).toThrowError(/duplicate component ids/);
  });

  it("writes stable JSON: the same world always serializes to the same bytes", () => {
    const a = toJson(buildAssembly());
    const b = toJson(buildAssembly());
    expect(a).toBe(b);
  });

  it("records provenance metadata without letting it affect the simulation", () => {
    const withMeta = serializeWorld(buildAssembly(), {
      generator: "forgelab-test",
      savedAtIso: "2026-01-01T00:00:00.000Z",
    });
    expect(withMeta.meta?.generator).toBe("forgelab-test");

    const stripped = { ...withMeta, meta: undefined };
    expect(fingerprintSnapshot(worldFromJson(JSON.stringify(stripped)).getSnapshot())).toBe(
      fingerprintSnapshot(worldFromJson(JSON.stringify(withMeta)).getSnapshot()),
    );
  });
});
