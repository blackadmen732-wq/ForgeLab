import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SimulationWorld, serializeWorld } from "@forgelab/sim-core";
import { buildReferencePlant, placePart } from "@forgelab/reactor-components";
import {
  MAX_VERIFIED_COMPONENTS,
  SimulationSession,
  STANDARD_SCENARIO,
  VerificationError,
  canonicalJson,
  claimMatches,
  designHash,
  frameScalar,
  runVerification,
  sha256Hex,
  type SessionFrame,
} from "./index.js";

function referenceFile() {
  const world = new SimulationWorld({ name: "Reference" });
  buildReferencePlant(world);
  return serializeWorld(world);
}

describe("sha256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches Node's crypto on long and non-ASCII input", () => {
    for (const text of ["ForgeLab ✓ 核融合 🔥", "x".repeat(1000), canonicalJson(referenceFile())]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  it("produces key-order-independent canonical JSON", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }),
    );
  });
});

describe("design hash", () => {
  it("ignores run state and metadata but not design changes", () => {
    const world = new SimulationWorld({ name: "Reference" });
    buildReferencePlant(world);
    const a = serializeWorld(world, { savedAtIso: "2026-01-01T00:00:00Z" });
    world.stepMany(30);
    const b = serializeWorld(world, { savedAtIso: "2026-09-29T00:00:00Z" });
    expect(designHash(b)).toBe(designHash(a));

    world.setParameters("nbi", { heatingPowerW: 40e6 });
    expect(designHash(serializeWorld(world))).not.toBe(designHash(a));
  });
});

describe("verification", () => {
  it("is deterministic and reports every category", { timeout: 60000 }, () => {
    const file = referenceFile();
    const options = { durationSec: 40, averagingWindowSec: 10 };
    const first = runVerification(file, options);
    const second = runVerification(JSON.parse(JSON.stringify(file)), options);
    expect(second).toEqual(first);
    expect(first.ticks).toBe(40 * 60);
    expect(first.scores.map((s) => s.category)).toEqual([
      "net-electric",
      "fusion-gain",
      "lightest-net-positive",
    ]);
    expect(first.averages.fusionPowerW).toBeGreaterThan(5e7);
    expect(first.confidence).toBe("approximate");
    const net = first.scores.find((s) => s.category === "net-electric")!;
    expect(net.eligible).toBe(true);
    expect(net.value).toBeCloseTo(first.averages.netElectricW / 1e6, 9);
    // A net consumer cannot enter the lightest-net-positive board.
    expect(first.scores.find((s) => s.category === "lightest-net-positive")!.eligible).toBe(false);
  });

  it(
    "runs the full standard scenario for the reference plant within a server budget",
    { timeout: 120000 },
    () => {
      const start = Date.now();
      const result = runVerification(referenceFile());
      const elapsedMs = Date.now() - start;
      expect(result.scenarioId).toBe(STANDARD_SCENARIO.id);
      expect(result.ticks).toBe(STANDARD_SCENARIO.durationSec * 60);
      expect(result.disrupted).toBe(false);
      expect(result.finalPlasmaPhases).toEqual(["flat-top"]);
      // Recorded, not asserted tightly: CI machines vary. Vercel functions allow 60 s.
      expect(elapsedMs).toBeLessThan(45000);
      console.log(
        `standard verification of the reference plant: ${elapsedMs} ms, net ${result.averages.netElectricW / 1e6} MW`,
      );
    },
  );

  it("marks experimental designs ineligible", () => {
    const world = new SimulationWorld();
    placePart(world, "reactor-chamber", { id: "chamber", position: { x: 0, y: 1.5, z: 0 } });
    placePart(world, "solenoid-coil", { id: "coil", position: { x: 0, y: 1.5, z: 0 } });
    // Heating attached: this open device is now a plasma experiment, not an empty chamber.
    placePart(world, "neutral-beam", { id: "nbi", position: { x: 0, y: 1.2, z: 8 } });
    world.connect(
      { componentId: "nbi", connectionPointId: "port" },
      { componentId: "chamber", connectionPointId: "heating" },
    );
    const result = runVerification(serializeWorld(world), {
      durationSec: 2,
      averagingWindowSec: 1,
    });
    expect(result.confidence).toBe("experimental");
    expect(result.scores.every((s) => !s.eligible)).toBe(true);
  });

  it("refuses designs above the size limit and malformed input", () => {
    const world = new SimulationWorld();
    for (let i = 0; i <= MAX_VERIFIED_COMPONENTS; i += 1) {
      placePart(world, "equipment-block", { id: `b-${i}`, position: { x: i * 2, y: 0.5, z: 0 } });
    }
    expect(() => runVerification(serializeWorld(world))).toThrow(VerificationError);
    expect(() => runVerification({ nonsense: true })).toThrow();
  });

  it("compares claimed and verified scores with a tight relative tolerance", () => {
    expect(claimMatches(-83.1234567, -83.1234567)).toBe(true);
    expect(claimMatches(-83.1234, -83.1235)).toBe(false);
    expect(claimMatches(Number.NaN, 1)).toBe(false);
  });
});

