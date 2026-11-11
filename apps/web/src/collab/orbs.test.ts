import { describe, expect, it } from "vitest";
import type { PresenceEntry } from "@forgelab/protocol";
import type { VoiceMember } from "@forgelab/voice";
import {
  ACTION_LABELS,
  ORB_COLORS,
  type OrbEntry,
  activityText,
  editorsOf,
  orbAction,
  orbColor,
  orbDetail,
  orbEntries,
  orbPulse,
  orbSlot,
  presenceAction,
  ringPhase,
  voiceRings,
} from "./orbs.js";

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

  it("change level exactly at the documented distances", () => {
    // A 1 m part: label to 31 m, orb to 82 m, dot beyond.
    expect(orbDetail(31, 1)).toBe("label");
    expect(orbDetail(31.01, 1)).toBe("orb");
    expect(orbDetail(82, 1)).toBe("orb");
    expect(orbDetail(82.01, 1)).toBe("dot");
    // Tiny parts are treated as half a metre, so a bolt does not lose its label at arm's length.
    expect(orbDetail(28, 0.01)).toBe("label");
    expect(orbDetail(28.01, 0.01)).toBe("orb");
    // The three levels are ordered: moving away never brings detail back.
    const rank = { label: 0, orb: 1, dot: 2 } as const;
    let last = 0;
    for (let d = 0; d <= 600; d += 3) {
      const now = rank[orbDetail(d, 4)];
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(2);
  });

  it("pulse with loudness and sit still when silent", () => {
    expect(orbPulse(0, 3)).toBe(1);
    const quiet = Math.max(...[0, 0.1, 0.2, 0.3].map((t) => orbPulse(0.2, t)));
    const loud = Math.max(...[0, 0.1, 0.2, 0.3].map((t) => orbPulse(1, t)));
    expect(loud).toBeGreaterThan(quiet);
  });

  it("count voice rings: none silent, more for louder speech", () => {
    expect(voiceRings(0)).toBe(0);
    expect(voiceRings(0.01)).toBe(0);
    expect(voiceRings(0.15)).toBe(1);
    expect(voiceRings(0.45)).toBe(2);
    expect(voiceRings(0.9)).toBe(3);
    expect(voiceRings(Number.NaN)).toBe(0);
  });

  it("throw rings further for loud speech and fade them as they grow", () => {
    const start = ringPhase(0, 3, 1, 0);
    const late = ringPhase(0, 3, 1, 1);
    expect(late.scale).toBeGreaterThan(start.scale);
    expect(late.opacity).toBeLessThan(start.opacity);
    const quietReach = Math.max(...[0, 0.3, 0.6, 0.9, 1.1].map((t) => ringPhase(0, 1, 0.1, t).scale));
    const loudReach = Math.max(...[0, 0.3, 0.6, 0.9, 1.1].map((t) => ringPhase(0, 3, 1, t).scale));
    expect(loudReach).toBeGreaterThan(quietReach);
    // A ring beyond the count is not drawn.
    expect(ringPhase(2, 2, 1, 0.4).opacity).toBe(0);
  });

  it("describe what the teammate is doing", () => {
    expect(activityText("building")).toBe("Editing");
    expect(activityText("observing")).toBe("Inspecting");
    expect(activityText("simulating")).toBe("Viewing");
    expect(Object.values(ACTION_LABELS)).toEqual([
      "Inspecting",
      "Editing",
      "Moving",
      "Viewing",
      "Configuring",
    ]);
  });

  it("prefer the action a client states over the coarse activity", () => {
    expect(orbAction({ activity: "building" })).toBe("editing");
    expect(orbAction({ activity: "building", action: null })).toBe("editing");
    expect(orbAction({ activity: "building", action: "moving" })).toBe("moving");
    expect(orbAction({ activity: "observing", action: "configuring" })).toBe("configuring");
  });

  it("show teammates focused on parts that exist here — never yourself", () => {
    const roster = [
      entry("me"),
      entry("maya", { focus: "tf-coil", role: "owner", action: "moving" }),
      entry("andre", { focus: "ghost" }),
      entry("chris", { focus: null }),
      entry("sam", { workspaceId: "other" }),
    ];
    const orbs = orbEntries(roster, [voice("maya", 0.7)], "me", "ws", (id) => id !== "ghost");
    expect(orbs.map((o) => o.userId)).toEqual(["maya"]);
    expect(orbs[0]).toMatchObject({
      focus: "tf-coil",
      speaking: true,
      level: 0.7,
      muted: false,
      role: "owner",
      action: "moving",
    });
  });

  it("fan several orbs out around one part instead of stacking them", () => {
    expect(orbSlot(0, 1)).toEqual({ x: 0, z: 0 });
    const three = [0, 1, 2].map((i) => orbSlot(i, 3));
    for (const a of three)
      for (const b of three)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
  });
});

describe("what this member publishes", () => {
  const base = {
    mode: "build" as const,
    readOnly: false,
    dragging: false,
    configuring: false,
    inspecting: false,
  };
  it("names the most specific thing they are doing", () => {
    expect(presenceAction(base)).toBe("editing");
    expect(presenceAction({ ...base, inspecting: true })).toBe("inspecting");
    expect(presenceAction({ ...base, configuring: true, inspecting: true })).toBe("configuring");
    expect(presenceAction({ ...base, dragging: true, configuring: true })).toBe("moving");
  });
  it("never claims an edit while simulating or without edit access", () => {
    expect(presenceAction({ ...base, mode: "simulate", dragging: true })).toBe("viewing");
    expect(presenceAction({ ...base, readOnly: true, dragging: true })).toBe("viewing");
    expect(presenceAction({ ...base, readOnly: true, inspecting: true })).toBe("inspecting");
  });
});

describe("soft locks", () => {
  it("names teammates building with a part selected, not those only watching", () => {
    const base = {
      name: "",
      color: "#fff",
      muted: false,
      speaking: false,
      level: 0,
      role: "member",
      action: "editing",
    } satisfies Partial<OrbEntry>;
    const entries: OrbEntry[] = [
      { ...base, userId: "a", name: "Maya", focus: "pump", activity: "building" },
      { ...base, userId: "b", name: "Chris", focus: "pump", activity: "observing" },
      { ...base, userId: "c", name: "Alex", focus: "vessel", activity: "building" },
    ];
    expect(editorsOf(entries, "pump").map((e) => e.name)).toEqual(["Maya"]);
    expect(editorsOf(entries, "turbine")).toEqual([]);
  });
});
