import { beforeAll, describe, expect, it } from "vitest";
import { type CascadeEvent, type CascadeSnapshot, SimulationWorld } from "@forgelab/sim-core";
import {
  PROTECTED_DESIGN,
  UNPROTECTED_DESIGN,
  buildReferenceCascade,
  type CascadeDesign,
} from "./index.js";

/**
 * The reference cascade (docs/CASCADE.md): one induced fault — a degraded bolted joint on
 * the switchgear bus — in a plant with switchgear, batteries, a coolant line, a steel
 * support, a pump, a superconducting magnet and a reactor.
 *
 * These tests do not script a sequence. They check that whatever happened was caused by
 * physical coupling, and that better engineering stops the cascade.
 */

function run(
  design: CascadeDesign,
  seconds: number,
): { world: SimulationWorld; cascade: CascadeSnapshot } {
  const world = new SimulationWorld({ name: "Reference cascade" });
  buildReferenceCascade(world, design);
  world.stepMany(Math.round(seconds * 60));
  return { world, cascade: world.getSnapshot().cascade! };
}

function find(
  cascade: CascadeSnapshot,
  kind: CascadeEvent["kind"],
  componentId?: string,
): CascadeEvent | undefined {
  return cascade.events.find(
    (e) => e.kind === kind && (componentId === undefined || e.componentId === componentId),
  );
}

function expectAncestor(
  world: SimulationWorld,
  event: CascadeEvent | undefined,
  ancestor: CascadeEvent | undefined,
): void {
  expect(event).toBeDefined();
  expect(ancestor).toBeDefined();
  expect(world.cascade!.ancestorsOf(event!.id)).toContain(ancestor!.id);
}

/** Invariants every cascade must satisfy, whatever happened in it. */
function expectCausallyClosed(cascade: CascadeSnapshot): void {
  // Only induced faults may lack a physical cause. Nothing "just happens" nearby.
  const orphans = cascade.events.filter(
    (e) => e.parentIds.length === 0 && e.kind !== "induced-fault",
  );
  expect(orphans.map((e) => `${e.id} ${e.kind} @ ${e.componentId}`)).toEqual([]);
  // Causes always precede their effects.
  const byId = new Map(cascade.events.map((e) => [e.id, e]));
  for (const event of cascade.events) {
    for (const parent of event.parentIds)
      expect(byId.get(parent)!.timeSec).toBeLessThanOrEqual(event.timeSec);
  }
}

describe("reference cascade — unprotected plant", () => {
  let world: SimulationWorld;
  let cascade: CascadeSnapshot;

  beforeAll(() => {
    ({ world, cascade } = run(UNPROTECTED_DESIGN, 1500));
  }, 180_000);

  it("is causally closed: every event traces back to the one induced fault", () => {
    expectCausallyClosed(cascade);
    const roots = cascade.events.filter((e) => e.kind === "induced-fault");
    expect(roots).toHaveLength(1);
    for (const event of cascade.events.slice(1)) {
      expect(world.cascade!.ancestorsOf(event.id)).toContain(roots[0]!.id);
    }
  });

  it("goes from an overheated joint to an arc to a fire, through the conductor's own limits", () => {
    const fault = find(cascade, "induced-fault");
    const overheated = find(cascade, "conductor-overheated", "switchgear");
    const breakdown = find(cascade, "insulation-breakdown", "switchgear");
    const arc = find(cascade, "arc-fault", "switchgear");
    const fire = find(cascade, "ignition", "switchgear");
    expectAncestor(world, overheated, fault);
    expectAncestor(world, breakdown, overheated);
    expect(arc!.parentIds).toEqual([breakdown!.id]);
    expectAncestor(world, fire, arc);
    // The breaker never saw the arcing fault: it is set above the arcing current.
    expect(find(cascade, "breaker-tripped")).toBeUndefined();
  });

  it("spreads fire only along combustible material", () => {
    const switchgearFire = find(cascade, "ignition", "switchgear");
    const trayFire = find(cascade, "ignition", "cable-tray-1");
    expectAncestor(world, trayFire, switchgearFire);
    // Steel parts heat up, but nothing made only of steel ever ignites.
    for (const steelOnly of [
      "pipe-support",
      "pressurizer",
      "coolant-pipe",
      "pump",
      "transformer",
    ]) {
      expect(find(cascade, "ignition", steelOnly)).toBeUndefined();
    }
  });

  it("drives the nearby battery into runaway through the heat the fire delivered", () => {
    const runaway = find(cascade, "thermal-runaway", "battery-a");
    expectAncestor(world, runaway, find(cascade, "ignition", "switchgear"));
    // Runaway evolves over minutes after the fire, not instantly.
    expect(runaway!.timeSec - find(cascade, "ignition", "switchgear")!.timeSec).toBeGreaterThan(
      120,
    );
    // And it propagates cell to cell inside the module.
    const propagated = cascade.events.filter(
      (e) => e.kind === "runaway-propagated" && e.componentId === "battery-a",
    );
    expect(propagated.length).toBeGreaterThan(0);
    for (const p of propagated) expect(p.timeSec).toBeGreaterThanOrEqual(runaway!.timeSec);
  });

  it("propagates through the electrical network as well as through space", () => {
    const burnedOpen = cascade.events.find(
      (e) => e.kind === "arc-extinguished" && e.description.includes("burned the circuit open"),
    );
    const pumpLost = find(cascade, "power-lost", "pump");
    const cryoLost = find(cascade, "power-lost", "cryoplant");
    expect(pumpLost!.parentIds).toEqual([burnedOpen!.id]);
    expect(cryoLost!.parentIds).toEqual([burnedOpen!.id]);
    expectAncestor(
      world,
      find(cascade, "coolant-flow-lost"),
      find(cascade, "pump-stopped", "pump"),
    );
  });

  it("quenches the magnet and disrupts the plasma because the cryoplant lost power", () => {
    const quench = find(cascade, "magnet-quench", "magnet");
    expectAncestor(world, quench, find(cascade, "refrigeration-lost", "magnet"));
    expectAncestor(world, quench, find(cascade, "power-lost", "cryoplant"));
    const disruption = find(cascade, "plasma-disruption", "reactor");
    expectAncestor(world, disruption, quench);
  });

  it("separates the root cause from the most dramatic event", () => {
    const diagnosis = cascade.diagnosis;
    const root = find(cascade, "induced-fault")!;
    expect(diagnosis.rootCauseEventIds).toEqual([root.id]);
    expect(diagnosis.mostDramaticEventId).not.toBe(root.id);
    expect(diagnosis.chainEventIds[0]).toBe(root.id);
    expect(diagnosis.chainEventIds.at(-1)).toBe(diagnosis.mostDramaticEventId);
    expect(diagnosis.summary).toMatch(/Root cause: induced fault/);
  });

  it("writes the significant failures into the world failure log with their causes", () => {
    const failures = world.getSnapshot().failures;
    expect(failures.some((f) => f.system === "electrical" && f.failureType === "arc_fault")).toBe(
      true,
    );
    expect(
      failures.some((f) => f.system === "thermal" && f.failureType === "thermal_runaway"),
    ).toBe(true);
    expect(failures.some((f) => f.system === "magnetic" && f.failureType === "magnet_quench")).toBe(
      true,
    );
  });
});

