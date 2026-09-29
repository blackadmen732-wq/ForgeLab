import {
  type AssemblyFileV2,
  type ConfidenceLevel,
  SIMULATION_ENGINE_VERSION,
  deserializeWorld,
  parseAssemblyFile,
  worstLevel,
} from "@forgelab/sim-core";
import { canonicalJson, sha256Hex } from "./sha256.js";

/**
 * Leaderboard verification.
 *
 * A competitive result is never taken from the browser. The server takes the submitted
 * design, runs THIS scenario with the same deterministic sim-core, and records what it
 * computes. The browser can run the same function to preview a score, but only the
 * server's number is ever stored as verified.
 *
 * The scenario: start from the authored design at t = 0 with the design's own settings,
 * run a fixed number of fixed steps, and average plant metrics over the final window.
 * Plants have large thermal inertia, so the window sits at the end of a long run.
 */
export const VERIFICATION_PROTOCOL_VERSION = 1;

export const STANDARD_SCENARIO = Object.freeze({
  id: "standard-600s",
  name: "Standard 10-minute run",
  durationSec: 600,
  averagingWindowSec: 60,
});

/** Largest design the verifier will run, to bound server cost. */
export const MAX_VERIFIED_COMPONENTS = 400;
export const MAX_VERIFIED_CONNECTIONS = 1600;

export type LeaderboardCategoryId = "net-electric" | "fusion-gain" | "lightest-net-positive";

export interface LeaderboardCategory {
  readonly id: LeaderboardCategoryId;
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  /** Whether a larger value ranks higher. */
  readonly higherIsBetter: boolean;
}

/**
 * Only categories the V0.1 physics can compute are offered. Future ones (confinement,
 * longest operation, smallest working reactor...) stay hidden until their physics exists.
 */
export const LEADERBOARD_CATEGORIES: readonly LeaderboardCategory[] = Object.freeze([
  {
    id: "net-electric",
    name: "Net electrical output",
    description:
      "Gross electrical generation minus everything the plant consumes, averaged over the last 60 s of the standard 10-minute run.",
    unit: "MW",
    higherIsBetter: true,
  },
  {
    id: "fusion-gain",
    name: "Fusion gain Q",
    description:
      "Fusion power divided by absorbed auxiliary heating power, averaged over the last 60 s. Requires at least 1 MW of auxiliary heating.",
    unit: "",
    higherIsBetter: true,
  },
  {
    id: "lightest-net-positive",
    name: "Lightest net-positive plant",
    description:
      "Total assembly mass of a design whose averaged net electrical output is above zero.",
    unit: "t",
    higherIsBetter: false,
  },
]);

export interface WindowAverages {
  readonly netElectricW: number;
  readonly grossElectricW: number;
  readonly houseLoadW: number;
  readonly fusionPowerW: number;
  readonly auxiliaryHeatingW: number;
  readonly plasmaGainQ: number;
}

export interface CategoryScore {
  readonly category: LeaderboardCategoryId;
  readonly value: number;
  readonly eligible: boolean;
  readonly reason?: string;
}

export interface VerificationResult {
  readonly protocolVersion: number;
  readonly engineVersion: string;
  readonly scenarioId: string;
  readonly designHash: string;
  readonly durationSec: number;
  readonly ticks: number;
  readonly componentCount: number;
  readonly totalMassKg: number;
  readonly averages: WindowAverages;
  readonly finalPlasmaPhases: readonly string[];
  readonly disrupted: boolean;
  readonly failureCount: number;
  readonly confidence: ConfidenceLevel;
  readonly confidenceReasons: readonly string[];
  readonly scores: readonly CategoryScore[];
}

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

/**
 * Canonical hash of a design: the authored parts, links and settings only. Run state,
 * metadata and live kinematic state are excluded, so saving the same design twice — or
 * saving it mid-run — hashes identically.
 */
export function designHash(file: AssemblyFileV2): string {
  const design = {
    schemaVersion: file.schemaVersion,
    components: file.components.map((component) => {
      const { physical: _physical, ...authored } = component;
      return authored;
    }),
    connections: file.connections,
    simulationSettings: file.simulationSettings,
  };
  return sha256Hex(canonicalJson(design));
}

export interface VerificationOptions {
  readonly durationSec?: number;
  readonly averagingWindowSec?: number;
  /** Called after every simulated second; return false to abort. */
  readonly onProgress?: (simulatedSec: number) => boolean | void;
}

