import {
  projectWorkspaceId,
  type MicState,
  type PresenceAction,
  type PresenceEntry,
  type ProjectRole,
} from "@forgelab/protocol";

/**
 * The demo team's script: who the scripted teammates are, which part each one hovers
 * over, what they are doing and when they "speak".
 *
 * Everything here is a pure function of the script clock and the parts in the open
 * design, so the same moment always draws the same picture (tests and screenshots pin the
 * clock). These are not people: nothing is sent, heard or recorded, and the panels that
 * draw from this script say "demo" on everything they show.
 */

export const DEMO_PROJECT_ID = "de000000-0000-4000-8000-000000000000";
/** The viewer's own seat in the demo team. */
export const DEMO_SELF_ID = "de000000-0000-4000-8000-000000000036";
export const DEMO_PROJECT_NAME = "ITER-Style Fusion Plant";
/** The script repeats after this many seconds. */
export const DEMO_LOOP_SEC = 48;
/** The script clock advances in steps of this size. */
export const DEMO_TICK_SEC = 0.2;

export interface DemoChannel {
  readonly id: string;
  readonly name: string;
}

const channel = (n: number, name: string): DemoChannel => ({
  id: `de000000-0000-4000-8000-0000000001${n.toString(16).padStart(2, "0")}`,
  name,
});

export const DEMO_CHANNELS: readonly DemoChannel[] = [
  channel(1, "General"),
  channel(2, "Reactor Core"),
  channel(3, "Magnets"),
  channel(4, "Cooling"),
  channel(5, "Power"),
  channel(6, "Control Room"),
  channel(7, "Failure Review"),
];
const REACTOR_CORE = DEMO_CHANNELS[1]!.id;
const MAGNETS = DEMO_CHANNELS[2]!.id;
const COOLING = DEMO_CHANNELS[3]!.id;
/** The channel the viewer is placed in when the demo starts. */
export const DEMO_HOME_CHANNEL = REACTOR_CORE;

/** A part of the open design, as far as the script needs to know it. */
export interface DemoPart {
  readonly id: string;
  /** The part's plant role ("magnet-coil", "vacuum-pump"…). */
  readonly role: string;
  readonly label: string;
}

/** A stretch of scripted speech: seconds into the loop, and how loud (0–1). */
export interface SpeechWindow {
  readonly from: number;
  readonly to: number;
  readonly peak: number;
}

export interface DemoTeammate {
  readonly id: string;
  readonly name: string;
  readonly role: ProjectRole;
  readonly online: boolean;
  /** Voice channel they sit in while online. */
  readonly channelId: string | null;
  /** Plant roles they look for in the design, most wanted first. */
  readonly prefers: readonly string[];
  /** What they do in the first and second half of the loop. */
  readonly actions: readonly [PresenceAction, PresenceAction];
  readonly mic: MicState;
  readonly speech: readonly SpeechWindow[];
  /** Whether they change to their second-choice part for the second half of the loop. */
  readonly wanders: boolean;
}

const mate = (
  id: string,
  name: string,
  patch: Partial<Omit<DemoTeammate, "id" | "name">> = {},
): DemoTeammate => ({
  id,
  name,
  role: "member",
  online: true,
  channelId: REACTOR_CORE,
  prefers: [],
  actions: ["editing", "editing"],
  mic: "unmuted",
  speech: [],
  wanders: false,
  ...patch,
});

/**
 * The scripted teammates. The five in Reactor Core match the concept picture: Alex on the
 * vacuum pump, Maya on a TF coil, Chris on the diagnostics, Andre on the coolant pipe and
 * Sam (muted) on the control panel.
 */
export const DEMO_TEAMMATES: readonly DemoTeammate[] = [
  mate("de000000-0000-4000-8000-000000000011", "Alex", {
    role: "owner",
    prefers: ["vacuum-pump", "vacuum-vessel"],
    actions: ["inspecting", "inspecting"],
    speech: [
      { from: 1, to: 6, peak: 0.5 },
      { from: 26, to: 30, peak: 0.2 },
    ],
  }),
  mate("de000000-0000-4000-8000-000000000012", "Maya", {
    role: "admin",
    prefers: ["magnet-coil"],
    actions: ["editing", "configuring"],
    speech: [
      { from: 7, to: 12, peak: 0.95 },
      { from: 33, to: 37, peak: 0.5 },
    ],
  }),
  mate("de000000-0000-4000-8000-000000000017", "Chris", {
    prefers: ["sensor", "plasma-heater", "vacuum-vessel"],
    actions: ["viewing", "inspecting"],
    speech: [
      { from: 13, to: 16, peak: 0.2 },
      { from: 38, to: 41, peak: 0.5 },
    ],
    wanders: true,
  }),
  mate("de000000-0000-4000-8000-000000000018", "Andre", {
    prefers: ["coolant-pipe", "coolant-pump"],
    actions: ["moving", "editing"],
    speech: [
      { from: 18, to: 23, peak: 0.55 },
      { from: 42, to: 46, peak: 0.9 },
    ],
  }),
  mate("de000000-0000-4000-8000-00000000001e", "Sam", {
    prefers: ["controller", "switch", "power-supply"],
    actions: ["configuring", "configuring"],
    mic: "muted",
  }),
  mate("de000000-0000-4000-8000-00000000001f", "Priya", {
    channelId: MAGNETS,
    prefers: ["magnet-coil"],
    actions: ["inspecting", "editing"],
  }),
  mate("de000000-0000-4000-8000-000000000022", "Jonas", {
    channelId: COOLING,
    prefers: ["heat-exchanger", "coolant-pump", "turbine"],
    actions: ["editing", "moving"],
    mic: "muted",
  }),
  mate("de000000-0000-4000-8000-000000000025", "Lena", { online: false, channelId: null }),
  mate("de000000-0000-4000-8000-000000000028", "Omar", { online: false, channelId: null }),
  mate("de000000-0000-4000-8000-00000000002c", "Tess", {
    role: "viewer",
    online: false,
    channelId: null,
  }),
  mate("de000000-0000-4000-8000-00000000002f", "Kofi", { online: false, channelId: null }),
];