describe("worker session", () => {
  function session() {
    let now = 0;
    const clock = () => now;
    const advance = (ms: number) => {
      now += ms;
    };
    return { session: new SimulationSession(clock), advance };
  }

  it("loads a design and publishes a first frame", () => {
    const { session: s } = session();
    const events = s.handle({ type: "load", runId: 7, file: referenceFile() });
    expect(events[0]).toEqual({
      type: "loaded",
      runId: 7,
      componentCount: referenceFile().components.length,
    });
    const frame = events[1] as SessionFrame;
    expect(frame.type).toBe("frame");
    expect(frame.runId).toBe(7);
    expect(frame.tick).toBe(0);
    expect(frame.transforms.length).toBe(frame.ids.length * 7);
    const coil = frame.ids.indexOf("tf-coils");
    expect(frameScalar(frame, coil, "fieldT")).toBeCloseTo(5.29, 2);
  });

  it("reaches exactly the state a directly stepped world reaches", () => {
    const { session: s } = session();
    s.handle({ type: "load", runId: 1, file: referenceFile() });
    const frame = s.handle({ type: "step", count: 300 })[0] as SessionFrame;

    const direct = new SimulationWorld();
    buildReferencePlant(direct);
    direct.reset();
    direct.stepMany(300);
    expect(frame.tick).toBe(300);
    expect(frame.plant.metrics).toEqual(direct.getSnapshot().plant.metrics);
  });

  it("paces at real time, publishes failures once, and records history", () => {
    const { session: s, advance } = session();
    const file = (() => {
      const world = new SimulationWorld();
      buildReferencePlant(world, { parameterOverrides: { grid: { maxPowerW: 5e6 } } });
      return serializeWorld(world);
    })();
    s.handle({ type: "load", runId: 2, file });
    s.handle({ type: "speed", speed: 1 });
    const frames: SessionFrame[] = [];
    for (let i = 0; i < 120; i += 1) {
      advance(1000 / 60);
      const frame = s.tick(1 / 60);
      if (frame !== null) frames.push(frame);
    }
    const last = frames[frames.length - 1]!;
    // Two seconds of real time at 1x is exactly 120 fixed steps; frames are published at
    // most every 50 ms, so the last frame may trail the world by a couple of steps.
    expect(s.world!.tick).toBe(120);
    expect(last.tick).toBeGreaterThanOrEqual(115);
    const allFailures = frames.flatMap((f) => f.newFailures);
    expect(allFailures.length).toBe(last.failureCount);
    expect(new Set(allFailures.map((f) => `${f.componentId}${f.failureType}`)).size).toBe(
      allFailures.length,
    );
    // History every 0.25 s of simulated time.
    const history = frames.flatMap((f) => f.history);
    // t = 0 went out with the load frame; the newest points wait for the next frame.
    expect(history.length).toBeGreaterThanOrEqual(6);
    expect(history[1]!.timeSec - history[0]!.timeSec).toBeCloseTo(0.25, 9);
  });

  it("runs as fast as its budget allows at max speed and returns inspection detail", () => {
    let now = 0;
    // Each clock read advances 0.1 ms, so a 12 ms budget allows a bounded number of batches.
    const s = new SimulationSession(() => (now += 0.1));
    s.handle({ type: "load", runId: 3, file: referenceFile() });
    s.handle({ type: "inspect", componentId: "vessel" });
    s.handle({ type: "speed", speed: "max" });
    let frame: SessionFrame | null = null;
    for (let i = 0; i < 20 && frame === null; i += 1) frame = s.tick(1 / 60);
    if (frame === null) throw new Error("no frame published at max speed");
    expect(frame.tick).toBeGreaterThan(0);
    expect(frame.tick % 10).toBe(0);
    expect(frame.detail?.id).toBe("vessel");
    expect(frame.vessels["vessel"]).toBeDefined();
  });

  it("reports a malformed design as an error event", () => {
    const { session: s } = session();
    const events = s.handle({ type: "load", runId: 9, file: { schemaVersion: 99 } as never });
    expect(events[0]!.type).toBe("error");
  });
});