describe("reference cascade — protected plant", () => {
  let world: SimulationWorld;
  let cascade: CascadeSnapshot;

  beforeAll(() => {
    ({ world, cascade } = run(PROTECTED_DESIGN, 600));
  }, 120_000);

  it("suffers the same fault and the same arc", () => {
    expectCausallyClosed(cascade);
    expect(find(cascade, "induced-fault")).toBeDefined();
    expect(find(cascade, "insulation-breakdown", "switchgear")).toBeDefined();
    expect(find(cascade, "arc-fault", "switchgear")).toBeDefined();
  });

  it("clears the arc in a tenth of a second and stops the cascade there", () => {
    const arc = find(cascade, "arc-fault", "switchgear")!;
    const trip = find(cascade, "breaker-tripped", "breaker-a")!;
    expect(trip.parentIds).toEqual([arc.id]);
    expect(trip.timeSec - arc.timeSec).toBeLessThan(0.2);
    expect(arc.energyReleasedJ).toBeLessThan(100_000);

    for (const kind of [
      "ignition",
      "thermal-runaway",
      "magnet-quench",
      "plasma-disruption",
      "pipe-ruptured",
      "coolant-flow-lost",
    ] as const) {
      expect(find(cascade, kind), kind).toBeUndefined();
    }
    // Pump and cryoplant transfer to the second feeder; only the auxiliary load goes dark.
    expect(cascade.events.filter((e) => e.kind === "power-lost").map((e) => e.componentId)).toEqual(
      ["aux-load"],
    );
    expect(cascade.nodes.find((n) => n.componentId === "reactor")!.plasma!.state).toBe("burning");
    expect(cascade.events.length).toBeLessThanOrEqual(8);
    // The failure log holds only the electrical fault itself: nothing thermal ever failed.
    expect(world.getSnapshot().failures.every((f) => f.system === "electrical")).toBe(true);
  });
});

describe("reference cascade — fast breaker only", () => {
  it("prevents the fire, but the cascade still travels through the network to the magnet", () => {
    const { world, cascade } = run({ ...UNPROTECTED_DESIGN, fastArcProtection: true }, 600);
    expectCausallyClosed(cascade);
    expect(find(cascade, "ignition")).toBeUndefined();
    expect(find(cascade, "thermal-runaway")).toBeUndefined();
    // Isolating the only feeder also isolates the cryoplant: protection without redundancy.
    const trip = find(cascade, "breaker-tripped", "breaker-a");
    expectAncestor(world, find(cascade, "magnet-quench", "magnet"), trip);
    expectAncestor(world, find(cascade, "plasma-disruption", "reactor"), trip);
  }, 120_000);
});

describe("reference cascade — save files", () => {
  it("round-trips the plant through JSON and replays the identical cascade", async () => {
    const { toJson, worldFromJson } = await import("@forgelab/sim-core");
    const original = new SimulationWorld();
    buildReferenceCascade(original, PROTECTED_DESIGN);
    const loaded = worldFromJson(toJson(original));
    expect(loaded.cascadePlant).toEqual(original.cascadePlant);
    original.stepMany(60 * 270);
    loaded.stepMany(60 * 270);
    expect(JSON.stringify(loaded.getSnapshot().cascade!.events)).toBe(
      JSON.stringify(original.getSnapshot().cascade!.events),
    );
  }, 60_000);

  it("rejects a plant that names a component the file does not contain", async () => {
    const { fromJson, toJson } = await import("@forgelab/sim-core");
    const world = new SimulationWorld();
    buildReferenceCascade(world, PROTECTED_DESIGN);
    const file = JSON.parse(toJson(world));
    file.cascade.nodes.push({ componentId: "ghost" });
    expect(() => fromJson(JSON.stringify(file))).toThrowError(/no component "ghost"/);
  });
});
