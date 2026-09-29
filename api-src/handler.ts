import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MAX_BODY_BYTES, handleVerify, type VerifyDeps } from "./verify.js";

/**
 * Node adapter for /api/verify (Vercel Node runtime, or `node` locally).
 *
 * Server-only environment:
 *   SUPABASE_URL                  project URL
 *   SUPABASE_SECRET_KEY           secret key (sb_secret_...) — or the legacy
 *   SUPABASE_SERVICE_ROLE_KEY     service_role JWT
 * These are never prefixed with VITE_ and never reach the browser bundle.
 */

interface ServerEnv {
  readonly url: string;
  readonly secretKey: string;
}

export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const url = (source.SUPABASE_URL ?? source.VITE_SUPABASE_URL ?? "").trim();
  const secretKey = (source.SUPABASE_SECRET_KEY ?? source.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (url === "" || secretKey === "") {
    throw new Error(
      "The verification service is not configured (SUPABASE_URL and SUPABASE_SECRET_KEY).",
    );
  }
  return { url, secretKey };
}

let admin: SupabaseClient | undefined;

function adminClient(env: ServerEnv): SupabaseClient {
  admin ??= createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

export function supabaseDeps(supabase: SupabaseClient): VerifyDeps {
  return {
    async authenticate(token) {
      const { data, error } = await supabase.auth.getUser(token);
      return error !== null || data.user === null ? null : { id: data.user.id };
    },
    async countRecentRuns(userId, sinceIso) {
      const { count, error } = await supabase
        .from("simulation_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("verified", true)
        .gte("created_at", sinceIso);
      if (error !== null) throw new Error(error.message);
      return count ?? 0;
    },
    async loadVersion(projectId, versionId) {
      const { data, error } = await supabase
        .from("project_versions")
        .select(
          "id, project_id, design, design_hash, projects!project_versions_project_id_fkey!inner(id, owner_id, visibility)",
        )
        .eq("id", versionId)
        .eq("project_id", projectId)
        .maybeSingle<{
          id: string;
          project_id: string;
          design: unknown;
          design_hash: string;
          projects: { id: string; owner_id: string; visibility: string };
        }>();
      if (error !== null) throw new Error(error.message);
      if (data === null) return null;
      return {
        project: {
          id: data.projects.id,
          ownerId: data.projects.owner_id,
          visibility: data.projects.visibility,
        },
        version: {
          id: data.id,
          projectId: data.project_id,
          design: data.design,
          designHash: data.design_hash,
        },
      };
    },
    async recordRun({ userId, projectId, versionId, result }) {
      const { data, error } = await supabase
        .from("simulation_runs")
        .insert({
          project_id: projectId,
          version_id: versionId,
          user_id: userId,
          engine_version: result.engineVersion,
          scenario_id: result.scenarioId,
          duration_sec: result.durationSec,
          verified: true,
          results: {
            protocolVersion: result.protocolVersion,
            designHash: result.designHash,
            totalMassKg: result.totalMassKg,
            averages: result.averages,
            confidence: result.confidence,
            confidenceReasons: result.confidenceReasons,
            failureCount: result.failureCount,
            disrupted: result.disrupted,
            finalPlasmaPhases: result.finalPlasmaPhases,
            scores: result.scores,
          },
        })
        .select("id")
        .single<{ id: string }>();
      if (error !== null) throw new Error(error.message);
      return data.id;
    },
    async recordEntry({ userId, projectId, versionId, runId, score, result }) {
      const { error } = await supabase.from("leaderboard_entries").insert({
        category: score.category,
        user_id: userId,
        project_id: projectId,
        version_id: versionId,
        run_id: runId,
        value: score.value,
        engine_version: result.engineVersion,
        protocol_version: result.protocolVersion,
        scenario_id: result.scenarioId,
        design_hash: result.designHash,
        confidence: result.confidence,
      });
      if (error === null) return true;
      if (error.code === "23505") return false; // this exact design is already entered
      throw new Error(error.message);
    },
    now: () => Date.now(),
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be JSON."), { status: 400 });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("allow", "POST");
      res.end();
      return;
    }
    const env = readServerEnv();
    const body = req.method === "POST" ? await readJson(req) : null;
    const auth = req.headers.authorization;
    const response = await handleVerify(
      { method: req.method ?? "GET", authorization: Array.isArray(auth) ? auth[0] : auth, body },
      supabaseDeps(adminClient(env)),
    );
    send(res, response.status, response.body);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    // Internal details stay in the function log.
    if (status === 500) console.error("verify failed:", error);
    send(res, status, {
      error: status === 500 ? "Verification failed on the server." : (error as Error).message,
    });
  }
}
