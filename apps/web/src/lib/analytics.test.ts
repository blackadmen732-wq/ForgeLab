import { describe, expect, it } from "vitest";
import { analytics, readAnalyticsConfig } from "./analytics.js";

describe("analytics configuration", () => {
  it("is off without a key, and refuses a personal (secret) key", () => {
    expect(readAnalyticsConfig({})).toBeNull();
    expect(readAnalyticsConfig({ VITE_POSTHOG_KEY: "phx_secret" })!.problems[0]).toMatch(
      /personal API key/,
    );
    expect(readAnalyticsConfig({ VITE_POSTHOG_KEY: "phc_abc" })).toEqual({
      key: "phc_abc",
      host: "https://us.i.posthog.com",
      problems: [],
    });
    expect(
      readAnalyticsConfig({ VITE_POSTHOG_KEY: "phc_abc", VITE_POSTHOG_HOST: "http://x" })!.problems,
    ).toHaveLength(1);
  });

  it("does nothing when unconfigured: tracking is a silent no-op", async () => {
    expect(analytics.available()).toBe(false);
    expect(() => analytics.track("part_added", { type: "coolant-pump" })).not.toThrow();
    await analytics.start();
  });
});
