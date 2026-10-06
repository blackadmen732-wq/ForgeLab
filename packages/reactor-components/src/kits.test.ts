import { describe, expect, it } from "vitest";
import {
  SimulationWorld,
  extractAssembly,
  insertAssembly,
  type SimulationSnapshot,
} from "@forgelab/sim-core";
import { QuaternionMath, transform, vec3 } from "@forgelab/shared";
import { TOKAMAK_CENTRE_Y, buildReferencePlant, placePart } from "./designs.js";
import { KITS } from "./kits.js";

const seconds = (world: SimulationWorld, s: number) => world.stepMany(Math.round(s * 60));
const outputs = (snapshot: SimulationSnapshot, id: string) =>
  snapshot.components.find((c) => c.id === id)!.state.plant.outputs;

describe("kits", () => {
  it.each(KITS.map((k) => [k.id, k] as const))(
    "%s is ordinary parts and links, placeable any number of times",
    (_id, kit) => {
      const source = kit.build();
      const ids = source.listComponents().map((c) => c.id);
      const file = extractAssembly(source, ids, kit.name);
      expect(file.components.length).toBeGreaterThan(1);
      const world = new SimulationWorld();
      const a = insertAssembly(world, file, { x: -20, y: 0, z: 0 });
      const b = insertAssembly(world, file, { x: 20, y: 0, z: 0 });
      expect(world.listComponents()).toHaveLength(2 * ids.length);
      expect(world.listConnections()).toHaveLength(2 * source.listConnections().length);
      expect(a.groupId).not.toBeNull();
      expect(world.listGroups().map((g) => g.name)).toEqual([kit.name, kit.name]);
      // Taking one copy apart leaves the other grouped and every part where it was.
      world.ungroup(a.groupId!);
      expect(world.listGroups().map((g) => g.id)).toEqual([b.groupId]);
      world.solve();
      expect(world.getSnapshot().diagnostics).toBeDefined();
    },
  );
});

describe("a blanket built from modules", () => {
  /** Reference plant plus shield blocks inside the vessel's bore, facing the plasma. */
  function linedPlant(count: number, extra?: (world: SimulationWorld) => void) {
    const world = new SimulationWorld({ name: "Lined" });
    buildReferencePlant(world);
    for (let i = 0; i < count; i += 1) {
      const phi = (i / Math.max(1, count)) * 2 * Math.PI;
      const r = 6.2 + 1.6; // outboard, 1.6 m from the magnetic axis, inside the 2.3 m bore
      const id = `module-${i}`;
      placePart(world, "shield-block", {
        id,
        // Front (+Z) turned toward the machine's centre.
        transform: transform(
          vec3(r * Math.cos(phi), TOKAMAK_CENTRE_Y, r * Math.sin(phi)),
          QuaternionMath.fromAxisAngle(vec3(0, 1, 0), -Math.PI / 2 - phi),
        ),
      });
      world.setAnchored(id, true);
    }
    extra?.(world);
    world.solve();
    seconds(world, 40);
    return world.getSnapshot();
  }

  it(
    "modules near the plasma catch neutrons by where they are; one across the hall does not",
    { timeout: 60000 },
    () => {
      const snapshot = linedPlant(12, (world) => {
        placePart(world, "shield-block", { id: "far", position: vec3(40, 0.5, 30) });
      });
      const vessel = snapshot.components.find((c) => c.id === "vessel")!.state.plant.vessel!;
      expect(vessel.plasma.phase).toBe("flat-top");
      const neutronW = vessel.plasma.neutronPowerW;
      let caught = 0;
      for (let i = 0; i < 12; i += 1) {
        const heat = outputs(snapshot, `module-${i}`)["neutronHeatingW"] ?? 0;
        expect(heat).toBeGreaterThan(0);
        caught += outputs(snapshot, `module-${i}`)["neutronsInW"] ?? 0;
      }
      // Twelve 1.5 m² modules cover a small part of the plasma's view: a share, not all of it.
      expect(caught).toBeGreaterThan(0.005 * neutronW);
      expect(caught).toBeLessThan(0.5 * neutronW);
      expect(outputs(snapshot, "far")["neutronHeatingW"]).toBeUndefined();
      expect(
        snapshot.plant.confidence.subsystems
          .filter((s) => s.subsystem === "neutronics")
          .flatMap((s) => s.reasons)
          .join(" "),
      ).toMatch(/blanket module/);
    },
  );

  it(
    "modules inside the bore shield the vessel wall: it heats less with them",
    { timeout: 60000 },
    () => {
      const bare = linedPlant(0);
      const lined = linedPlant(24);
      const wall = (s: SimulationSnapshot) => outputs(s, "vessel")["neutronHeatingW"]!;
      expect(wall(lined)).toBeLessThan(wall(bare));
    },
  );
});