/** Runs the standard scenario on a design and computes its scores. Deterministic. */
export function runVerification(
  input: unknown,
  options: VerificationOptions = {},
): VerificationResult {
  const file = parseAssemblyFile(input);
  if (file.components.length > MAX_VERIFIED_COMPONENTS) {
    throw new VerificationError(
      `Designs above ${MAX_VERIFIED_COMPONENTS} components cannot be verified yet (this one has ${file.components.length}).`,
    );
  }
  if (file.connections.length > MAX_VERIFIED_CONNECTIONS) {
    throw new VerificationError(
      `Designs above ${MAX_VERIFIED_CONNECTIONS} connections cannot be verified yet.`,
    );
  }

  const durationSec = options.durationSec ?? STANDARD_SCENARIO.durationSec;
  const windowSec = options.averagingWindowSec ?? STANDARD_SCENARIO.averagingWindowSec;
  const world = deserializeWorld(file);
  world.reset();
  const stepsPerSecond = Math.round(1 / world.settings.fixedTimestepSec);
  const windowStartTick = (durationSec - windowSec) * stepsPerSecond;

  const sums = { net: 0, gross: 0, house: 0, fusion: 0, aux: 0 };
  let samples = 0;
  let worstConfidence: ConfidenceLevel = "supported";
  const reasons = new Set<string>();

  for (let second = 0; second < durationSec; second += 1) {
    for (let i = 0; i < stepsPerSecond; i += 1) {
      world.step();
      if (world.tick > windowStartTick) {
        const plant = world.plantSummary;
        sums.net += plant.metrics.netElectricW;
        sums.gross += plant.metrics.grossElectricW;
        sums.house += plant.metrics.houseLoadW;
        sums.fusion += plant.metrics.fusionPowerW;
        sums.aux += plant.metrics.auxiliaryHeatingW;
        samples += 1;
      }
    }
    // Confidence is judged over the whole run: a design that was experimental at any
    // point is experimental.
    const confidence = world.plantSummary.confidence;
    worstConfidence = worstLevel([worstConfidence, confidence.level]);
    for (const subsystem of confidence.subsystems) {
      if (subsystem.level !== "supported")
        for (const reason of subsystem.reasons) reasons.add(reason);
    }
    if (options.onProgress?.(second + 1) === false)
      throw new VerificationError("Verification aborted.");
  }

  const snapshot = world.getSnapshot();
  const n = Math.max(samples, 1);
  const averages: WindowAverages = {
    netElectricW: sums.net / n,
    grossElectricW: sums.gross / n,
    houseLoadW: sums.house / n,
    fusionPowerW: sums.fusion / n,
    auxiliaryHeatingW: sums.aux / n,
    plasmaGainQ: sums.aux > 0 ? sums.fusion / sums.aux : 0,
  };
  const disrupted = snapshot.failures.some((f) => f.failureType === "disruption");
  const phases = snapshot.components
    .filter((c) => c.state.plant.vessel !== null)
    .map((c) => c.state.plant.vessel!.plasma.phase);

  const experimental = worstConfidence === "experimental";
  const base = experimental
    ? { eligible: false, reason: "Experimental designs are not eligible for verified rankings." }
    : { eligible: true };

  const scores: CategoryScore[] = [
    { category: "net-electric", value: averages.netElectricW / 1e6, ...base },
    averages.auxiliaryHeatingW >= 1e6
      ? { category: "fusion-gain", value: averages.plasmaGainQ, ...base }
      : {
          category: "fusion-gain",
          value: 0,
          eligible: false,
          reason: "Needs at least 1 MW of auxiliary heating over the averaging period.",
        },
    averages.netElectricW > 0
      ? { category: "lightest-net-positive", value: snapshot.assembly.totalMassKg / 1000, ...base }
      : {
          category: "lightest-net-positive",
          value: snapshot.assembly.totalMassKg / 1000,
          eligible: false,
          reason: "Net electrical output is not above zero.",
        },
  ];

  return Object.freeze({
    protocolVersion: VERIFICATION_PROTOCOL_VERSION,
    engineVersion: SIMULATION_ENGINE_VERSION,
    scenarioId: options.durationSec === undefined ? STANDARD_SCENARIO.id : `custom-${durationSec}s`,
    designHash: designHash(file),
    durationSec,
    ticks: world.tick,
    componentCount: file.components.length,
    totalMassKg: snapshot.assembly.totalMassKg,
    averages,
    finalPlasmaPhases: phases,
    disrupted,
    failureCount: snapshot.failures.length,
    confidence: worstConfidence,
    confidenceReasons: [...reasons].sort(),
    scores,
  });
}

/**
 * Compares a client's claimed score with the server's recomputation. Scores from the same
 * engine version on the same JavaScript engine match exactly; different engines may differ
 * in the last bits of transcendental functions, so a small relative tolerance is allowed.
 * A mismatch is recorded, and the server's value is what is stored either way.
 */
export function claimMatches(claimed: number, verified: number, relativeTolerance = 1e-6): boolean {
  if (!Number.isFinite(claimed) || !Number.isFinite(verified)) return false;
  const scale = Math.max(Math.abs(verified), 1e-9);
  return Math.abs(claimed - verified) / scale <= relativeTolerance;
}
