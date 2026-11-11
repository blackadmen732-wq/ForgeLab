import { afterEach, describe, expect, it } from "vitest";
import { isUuid, parsePresenceState } from "@forgelab/protocol";
import {
  DEMO_CHANNELS,
  DEMO_HOME_CHANNEL,
  DEMO_LOOP_SEC,
  DEMO_SELF_ID,
  DEMO_TEAMMATES,
  DEMO_TICK_SEC,
  demoClock,
  demoFrame,
  demoSpeechLevel,
  demoTargets,
  type DemoPart,
} from "./demoScript.js";
import { createDemoTeam, type DemoTeam } from "./demoTeam.js";
import { ORB_COLORS, orbColor, orbEntries, voiceRings } from "./orbs.js";

const PLANT: readonly DemoPart[] = [
  { id: "cryopump", role: "vacuum-pump", label: "Vacuum Pump" },
  { id: "tf", role: "magnet-coil", label: "TF Coil 12" },
  { id: "pf1", role: "magnet-coil", label: "PF Coil 1" },
  { id: "diagnostics", role: "sensor", label: "Diagnostics" },
  { id: "hot-leg", role: "coolant-pipe", label: "Coolant Pipe" },
  { id: "panel", role: "controller", label: "Control Panel" },
  { id: "sg", role: "heat-exchanger", label: "Steam Generator" },
  { id: "vessel", role: "vacuum-vessel", label: "Vacuum Vessel" },
  { id: "slab", role: "structure", label: "Floor Slab" },
];
const byName = (name: string) => DEMO_TEAMMATES.find((t) => t.name === name)!;

describe("demo script", () => {
  it("is a pure function of time and parts", () => {
    for (const t of [0, 3.4, 9, 20.2, 31, 47.8]) {
      expect(demoFrame(t, PLANT)).toEqual(demoFrame(t, PLANT));
      // Part order does not matter, only which parts exist.
      expect(demoFrame(t, [...PLANT].reverse())).toEqual(demoFrame(t, PLANT));
    }
  });

  it("repeats after one loop and runs on a fixed grid", () => {
    expect(demoClock(DEMO_LOOP_SEC + 7.2)).toBe(7.2);
    expect(demoClock(-1)).toBe(DEMO_LOOP_SEC - 1);
    expect(demoClock(7.26)).toBe(7.2);
    expect(demoClock(Number.NaN)).toBe(0);
    expect(demoFrame(DEMO_LOOP_SEC * 3 + 9, PLANT)).toEqual(demoFrame(9, PLANT));
    const ticks = Math.round(DEMO_LOOP_SEC / DEMO_TICK_SEC);
    const seen = new Set<number>();
    for (let i = 0; i < ticks; i += 1) seen.add(demoClock(i * DEMO_TICK_SEC));
    expect(seen.size).toBe(ticks);
  });

  it("puts the five Reactor Core teammates on the parts the concept names", () => {
    const frame = demoFrame(2, PLANT);
    const focus = (name: string) => frame.roster.find((e) => e.userId === byName(name).id)!;
    expect(focus("Alex")).toMatchObject({ focus: "cryopump", action: "inspecting", role: "owner" });
    expect(focus("Maya")).toMatchObject({ focus: "tf", action: "editing" });
    expect(focus("Chris")).toMatchObject({ focus: "diagnostics", action: "viewing" });
    expect(focus("Andre")).toMatchObject({ focus: "hot-leg", action: "moving" });
    expect(focus("Sam")).toMatchObject({ focus: "panel", action: "configuring", mic: "muted" });
    const core = frame.roster.filter((e) => e.voiceChannelId === DEMO_HOME_CHANNEL);
    expect(core.map((e) => e.name).sort()).toEqual(["Alex", "Andre", "Chris", "Maya", "Sam"]);
    // Twelve members, eight of them online once the viewer is counted.
    expect(DEMO_TEAMMATES.length + 1).toBe(12);
    expect(frame.roster.length + 1).toBe(8);
  });

  it("gives every online teammate a different part while there are enough", () => {
    const targets = demoTargets(PLANT);
    const first = [...targets.values()].map((t) => t![0]);
    expect(new Set(first).size).toBe(first.length);
    expect(first).not.toContain("slab");
  });

  it("copes with any design: empty, one part, unknown roles", () => {
    expect(demoFrame(5, []).roster.every((e) => e.focus === null)).toBe(true);
    const one = demoFrame(5, [{ id: "only", role: "structure", label: "Beam" }]);
    expect(one.roster.every((e) => e.focus === "only")).toBe(true);
    const odd = demoFrame(5, [
      { id: "a", role: "mystery", label: "A" },
      { id: "b", role: "mystery", label: "B" },
    ]);
    expect(new Set(odd.roster.map((e) => e.focus))).toEqual(new Set(["a", "b"]));
  });

  it("moves a wandering teammate to another part for the second half of the loop", () => {
    const chris = byName("Chris").id;
    const early = demoFrame(4, PLANT).roster.find((e) => e.userId === chris)!;
    const late = demoFrame(DEMO_LOOP_SEC / 2 + 4, PLANT).roster.find((e) => e.userId === chris)!;
    expect(late.focus).not.toBe(early.focus);
    expect(PLANT.some((p) => p.id === late.focus)).toBe(true);
  });

  it("speaks only in its windows, never while muted, at three loudness levels", () => {
    expect(demoSpeechLevel(byName("Sam"), 3)).toBe(0);
    expect(demoSpeechLevel(byName("Lena"), 3)).toBe(0);
    expect(demoSpeechLevel(byName("Alex"), 0.4)).toBe(0);
    expect(demoSpeechLevel(byName("Alex"), 3)).toBeGreaterThan(0);
    const rings = new Set<number>();
    for (let t = 0; t < DEMO_LOOP_SEC; t += DEMO_TICK_SEC)
      for (const s of demoFrame(t, PLANT).speakers) {
        expect(s.level).toBeGreaterThan(0);
        expect(s.level).toBeLessThanOrEqual(1);
        rings.add(voiceRings(s.level));
      }
    expect([...rings].sort()).toEqual([1, 2, 3]);
    // One voice at a time: the script never has people talking over each other.
    for (let t = 0; t < DEMO_LOOP_SEC; t += DEMO_TICK_SEC)
      expect(demoFrame(t, PLANT).speakers.length).toBeLessThanOrEqual(1);
  });

  it("uses well-formed ids and states the real protocol would accept", () => {
    for (const c of DEMO_CHANNELS) expect(isUuid(c.id)).toBe(true);
    for (const t of DEMO_TEAMMATES) expect(isUuid(t.id)).toBe(true);
    expect(isUuid(DEMO_SELF_ID)).toBe(true);
    for (const entry of demoFrame(8, PLANT).roster) expect(parsePresenceState(entry)).not.toBeNull();
  });

  it("gives the online teammates distinct orb colours", () => {
    const colours = DEMO_TEAMMATES.filter((t) => t.online).map((t) => orbColor(t.id));
    expect(new Set(colours).size).toBe(colours.length);
    for (const c of colours) expect(ORB_COLORS).toContain(c);
  });
});

