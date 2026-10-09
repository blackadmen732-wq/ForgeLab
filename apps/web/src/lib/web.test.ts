import { describe, expect, it } from "vitest";
import { readEnvironment } from "./env.js";
import { gain, kelvin, mass, megawatts, si } from "./format.js";
import { safeNext } from "./redirect.js";

const fakeJwt = (payload: object) =>
  ["e30", btoa(JSON.stringify(payload)).replace(/=+$/, ""), "sig"].join(".");

describe("browser environment", () => {
  it("runs in local mode when no cloud is configured", () => {
    const env = readEnvironment({} as ImportMetaEnv);
    expect(env.cloudConfigured).toBe(false);
  });

  it("accepts a project URL with a publishable key", () => {
    const env = readEnvironment({
      VITE_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123",
    } as ImportMetaEnv);
    expect(env.cloudConfigured).toBe(true);
    expect(env.problems).toEqual([]);
  });

  it("refuses a secret key", () => {
    const env = readEnvironment({
      VITE_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc",
    } as ImportMetaEnv);
    expect(env.cloudConfigured).toBe(false);
    expect(env.problems.join(" ")).toMatch(/secret/i);
  });

  it("refuses a legacy service_role JWT but accepts an anon JWT", () => {
    const base = { VITE_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" };
    expect(
      readEnvironment({
        ...base,
        VITE_SUPABASE_ANON_KEY: fakeJwt({ role: "service_role" }),
      } as ImportMetaEnv).cloudConfigured,
    ).toBe(false);
    expect(
      readEnvironment({
        ...base,
        VITE_SUPABASE_ANON_KEY: fakeJwt({ role: "anon" }),
      } as ImportMetaEnv).cloudConfigured,
    ).toBe(true);
  });

  it("rejects a URL that is not a Supabase project", () => {
    const env = readEnvironment({
      VITE_SUPABASE_URL: "https://evil.example.com",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123",
    } as ImportMetaEnv);
    expect(env.cloudConfigured).toBe(false);
  });
});

describe("post-sign-in redirects", () => {
  it("follows same-site paths only", () => {
    expect(safeNext("/app/123?x=1")).toBe("/app/123?x=1");
    expect(safeNext(null)).toBe("/projects");
    expect(safeNext("https://evil.example.com")).toBe("/projects");
    expect(safeNext("//evil.example.com")).toBe("/projects");
    expect(safeNext("/\\evil.example.com")).toBe("/projects");
    expect(safeNext("javascript:alert(1)")).toBe("/projects");
  });
});

describe("formatting", () => {
  it("formats SI values", () => {
    expect(si(1.5e6, "W")).toBe("1.50 MW");
    expect(si(0, "Pa")).toBe("0 Pa");
    expect(megawatts(-85.3e6)).toBe("−85.3 MW");
    expect(mass(13_098_000)).toBe("13098 t");
    expect(mass(512)).toBe("512 kg");
    expect(kelvin(553.4)).toBe("553 K");
    expect(gain(Infinity)).toBe("∞");
    expect(gain(3.674)).toBe("3.67");
  });
});
