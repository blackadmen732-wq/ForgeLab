import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import {
  SimulationWorld,
  checkPortCompatibility,
  connectionWarnings,
  openPorts,
  suggestConnections,
  type ConnectionEndpoint,
} from "@forgelab/sim-core";
import { buildReferencePlant, placePart } from "./index.js";

function pointOf(world: SimulationWorld, e: ConnectionEndpoint) {
  return world
    .requireComponent(e.componentId)
    .connectionPoints.find((p) => p.id === e.connectionPointId)!;
}

function looseParts(): SimulationWorld {
  const world = new SimulationWorld();
  placePart(world, "coolant-pump", { id: "pump", position: vec3(0, 0.5, 0) });
  placePart(world, "coolant-pipe", { id: "near-pipe", position: vec3(3, 0.5, 0) });
  placePart(world, "coolant-pipe", { id: "far-pipe", position: vec3(30, 0.5, 0) });
  placePart(world, "bus-bar", { id: "bus", position: vec3(0, 0.5, 4) });
  return world;
}

const lists = (world: SimulationWorld) =>
  [world.getSnapshot().components, world.listConnections()] as const;

describe("open ports and connection suggestions", () => {
  it("lists every unconnected service port, and no structural sockets", () => {
    const world = looseParts();
    const open = openPorts(...lists(world));
    expect(open.length).toBeGreaterThan(0);
    expect(open.some((p) => p.domain === "structural")).toBe(false);
    for (const id of ["pump", "near-pipe", "far-pipe", "bus"])
      expect(
        open.some((p) => p.endpoint.componentId === id),
        id,
      ).toBe(true);
  });

  it("suggests only ports sim-core says can be joined, compatible first, nearest first", () => {
    const world = looseParts();
    const pumpPort = openPorts(...lists(world)).find(
      (p) => p.endpoint.componentId === "pump" && p.domain === "fluid",
    )!;
    const suggestions = suggestConnections(...lists(world), pumpPort.endpoint, 20);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      // Never the pump itself; never the bus bar's electrical terminals.
      expect(s.port.endpoint.componentId).not.toBe("pump");
      expect(s.port.domain).toBe("fluid");
      const verdict = checkPortCompatibility(
        pointOf(world, pumpPort.endpoint),
        pointOf(world, s.port.endpoint),
      );
      expect(verdict.state).toBe(s.state);
      expect(verdict.state).not.toBe("incompatible");
    }
    for (let i = 1; i < suggestions.length; i += 1) {
      const [a, b] = [suggestions[i - 1]!, suggestions[i]!];
      if (a.state === b.state) expect(a.distanceM).toBeLessThanOrEqual(b.distanceM);
      else expect(a.state).toBe("compatible");
    }
    // The pipe beside the pump comes before the one 30 m away.
    const firstNear = suggestions.findIndex((s) => s.port.endpoint.componentId === "near-pipe");
    const firstFar = suggestions.findIndex((s) => s.port.endpoint.componentId === "far-pipe");
    expect(firstNear).toBeGreaterThanOrEqual(0);
    if (firstFar >= 0) expect(firstNear).toBeLessThan(firstFar);
  });

  it("drops both ends from the open list once they are connected", () => {
    const world = looseParts();
    const pumpPort = openPorts(...lists(world)).find(
      (p) => p.endpoint.componentId === "pump" && p.domain === "fluid",
    )!;
    const best = suggestConnections(...lists(world), pumpPort.endpoint)[0]!;
    world.connect(pumpPort.endpoint, best.port.endpoint);
    const open = openPorts(...lists(world)).map(
      (p) => `${p.endpoint.componentId}/${p.endpoint.connectionPointId}`,
    );
    for (const e of [pumpPort.endpoint, best.port.endpoint])
      expect(open).not.toContain(`${e.componentId}/${e.connectionPointId}`);
  });

  it("returns nothing for an unknown port, and respects the limit", () => {
    const world = looseParts();
    expect(
      suggestConnections(...lists(world), { componentId: "nope", connectionPointId: "x" }),
    ).toEqual([]);
    const any = openPorts(...lists(world))[0]!;
    expect(suggestConnections(...lists(world), any.endpoint, 1).length).toBeLessThanOrEqual(1);
  });

  it("is deterministic", () => {
    const a = looseParts();
    const b = looseParts();
    const from = openPorts(...lists(a))[0]!.endpoint;
    expect(JSON.stringify(suggestConnections(...lists(a), from, 10))).toBe(
      JSON.stringify(suggestConnections(...lists(b), from, 10)),
    );
  });

  it("reports no incompatible links in the reference plant", () => {
    const world = new SimulationWorld();
    buildReferencePlant(world);
    for (const w of connectionWarnings(...lists(world)))
      expect(w.compatibility.state, w.connectionId).toBe("warning");
  });
});
