import { SIMULATION_ENGINE_VERSION, parseAssemblyFile } from "@forgelab/sim-core";
import {
  STANDARD_SCENARIO,
  VERIFICATION_PROTOCOL_VERSION,
  VerificationError,
  designHash,
  runVerification,
  type VerificationResult,
} from "@forgelab/sim-runner";

/**
 * POST /api/verify — server-side leaderboard verification.
 *
 * The browser sends only *which* saved version to verify. The server loads that design
 * itself with the service role, checks the caller owns it, recomputes the standard
 * scenario with the same deterministic engine, and writes the run and any leaderboard
 * entries. Nothing the browser reports about results is read; that is the whole point.
 *
 * This file is the runtime-independent core: every side effect goes through `VerifyDeps`
 * so it can be tested without a network. `handler.ts` wires it to Node and Supabase.
 */

export interface VersionRecord {
  readonly project: { readonly id: string; readonly ownerId: string; readonly visibility: string };
  readonly version: {
    readonly id: string;
    readonly projectId: string;
    readonly design: unknown;
    readonly designHash: string;
  };
}

export interface ScoreRecord {
  readonly category: string;
  readonly value: number;
}

export interface VerifyDeps {
  /** Validates an access token with Supabase Auth; null when invalid or expired. */
  authenticate(token: string): Promise<{ id: string } | null>;
  /** Verified runs by this user since `sinceIso` (rate limiting). */
  countRecentRuns(userId: string, sinceIso: string): Promise<number>;
  loadVersion(projectId: string, versionId: string): Promise<VersionRecord | null>;
  recordRun(input: {
    userId: string;
    projectId: string;
    versionId: string;
    result: VerificationResult;
  }): Promise<string>;
  /** Inserts an entry unless the same design already has one; true when inserted. */
  recordEntry(input: {
    userId: string;
    projectId: string;
    versionId: string;
    runId: string;
    score: ScoreRecord;
    result: VerificationResult;
  }): Promise<boolean>;
  now(): number;
}

export interface VerifyRequest {
  readonly method: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface VerifyResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Verified submissions per user per window. Recomputation costs real CPU. */
export const RATE_LIMIT_RUNS = 6;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
/** Largest request body accepted, in bytes (it only carries two ids). */
export const MAX_BODY_BYTES = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, error: string): VerifyResponse => ({ status, body: { error } });

export async function handleVerify(
  request: VerifyRequest,
  deps: VerifyDeps,
): Promise<VerifyResponse> {
  if (request.method !== "POST") return fail(405, "Use POST.");

  const match = /^Bearer\s+(\S+)$/i.exec(request.authorization ?? "");
  if (match === null) return fail(401, "Sign in to submit a score.");
  const user = await deps.authenticate(match[1]!);
  if (user === null) return fail(401, "Your session has expired. Sign in again.");

  const body = request.body as { projectId?: unknown; versionId?: unknown } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const versionId = typeof body?.versionId === "string" ? body.versionId : "";
  if (!UUID.test(projectId) || !UUID.test(versionId))
    return fail(400, "projectId and versionId must be UUIDs.");

  const since = new Date(deps.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  if ((await deps.countRecentRuns(user.id, since)) >= RATE_LIMIT_RUNS) {
    return fail(
      429,
      `At most ${RATE_LIMIT_RUNS} verifications every ${RATE_LIMIT_WINDOW_MS / 60000} minutes. Try again shortly.`,
    );
  }

  const record = await deps.loadVersion(projectId, versionId);
  if (record === null || record.version.projectId !== projectId)
    return fail(404, "That version doesn't exist.");
  if (record.project.ownerId !== user.id)
    return fail(403, "Only the owner of a design can submit it.");
  if (record.project.visibility !== "public")
    return fail(409, "Publish the design first: leaderboards list public designs only.");

  // The stored hash was written by a browser; recompute it rather than trust it.
  let file;
  try {
    file = parseAssemblyFile(record.version.design);
  } catch (error) {
    return fail(422, `The saved design could not be read: ${messageOf(error)}`);
  }
  const hash = designHash(file);
  if (hash !== record.version.designHash)
    return fail(409, "The saved design does not match its recorded hash.");

  let result: VerificationResult;
  try {
    result = runVerification(file);
  } catch (error) {
    if (error instanceof VerificationError) return fail(422, error.message);
    throw error;
  }

  const runId = await deps.recordRun({ userId: user.id, projectId, versionId, result });
  const scores = [];
  for (const score of result.scores) {
    let entered = false;
    if (score.eligible) {
      entered = await deps.recordEntry({
        userId: user.id,
        projectId,
        versionId,
        runId,
        score: { category: score.category, value: score.value },
        result,
      });
    }
    scores.push({ ...score, entered });
  }

  return {
    status: 200,
    body: {
      runId,
      designHash: result.designHash,
      engineVersion: result.engineVersion,
      protocolVersion: result.protocolVersion,
      scenarioId: result.scenarioId,
      confidence: result.confidence,
      confidenceReasons: result.confidenceReasons,
      totalMassKg: result.totalMassKg,
      failureCount: result.failureCount,
      disrupted: result.disrupted,
      averages: result.averages,
      scores,
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const VERIFY_CONSTANTS = Object.freeze({
  engineVersion: SIMULATION_ENGINE_VERSION,
  protocolVersion: VERIFICATION_PROTOCOL_VERSION,
  scenario: STANDARD_SCENARIO,
});
