import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { importServerKey, isProjectRole } from "@forgelab/protocol";
import type { CommsDeps } from "./comms.js";
import { readPresenceKey, readSupabaseEnv, readVoiceEnv, type SupabaseEnv } from "./env.js";
import { removeParticipant } from "./livekit.js";

/**
 * Supabase-backed dependencies for the comms endpoints.
 *
 * Questions about access are asked with a client that carries the *caller's* JWT and the
 * publishable key, so Postgres evaluates them exactly as it would for the browser —
 * membership and channel permissions come from the same functions the RLS policies use.
 * The secret key is used only for rate limiting and for listing a project's channels when
 * evicting a removed member from voice.
 */
const noSession = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

let admin: SupabaseClient | undefined;
let presenceKey: ReturnType<typeof importServerKey> | undefined;

function asUser(env: SupabaseEnv, token: string): SupabaseClient {
  return createClient(env.url, env.publishableKey, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function withStatus(message: string, code: string | undefined): Error {
  const status = code === "42501" ? 403 : code === "P0002" ? 404 : code === "22023" ? 400 : 500;
  return Object.assign(new Error(status === 500 ? "Database error." : message), { status });
}

export function commsDeps(): CommsDeps {
  const env = readSupabaseEnv();
  admin ??= createClient(env.url, env.secretKey, { auth: noSession });
  const service = admin;
  return {
    async authenticate(token) {
      const { data, error } = await service.auth.getUser(token);
      return error !== null || data.user === null ? null : { id: data.user.id };
    },
    async consumeRate(userId, bucket, max, windowSec) {
      const { data, error } = await service.rpc("consume_rate", {
        p_user: userId,
        p_bucket: bucket,
        p_max: max,
        p_window_sec: windowSec,
      });
      if (error !== null) throw withStatus(error.message, error.code);
      return data === true;
    },
    async projectAccess(token, projectId) {
      const { data, error } = await asUser(env, token).rpc("project_access", {
        p_project: projectId,
      });
      if (error !== null) throw withStatus(error.message, error.code);
      const row = data as { role?: unknown; name?: unknown } | null;
      if (row === null || !isProjectRole(row.role) || typeof row.name !== "string") return null;
      return { role: row.role, name: row.name };
    },
    async channelAccess(token, channelId) {
      const { data, error } = await asUser(env, token).rpc("channel_access", {
        p_channel: channelId,
      });
      if (error !== null) throw withStatus(error.message, error.code);
      const row = data as {
        project_id?: unknown;
        is_private?: unknown;
        permissions?: unknown;
      } | null;
      if (row === null || typeof row.project_id !== "string" || !Array.isArray(row.permissions))
        return null;
      return {
        projectId: row.project_id,
        isPrivate: row.is_private === true,
        permissions: row.permissions.filter((p): p is string => typeof p === "string"),
      };
    },
    async removeMember(token, projectId, userId) {
      const { error } = await asUser(env, token).rpc("remove_member", {
        p_project: projectId,
        p_user: userId,
      });
      if (error !== null) throw withStatus(error.message, error.code);
    },
    async projectChannelIds(projectId) {
      const { data, error } = await service
        .from("channels")
        .select("id")
        .eq("project_id", projectId);
      if (error !== null) throw withStatus(error.message, error.code);
      return (data as { id: string }[]).map((c) => c.id);
    },
    async evict(voice, room, identity) {
      await removeParticipant(voice, room, identity);
    },
    presenceKey() {
      presenceKey ??= importServerKey(readPresenceKey());
      return presenceKey;
    },
    voiceEnv: () => readVoiceEnv(),
    nowMs: () => Date.now(),
  };
}
