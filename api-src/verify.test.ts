import { describe, expect, it } from "vitest";
import { buildReferencePlant, buildStarterAssembly } from "@forgelab/reactor-components";
import { SimulationWorld, serializeWorld } from "@forgelab/sim-core";
import { designHash } from "@forgelab/sim-runner";
import { RATE_LIMIT_RUNS, handleVerify, type VerifyDeps, type VersionRecord } from "./verify.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";

function design(build: (w: SimulationWorld) => void) {
  const world = new SimulationWorld({ name: "Test" });
  build(world);
  return JSON.parse(JSON.stringify(serializeWorld(world))) as ReturnType<typeof serializeWorld>;
}

const RIG = design(buildStarterAssembly);

function fakeDeps(
  overrides: Partial<VerifyDeps> & { record?: VersionRecord | null; recent?: number } = {},
) {
  const calls = { runs: [] as unknown[], entries: [] as { category: string; value: number }[] };
  const record: VersionRecord | null =
    overrides.record === undefined
      ? {
          project: { id: PROJECT, ownerId: USER, visibility: "public" },
          version: { id: VERSION, projectId: PROJECT, design: RIG, designHash: designHash(RIG) },
        }
      : overrides.record;
  const deps: VerifyDeps = {
    authenticate: async (token) => (token === "good" ? { id: USER } : null),
    countRecentRuns: async () => overrides.recent ?? 0,
    loadVersion: async () => record,
    recordRun: async (input) => {
      calls.runs.push(input);
      return "55555555-5555-4555-8555-555555555555";
    },
    recordEntry: async ({ score }) => {
      calls.entries.push(score);
      return true;
    },
    now: () => Date.parse("2026-09-29T12:00:00Z"),
    ...overrides,
  };
  return { deps, calls };
}

const post = (body: unknown, authorization = "Bearer good") => ({
  method: "POST",
  authorization,
  body,
});
const ids = { projectId: PROJECT, versionId: VERSION };

describe("POST /api/verify", () => {
  it("rejects other methods and missing or invalid sessions", async () => {
    const { deps } = fakeDeps();
    expect(
      (await handleVerify({ method: "GET", authorization: "Bearer good", body: null }, deps))
        .status,
    ).toBe(405);
    expect((await handleVerify(post(ids, ""), deps)).status).toBe(401);
    expect((await handleVerify(post(ids, "Bearer forged"), deps)).status).toBe(401);
  });

  it("validates the ids", async () => {
    const { deps } = fakeDeps();
    expect((await handleVerify(post({ projectId: "x", versionId: VERSION }), deps)).status).toBe(
      400,
    );
    expect((await handleVerify(post(null), deps)).status).toBe(400);
  });

  it("rate-limits per user", async () => {
    const { deps } = fakeDeps({ recent: RATE_LIMIT_RUNS });
    expect((await handleVerify(post(ids), deps)).status).toBe(429);
  });

  it("only verifies the caller's own, published, intact designs", async () => {
    const base = fakeDeps().deps;
    const version = { id: VERSION, projectId: PROJECT, design: RIG, designHash: designHash(RIG) };
    expect((await handleVerify(post(ids), { ...base, loadVersion: async () => null })).status).toBe(
      404,
    );
    expect(
      (
        await handleVerify(post(ids), {
          ...base,
          loadVersion: async () => ({
            project: { id: PROJECT, ownerId: OTHER, visibility: "public" },
            version,
          }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleVerify(post(ids), {
          ...base,
          loadVersion: async () => ({
            project: { id: PROJECT, ownerId: USER, visibility: "private" },
            version,
          }),
        })
      ).status,
    ).toBe(409);
    const tampered = { ...version, designHash: "b".repeat(64) };
    expect(
      (
        await handleVerify(post(ids), {
          ...base,
          loadVersion: async () => ({
            project: { id: PROJECT, ownerId: USER, visibility: "public" },
            version: tampered,
          }),
        })
      ).status,
    ).toBe(409);
    const garbage = { ...version, design: { schemaVersion: 99 } };
    expect(
      (
        await handleVerify(post(ids), {
          ...base,
          loadVersion: async () => ({
            project: { id: PROJECT, ownerId: USER, visibility: "public" },
            version: garbage,
          }),
        })
      ).status,
    ).toBe(422);
  });

  it("ignores any result the browser claims and records only what it recomputes", async () => {
    const { deps, calls } = fakeDeps();
    const response = await handleVerify(
      post({ ...ids, value: 1e12, scores: [{ category: "net-electric", value: 1e12 }] }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(calls.runs).toHaveLength(1);
    // A structural rig makes no power: it enters the net-output board at exactly 0 MW, and
    // nothing in the request body reaches the stored values.
    expect(calls.entries).toEqual([{ category: "net-electric", value: 0 }]);
  });

  it("enters eligible categories for a burning plant", { timeout: 60000 }, async () => {
    const plant = design((w) => buildReferencePlant(w));
    const { deps, calls } = fakeDeps({
      record: {
        project: { id: PROJECT, ownerId: USER, visibility: "public" },
        version: { id: VERSION, projectId: PROJECT, design: plant, designHash: designHash(plant) },
      },
    });
    const response = await handleVerify(post(ids), deps);
    expect(response.status).toBe(200);
    const gain = calls.entries.find((e) => e.category === "fusion-gain");
    expect(gain).toBeDefined();
    expect(gain!.value).toBeGreaterThan(1);
    // Net output is ranked even when negative (in MW); the plant is not net-positive,
    // so it cannot enter the lightest-net-positive board.
    const net = calls.entries.find((e) => e.category === "net-electric");
    expect(net!.value).toBeLessThan(0);
    expect(calls.entries.some((e) => e.category === "lightest-net-positive")).toBe(false);
  });
});
