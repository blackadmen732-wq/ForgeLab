/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Legacy name for the publishable key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SITE_URL?: string;
  /** PostHog project key (public, phc_…); analytics are off without it. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion origin (default https://us.i.posthog.com). */
  readonly VITE_POSTHOG_HOST?: string;
  /** Public origin of the 3D asset bucket (Cloudflare R2), e.g. https://assets.example.com. */
  readonly VITE_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