/** Brings any clock value onto the script's grid and into one loop. */
export function demoClock(seconds: number): number {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const wrapped = ((s % DEMO_LOOP_SEC) + DEMO_LOOP_SEC) % DEMO_LOOP_SEC;
  const ticks = Math.round(wrapped / DEMO_TICK_SEC) % Math.round(DEMO_LOOP_SEC / DEMO_TICK_SEC);
  return Math.round(ticks * DEMO_TICK_SEC * 1000) / 1000;
}

/**
 * Loudness of a teammate at a script time: 0 outside their speech windows; inside one,
 * the window's peak shaped by a quick fade in and out and a syllable-like ripple.
 */
export function demoSpeechLevel(teammate: DemoTeammate, tSec: number): number {
  if (teammate.mic !== "unmuted" || !teammate.online) return 0;
  const t = demoClock(tSec);
  const window = teammate.speech.find((w) => t >= w.from && t < w.to);
  if (window === undefined) return 0;
  const edge = Math.min(1, (t - window.from) / 0.4, (window.to - t) / 0.4);
  const ripple = 0.6 + 0.4 * Math.abs(Math.sin((t - window.from) * 2.3 * Math.PI));
  return Math.round(Math.max(0, window.peak * edge * ripple) * 100) / 100;
}

/**
 * Which parts each online teammate hovers over: their first and second choice. Everyone
 * gets their preferred kind of part where the design has one that nobody has taken;
 * otherwise any free part; and when the design has fewer parts than teammates, they
 * share. An empty design gives nobody a part (their orbs are simply not drawn).
 */
export function demoTargets(
  parts: readonly DemoPart[],
): ReadonlyMap<string, readonly [string, string] | null> {
  const sorted = [...parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Set<string>();
  const out = new Map<string, readonly [string, string] | null>();
  const pick = (wanted: readonly string[], avoid: string | null): DemoPart | undefined => {
    const free = (p: DemoPart) => !taken.has(p.id) && p.id !== avoid;
    for (const role of wanted) {
      const hit = sorted.find((p) => p.role === role && free(p));
      if (hit !== undefined) return hit;
    }
    return (
      sorted.find((p) => free(p) && p.role !== "structure") ??
      sorted.find(free) ??
      sorted.find((p) => wanted.includes(p.role) && p.id !== avoid) ??
      sorted.find((p) => p.id !== avoid) ??
      sorted[0]
    );
  };
  for (const teammate of DEMO_TEAMMATES) {
    if (!teammate.online) continue;
    const first = pick(teammate.prefers, null);
    if (first === undefined) {
      out.set(teammate.id, null);
      continue;
    }
    taken.add(first.id);
    out.set(teammate.id, [first.id, first.id]);
  }
  // Second choices come from what is left once everyone has a first choice.
  for (const teammate of DEMO_TEAMMATES) {
    const first = out.get(teammate.id);
    if (!teammate.online || !teammate.wanders || first === null || first === undefined) continue;
    const second = pick(teammate.prefers.slice(1).concat(teammate.prefers), first[0]);
    if (second !== undefined && second.id !== first[0]) {
      taken.add(second.id);
      out.set(teammate.id, [first[0], second.id]);
    }
  }
  return out;
}

export interface DemoFrame {
  /** Script time of this frame, on the grid, within one loop. */
  readonly timeSec: number;
  /** Scripted teammates who are online, as presence roster entries (never the viewer). */
  readonly roster: readonly PresenceEntry[];
  /** Who is speaking right now, and how loudly. */
  readonly speakers: readonly { readonly identity: string; readonly level: number }[];
}

/** The whole scripted picture at one moment. Pure: same time and parts, same frame. */
export function demoFrame(seconds: number, parts: readonly DemoPart[]): DemoFrame {
  const timeSec = demoClock(seconds);
  const half = timeSec < DEMO_LOOP_SEC / 2 ? 0 : 1;
  const targets = demoTargets(parts);
  const workspaceId = projectWorkspaceId(DEMO_PROJECT_ID);
  const roster: PresenceEntry[] = [];
  const speakers: { identity: string; level: number }[] = [];
  for (const teammate of DEMO_TEAMMATES) {
    if (!teammate.online) continue;
    const target = targets.get(teammate.id) ?? null;
    const action = teammate.actions[half];
    roster.push({
      userId: teammate.id,
      name: teammate.name,
      role: teammate.role,
      voiceChannelId: teammate.channelId,
      mic: teammate.mic,
      deafened: false,
      activity: action === "viewing" || action === "inspecting" ? "observing" : "building",
      workspaceId,
      focus: target === null ? null : target[teammate.wanders ? half : 0],
      action,
      seenAt: 0,
      seq: Math.round(timeSec / DEMO_TICK_SEC),
    });
    const level = demoSpeechLevel(teammate, timeSec);
    if (level > 0) speakers.push({ identity: teammate.id, level });
  }
  return { timeSec, roster, speakers };
}
