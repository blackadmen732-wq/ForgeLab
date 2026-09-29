/**
 * Server-only configuration. None of these are prefixed with VITE_ and none reach the
 * browser bundle (scripts/build-vercel.mjs scans for secret keys).
 */
export interface SupabaseEnv {
  readonly url: string;
  /** Secret key: service-role access for writes the browser must not make. */
  readonly secretKey: string;
  /** Publishable key: used with the caller's JWT so Postgres evaluates *their* access. */
  readonly publishableKey: string;
}

export interface VoiceEnv {
  /** wss:// URL clients connect to. */
  readonly clientUrl: string;
  /** https:// URL for room administration. */
  readonly adminUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

const configError = (message: string) => Object.assign(new Error(message), { status: 503 });

export function readSupabaseEnv(source: NodeJS.ProcessEnv = process.env): SupabaseEnv {
  const url = (source.SUPABASE_URL ?? source.VITE_SUPABASE_URL ?? "").trim();
  const secretKey = (source.SUPABASE_SECRET_KEY ?? source.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const publishableKey = (
    source.SUPABASE_PUBLISHABLE_KEY ??
    source.VITE_SUPABASE_PUBLISHABLE_KEY ??
    source.VITE_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  if (url === "" || secretKey === "" || publishableKey === "") {
    throw configError(
      "The server is not configured (SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY).",
    );
  }
  return { url, secretKey, publishableKey };
}

export function readVoiceEnv(source: NodeJS.ProcessEnv = process.env): VoiceEnv {
  const clientUrl = (source.VITE_LIVEKIT_URL ?? source.LIVEKIT_URL ?? "").trim();
  const adminUrl = (source.LIVEKIT_URL ?? clientUrl).trim().replace(/^ws(s?):/, "http$1:");
  const apiKey = (source.LIVEKIT_API_KEY ?? "").trim();
  const apiSecret = (source.LIVEKIT_API_SECRET ?? "").trim();
  if (clientUrl === "" || apiKey === "" || apiSecret.length < 32) {
    throw configError(
      "Voice is not configured on this deployment (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).",
    );
  }
  return { clientUrl, adminUrl, apiKey, apiSecret };
}

export function readPresenceKey(source: NodeJS.ProcessEnv = process.env): string {
  const pem = (source.FORGELAB_PRESENCE_KEY ?? "").replace(/\\n/g, "\n").trim();
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw configError("Presence signing is not configured (FORGELAB_PRESENCE_KEY).");
  }
  return pem;
}
