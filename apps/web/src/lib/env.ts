/**
 * Browser environment.
 *
 * Only PUBLIC values ever reach this file: the Supabase project URL and its publishable
 * (anon) key, which are designed to be exposed and are constrained by row-level security.
 * A service-role or secret key must never be bundled into the browser; if one is supplied
 * by mistake ForgeLab refuses to use it and runs in local-only mode instead.
 */
export interface ClientEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseKey: string;
  readonly siteUrl: string;
  readonly cloudConfigured: boolean;
  readonly problems: readonly string[];
}

function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      role?: string;
    };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function readEnvironment(source: ImportMetaEnv = import.meta.env): ClientEnvironment {
  const supabaseUrl = (source.VITE_SUPABASE_URL ?? "").trim();
  const supabaseKey = (
    source.VITE_SUPABASE_PUBLISHABLE_KEY ??
    source.VITE_SUPABASE_ANON_KEY ??
    ""
  ).trim();
  const siteUrl = (
    source.VITE_SITE_URL ?? (typeof window === "undefined" ? "" : window.location.origin)
  ).trim();
  const problems: string[] = [];

  if (supabaseUrl === "" && supabaseKey === "") {
    problems.push(
      "Cloud features are not configured on this deployment; designs save to this browser.",
    );
  } else {
    if (
      !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
        supabaseUrl,
      )
    ) {
      problems.push("VITE_SUPABASE_URL is not a Supabase project URL.");
    }
    if (supabaseKey === "") problems.push("VITE_SUPABASE_PUBLISHABLE_KEY is missing.");
    if (looksLikeSecretKey(supabaseKey)) {
      problems.push(
        "A secret/service-role key was supplied to the browser. It has been ignored — rotate it now.",
      );
    }
  }

  const cloudConfigured =
    problems.length === 0 &&
    supabaseUrl !== "" &&
    supabaseKey !== "" &&
    !looksLikeSecretKey(supabaseKey);
  return { supabaseUrl, supabaseKey, siteUrl, cloudConfigured, problems };
}

export const env = readEnvironment();
