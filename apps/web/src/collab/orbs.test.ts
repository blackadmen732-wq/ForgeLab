import { describe, expect, it } from "vitest";
import type { PresenceEntry } from "@forgelab/protocol";
import type { VoiceMember } from "@forgelab/voice";
import { ORB_COLORS, activityText, orbColor, orbDetail, orbEntries, orbPulse } from "./orbs.js";

const entry = (userId: string, patch: Partial<PresenceEntry> = {}): PresenceEntry => ({
  userId,
  name: userId.toUpperCase(),
  role: "member",
  voiceChannelId: null,
  mic: "unmuted",
  deafened: false,
  activity: "building",
  workspaceId: "ws",
  focus: "pump",
  seenAt: 0,
  seq: 0,
  ...patch,
});
const voice = (identity: string, level: number): VoiceMember => ({
  identity,
  name: identity,
  micEnabled: true,
  isLocal: false,
  speaking: level > 0,
  level,
});

describe("presence orbs", () => {
  it("give each teammate a stable colour from the palette", () => {
    expect(orbColor("maya")).toBe(orbColor("maya"));
    expect(ORB_COLORS).toContain(orbColor("andre"));
  });

  it("shrink from label to orb to dot with distance, later for big parts", () => {
    expect(orbDetail(10, 1)).toBe("label");
    expect(orbDetail(60, 1)).toBe("orb");
    expect(orbDetail(200, 1)).toBe("dot");
    expect(orbDetail(60, 10)).toBe("label");
  });

  it("pulse with loudness and sit still when silent", () => {
    expect(orbPulse(0, 3)).toBe(1);
    const quiet = Math.max(...[0, 0.1, 0.2, 0.3].map((t) => orbPulse(0.2, t)));
    const loud = Math.max(...[0, 0.1, 0.2, 0.3].map((t) => orbPulse(1, t)));
    expect(loud).toBeGreaterThan(quiet);
  });

  it("describe what the teammate is doing", () => {
    expect(activityText("building")).toBe("Editing");
    expect(activityText("observing")).toBe("Inspecting");
  });

  it("show teammates focused on parts that exist here — never yourself", () => {
    const roster = [
      entry("me"),
      entry("maya", { focus: "tf-coil" }),
      entry("andre", { focus: "ghost" }),
      entry("chris", { focus: null }),
      entry("sam", { workspaceId: "other" }),
    ];
    const orbs = orbEntries(roster, [voice("maya", 0.7)], "me", "ws", (id) => id !== "ghost");
    expect(orbs.map((o) => o.userId)).toEqual(["maya"]);
    expect(orbs[0]).toMatchObject({ focus: "tf-coil", speaking: true, level: 0.7, muted: false });
  });
});