describe("demo team", () => {
  let team: DemoTeam | null = null;
  afterEach(async () => {
    await team?.stop();
    team = null;
  });

  it("drives the production controller: roster, channels, voice and orbs", async () => {
    team = createDemoTeam();
    team.setParts(PLANT);
    team.setTime(8);
    await team.start();
    const state = team.controller.getState();
    expect(team.controller.demo).toBe(true);
    expect(state.role).toBe("member");
    expect(state.error).toBeNull();
    expect(state.members).toHaveLength(12);
    expect(state.channels.map((c) => c.name)).toContain("Reactor Core");
    expect(state.session.status).toBe("connected");
    expect(state.session.roster).toHaveLength(8);
    expect(state.textChannelId).toBe(DEMO_HOME_CHANNEL);
    expect(state.messages.length).toBeGreaterThan(0);
    // The viewer sits in the home channel's voice; the script says Maya is loud at t = 8 s.
    expect(state.voice.phase).toBe("connected");
    expect(state.voice.channelId).toBe(DEMO_HOME_CHANNEL);
    expect(state.voice.members.map((m) => m.name).sort()).toEqual(
      ["Alex", "Andre", "Chris", "Maya", "Sam", "You"].sort(),
    );
    const maya = state.voice.members.find((m) => m.name === "Maya")!;
    expect(maya.speaking).toBe(true);
    expect(voiceRings(maya.level)).toBe(3);
    // The same orb code the live team uses.
    const orbs = orbEntries(
      state.session.roster,
      state.voice.members,
      team.controller.userId,
      state.session.self.workspaceId,
      (id) => PLANT.some((p) => p.id === id),
    );
    expect(orbs).toHaveLength(7);
    expect(orbs.find((o) => o.name === "Maya")).toMatchObject({ focus: "tf", speaking: true });
    expect(orbs.some((o) => o.userId === DEMO_SELF_ID)).toBe(false);
  });

  it("is deterministic: the same pinned moment gives the same picture", async () => {
    const picture = async (t: number) => {
      const one = createDemoTeam();
      one.setParts(PLANT);
      one.setTime(t);
      await one.start();
      const s = one.controller.getState();
      const out = JSON.stringify({ roster: s.session.roster, voice: s.voice.members });
      await one.stop();
      return out;
    };
    expect(await picture(19.4)).toBe(await picture(19.4));
    expect(await picture(19.4)).not.toBe(await picture(8));
  });

  it("never opens a microphone: mute and deafen only change shown state", async () => {
    team = createDemoTeam();
    team.setParts(PLANT);
    team.setTime(0);
    await team.start();
    const voice = team.controller.voice;
    expect(voice.getState().muted).toBe(true);
    await voice.setMuted(false);
    expect(voice.getState()).toMatchObject({ muted: false, micBlock: null });
    expect(team.controller.getState().session.self.mic).toBe("unmuted");
    await voice.setDeafened(true);
    expect(team.controller.getState().session.self).toMatchObject({ deafened: true, mic: "muted" });
    await voice.leave();
    expect(voice.getState().phase).toBe("idle");
    expect(team.controller.getState().session.self.voiceChannelId).toBeNull();
  });

  it("keeps chat and jobs inside the tab", async () => {
    team = createDemoTeam();
    team.setParts(PLANT);
    team.setTime(0);
    await team.start();
    const c = team.controller;
    const before = c.getState().messages.length;
    await c.send("Looking at @tf now", (id) => id === "tf");
    const messages = c.getState().messages;
    expect(messages).toHaveLength(before + 1);
    expect(messages[messages.length - 1]).toMatchObject({
      userId: DEMO_SELF_ID,
      refs: [{ kind: "component", id: "tf" }],
    });
    await c.work.refresh();
    const mine = c.work.getState().orders.find((w) => w.assignedTo === DEMO_SELF_ID)!;
    expect(mine.status).toBe("offered");
    await c.work.transition(mine, "accepted");
    expect(c.work.getState().orders.find((w) => w.id === mine.id)?.status).toBe("accepted");
  });

  it("stops cleanly, even when stopped while starting", async () => {
    team = createDemoTeam();
    const starting = team.start();
    await team.stop();
    await starting;
    expect(team.controller.voice.getState().phase).toBe("idle");
    expect(team.controller.getState().session.roster).toHaveLength(0);
  });
});
