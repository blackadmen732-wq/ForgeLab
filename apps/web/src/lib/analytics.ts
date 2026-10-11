import { safeStorage } from "./storage.js";

/**
 * Product analytics (PostHog), anonymous and opt-out.
 *
 * - Off unless the deployment sets VITE_POSTHOG_KEY (a public project key, `phc_…`). A
 *   personal API key (`phx_…`) is a secret: it is refused and analytics stay off.
 * - Off when the viewer opted out (settings menu), or the browser sends Do Not Track or
 *   Global Privacy Control.
 * - Anonymous: no identify() call, no person profiles, no email or account id is ever
 *   sent. No autocapture of clicks or text, no session recording, no surveys, no heatmaps,
 *   and no extra scripts fetched from PostHog (the CSP stays script-src 'self').
 * - Events describe the build → run → fail → fix loop with counts and catalogue ids only;
 *   never design contents, names or chat.
 * - The library is loaded lazily, after the app starts, and only when enabled.
 */
export type AnalyticsEvent =
  | "plant_activated"
  | "run_failed"
  | "part_added"
  | "kit_placed"
  | "assembly_placed"
  | "assembly_saved"
  | "parts_grouped"
  | "group_taken_apart";

type Props = Readonly<Record<string, string | number | boolean>>;

interface Client {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  opt_out_capturing(): void;
  opt_in_capturing(): void;
}

const OPT_OUT_KEY = "forgelab.analytics.v1";

export interface AnalyticsConfig {
  readonly key: string;
  readonly host: string;
  readonly problems: readonly string[];
}

export function readAnalyticsConfig(
  source: Partial<Record<string, string | undefined>> = import.meta.env,
): AnalyticsConfig | null {
  const key = (source["VITE_POSTHOG_KEY"] ?? "").trim();
  if (key === "") return null;
  const host = (source["VITE_POSTHOG_HOST"] ?? "https://us.i.posthog.com").trim();
  const problems: string[] = [];
  if (key.startsWith("phx_"))
    problems.push("VITE_POSTHOG_KEY is a personal API key (secret). Use the project key (phc_).");
  else if (!key.startsWith("phc_")) problems.push("VITE_POSTHOG_KEY is not a project key (phc_).");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(host))
    problems.push("VITE_POSTHOG_HOST must be an https origin.");
  return { key, host, problems };
}

function browserSaysNo(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

let client: Client | null = null;
let starting = false;
const queue: Array<[AnalyticsEvent, Props | undefined]> = [];
const listeners = new Set<() => void>();

export const analytics = {
  /** Whether this deployment has analytics at all (the settings toggle is shown only then). */
  available(): boolean {
    const config = readAnalyticsConfig();
    return config !== null && config.problems.length === 0 && !browserSaysNo();
  },
  /** The viewer's choice (on unless they opted out). */
  enabled(): boolean {
    return analytics.available() && safeStorage.get(OPT_OUT_KEY) !== "off";
  },
  setEnabled(on: boolean): void {
    safeStorage.set(OPT_OUT_KEY, on ? "on" : "off");
    if (on) {
      client?.opt_in_capturing();
      void analytics.start();
    } else {
      client?.opt_out_capturing();
      queue.length = 0;
    }
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Loads PostHog if allowed. Safe to call more than once; a no-op in tests and SSR. */
  async start(): Promise<void> {
    if (client !== null || starting || typeof window === "undefined" || !analytics.enabled())
      return;
    const config = readAnalyticsConfig()!;
    starting = true;
    try {
      const { default: posthog } = await import("posthog-js");
      posthog.init(config.key, {
        api_host: config.host,
        autocapture: false,
        rageclick: false,
        capture_pageview: "history_change",
        capture_pageleave: true,
        capture_performance: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: true,
        advanced_disable_flags: true,
        person_profiles: "never",
        persistence: "localStorage",
        save_referrer: false,
        respect_dnt: true,
        mask_all_text: true,
      });
      client = posthog;
      for (const [event, props] of queue.splice(0)) client.capture(event, { ...props });
    } catch {
      // Blocked by an extension or offline: analytics are optional.
    } finally {
      starting = false;
    }
  },
  /** Records a product event (dropped silently when analytics are off). */
  track(event: AnalyticsEvent, props?: Props): void {
    if (!analytics.enabled()) return;
    if (client !== null) client.capture(event, { ...props });
    else if (queue.length < 50) queue.push([event, props]);
  },
};
