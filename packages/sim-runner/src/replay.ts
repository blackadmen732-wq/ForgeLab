import {
  type AssemblyFileV2,
  type FailureEvent,
  SIMULATION_ENGINE_VERSION,
  deserializeWorld,
  failureKey,
  parseAssemblyFile,
} from "@forgelab/sim-core";
import { designHash } from "./verification.js";

/**
 * Replay files: a failure anyone can re-run.
 *
 * A run is fully determined by the design and the engine version (designs are locked
 * while a run is live; the simulation takes no other input). So a replay carries the
 * design exactly as it ran, the engine version, and the failures the run produced. Opening
 * one re-simulates it — nothing recorded is trusted — and `reproduceReplay` confirms the
 * same root failure happens at the same tick. The design inside is an ordinary assembly
 * file, so a replay is also a fork point: change the design and run again.
 */
export const REPLAY_FILE_KIND = "forgelab-replay";
export const REPLAY_FILE_VERSION = 1;
/** Failures kept in a replay file (the root and its first consequences). */
export const REPLAY_MAX_FAILURES = 50;
/** Longest run a replay may ask a reader to re-simulate, s. */
export const REPLAY_MAX_DURATION_SEC = 3600;

export interface ReplayFailure {
  readonly key: string;
  readonly componentId: string;
  readonly failureType: string;
  readonly timestampSec: number;
  readonly summary: string;
  readonly causeKeys: readonly string[];
}

export interface ReplayFileV1 {
  readonly kind: typeof REPLAY_FILE_KIND;
  readonly version: typeof REPLAY_FILE_VERSION;
  readonly title: string;
  readonly engineVersion: string;
  readonly designHash: string;
  readonly design: AssemblyFileV2;
  /** Simulated time the run reached when it was saved, s. */
  readonly durationSec: number;
  readonly failures: readonly ReplayFailure[];
  readonly createdAtIso: string;
}

export class ReplayError extends Error {}

export function createReplay(input: {
  title: string;
  design: AssemblyFileV2;
  failures: readonly FailureEvent[];
  durationSec: number;
  createdAtIso: string;
}): ReplayFileV1 {
  const design = parseAssemblyFile(input.design);
  return {
    kind: REPLAY_FILE_KIND,
    version: REPLAY_FILE_VERSION,
    title: input.title.slice(0, 120),
    engineVersion: SIMULATION_ENGINE_VERSION,
    designHash: designHash(design),
    design,
    durationSec: Math.min(REPLAY_MAX_DURATION_SEC, Math.max(0, input.durationSec)),
    failures: input.failures.slice(0, REPLAY_MAX_FAILURES).map((f) => ({
      key: failureKey(f),
      componentId: f.componentId,
      failureType: f.failureType,
      timestampSec: f.timestampSec,
      summary: (f.summary ?? "").slice(0, 300),
      causeKeys: (f.causeKeys ?? []).slice(0, 20),
    })),
    createdAtIso: input.createdAtIso,
  };
}

/** Validates a replay file: shape, design and the design's hash. Throws ReplayError. */
export function parseReplay(input: unknown): ReplayFileV1 {
  if (typeof input !== "object" || input === null) throw new ReplayError("Not a replay file.");
  const r = input as Record<string, unknown>;
  if (r["kind"] !== REPLAY_FILE_KIND) throw new ReplayError("Not a ForgeLab replay file.");
  if (r["version"] !== REPLAY_FILE_VERSION)
    throw new ReplayError(`Replay version ${String(r["version"])} is not supported by this build.`);
  let design: AssemblyFileV2;
  try {
    design = parseAssemblyFile(r["design"]);
  } catch (error) {
    throw new ReplayError(
      `The design inside the replay is invalid: ${error instanceof Error ? error.message : ""}`,
    );
  }
  const hash = designHash(design);
  if (hash !== r["designHash"])
    throw new ReplayError("The design inside the replay does not match its fingerprint.");
  const failures = Array.isArray(r["failures"])
    ? r["failures"].slice(0, REPLAY_MAX_FAILURES).flatMap((f): ReplayFailure[] => {
        if (typeof f !== "object" || f === null) return [];
        const e = f as Record<string, unknown>;
        if (
          typeof e["componentId"] !== "string" ||
          typeof e["failureType"] !== "string" ||
          typeof e["timestampSec"] !== "number" ||
          !Number.isFinite(e["timestampSec"])
        )
          return [];
        return [
          {
            key: typeof e["key"] === "string" ? e["key"] : "",
            componentId: e["componentId"],
            failureType: e["failureType"],
            timestampSec: e["timestampSec"],
            summary: typeof e["summary"] === "string" ? e["summary"].slice(0, 300) : "",
            causeKeys: Array.isArray(e["causeKeys"])
              ? e["causeKeys"].filter((k): k is string => typeof k === "string").slice(0, 20)
              : [],
          },
        ];
      })
    : [];
  const duration = typeof r["durationSec"] === "number" ? r["durationSec"] : 0;
  return {
    kind: REPLAY_FILE_KIND,
    version: REPLAY_FILE_VERSION,
    title: typeof r["title"] === "string" ? r["title"].slice(0, 120) : design.name,
    engineVersion: typeof r["engineVersion"] === "string" ? r["engineVersion"] : "unknown",
    designHash: hash,
    design,
    durationSec: Math.min(REPLAY_MAX_DURATION_SEC, Math.max(0, duration)),
    failures,
    createdAtIso: typeof r["createdAtIso"] === "string" ? r["createdAtIso"] : "",
  };
}

/** The first failure of a run (the root of its causal graph). */
export function rootFailure(replay: ReplayFileV1): ReplayFailure | null {
  return replay.failures[0] ?? null;
}

/** Whether a run's first failure is the replay's root: same part, type and tick. */
export function sameRootFailure(
  expected: ReplayFailure,
  actual: { componentId: string; failureType: string; timestampSec: number },
  fixedTimestepSec: number,
): boolean {
  return (
    actual.componentId === expected.componentId &&
    actual.failureType === expected.failureType &&
    Math.abs(actual.timestampSec - expected.timestampSec) <= fixedTimestepSec / 2
  );
}

export interface ReproductionResult {
  /** Same root failure (part, type) at the same tick. */
  readonly reproduced: boolean;
  readonly sameEngine: boolean;
  readonly expected: ReplayFailure | null;
  readonly actual: { componentId: string; failureType: string; timestampSec: number } | null;
}

/**
 * Re-simulates a replay headlessly and compares its root failure. Runs at most to the
 * recorded failure plus one second (or the recorded duration when nothing failed).
 */
export function reproduceReplay(replay: ReplayFileV1): ReproductionResult {
  const world = deserializeWorld(replay.design);
  world.reset();
  const expected = rootFailure(replay);
  const dt = world.settings.fixedTimestepSec;
  const untilSec = expected === null ? replay.durationSec : expected.timestampSec + 1;
  const maxTicks = Math.ceil(Math.min(REPLAY_MAX_DURATION_SEC, untilSec) / dt);
  let actual: ReproductionResult["actual"] = null;
  for (let tick = 0; tick < maxTicks && actual === null; tick += 1) {
    world.step();
    if (world.failureCount > 0) {
      const first = world.getSnapshot().failures[0]!;
      actual = {
        componentId: first.componentId,
        failureType: first.failureType,
        timestampSec: first.timestampSec,
      };
    }
  }
  const sameEngine = replay.engineVersion === SIMULATION_ENGINE_VERSION;
  const reproduced =
    expected === null ? actual === null : actual !== null && sameRootFailure(expected, actual, dt);
  return { reproduced, sameEngine, expected, actual };
}
