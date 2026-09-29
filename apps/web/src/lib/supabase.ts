import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * The Supabase client, created on first use.
 *
 * It is loaded with a dynamic import so the builder and landing page never pay for it
 * until something needs the cloud, and it is never created at all when the deployment has
 * no Supabase configuration — the sandbox works fully offline.
 */
let client: Promise<SupabaseClient | null> | undefined;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!env.cloudConfigured) return Promise.resolve(null);
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    }),
  );
  return client;
}

export async function requireSupabase(): Promise<SupabaseClient> {
  const supabase = await getSupabase();
  if (supabase === null) throw new CloudUnavailableError();
  return supabase;
}

export class CloudUnavailableError extends Error {
  constructor() {
    super("Cloud features are not configured on this deployment.");
    this.name = "CloudUnavailableError";
  }
}
