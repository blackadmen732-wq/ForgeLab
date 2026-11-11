import type { Activity, PresenceAction, PresenceEntry, ProjectRole } from "@forgelab/protocol";
import type { VoiceMember } from "@forgelab/voice";

/**
 * Presence orbs: each teammate as a coloured orb over the part they are working on.
 *
 * Presentation only. An orb reads the signed presence roster (who, which part, what they
 * are doing) and the voice state (are they speaking, how loudly). Nothing here reaches the
 * simulation, and no orb is drawn for a part that does not exist in this design.
 */

/** Distinct, high-contrast orb colours. A teammate keeps the same colour every session. */
export const ORB_COLORS = [
  "#3b9bff",
  "#b06cff",
  "#36d17a",
  "#ffb02e",
  "#ff5ca8",
  "#2fd6d6",
  "#ff7a45",
  "#c8e04a",
] as const;

/** Stable colour for a user id (FNV-1a hash into the palette). */
export function orbColor(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ORB_COLORS[(h >>> 0) % ORB_COLORS.length]!;
}

export type OrbDetail = "dot" | "orb" | "label";

/**
 * How much of an orb to draw from the camera distance: a name and activity up close, an
 * orb at working distance, a small dot across the hall. Bigger parts keep their label
 * further away because they are seen from further away.
 */
export function orbDetail(distanceM: number, partRadiusM: number): OrbDetail {
  const r = Math.max(partRadiusM, 0.5);
  if (distanceM <= 25 + 6 * r) return "label";
  if (distanceM <= 70 + 12 * r) return "orb";
  return "dot";
}

/**
 * Orb scale from voice loudness: steady when silent, swelling with speech. The ripple
 * makes louder speech visibly busier, not only bigger.
 */
export function orbPulse(level: number, timeSec: number): number {
  const l = Math.min(1, Math.max(0, level));
  if (l === 0) return 1;
  return 1 + 0.25 * l + 0.12 * l * Math.sin(timeSec * (8 + 10 * l));
}

/**
 * Voice rings around an orb, and bars beside a name: none when silent, one for quiet
 * speech, two for normal speech, three for loud speech. A count, not only a brightness,
 * so loudness reads without colour.
 */
export type VoiceRings = 0 | 1 | 2 | 3;
export function voiceRings(level: number): VoiceRings {
  if (!(level > 0.02)) return 0;
  if (level < 0.3) return 1;
  if (level < 0.65) return 2;
  return 3;
}

/**
 * One ring of the voice ripple at a moment in time: rings leave the orb one after another
 * and fade as they grow, and loud speech throws them further.
 */
export function ringPhase(
  index: number,
  rings: VoiceRings,
  level: number,
  timeSec: number,
): { readonly scale: number; readonly opacity: number } {
  if (index >= rings) return { scale: 1, opacity: 0 };
  const period = 1.15;
  const l = Math.min(1, Math.max(0, level));
  const t = (((timeSec / period + index / Math.max(1, rings)) % 1) + 1) % 1;
  const reach = 1.5 + 2.2 * l;
  return { scale: 1 + (reach - 1) * t, opacity: (1 - t) * (0.35 + 0.45 * l) };
}

/** The words a label card shows for what a teammate is doing. */
export const ACTION_LABELS: Readonly<Record<PresenceAction, string>> = {
  inspecting: "Inspecting",
  editing: "Editing",
  moving: "Moving",
  viewing: "Viewing",
  configuring: "Configuring",
};

/** The coarse activity every client publishes, as an action. */
export function actionFromActivity(activity: Activity): PresenceAction {
  switch (activity) {
    case "building":
      return "editing";
    case "simulating":
      return "viewing";
    case "observing":
      return "inspecting";
  }
}

/** What a teammate is doing: what their client says, else read from the coarse activity. */
export function orbAction(entry: {
  readonly activity: Activity;
  readonly action?: PresenceAction | null;
}): PresenceAction {
  return entry.action ?? actionFromActivity(entry.activity);
}

export function activityText(activity: Activity): string {
  return ACTION_LABELS[actionFromActivity(activity)];
}

/**
 * What this member is doing with the part they have selected, from the editor's own
 * state. Only the word travels to teammates; nothing here moves or edits anything.
 */
export function presenceAction(input: {
  readonly mode: "build" | "simulate";
  /** Read-only access (a viewer, or someone else's design). */
  readonly readOnly: boolean;
  /** A gizmo drag is in progress on the selection. */
  readonly dragging: boolean;
  /** Keyboard focus is in one of the part's parameter fields. */
  readonly configuring: boolean;
  /** A cutaway, x-ray, section, peel or internals view is open. */
  readonly inspecting: boolean;
}): PresenceAction {
  if (input.mode === "simulate") return "viewing";
  if (input.readOnly) return input.inspecting ? "inspecting" : "viewing";
  if (input.dragging) return "moving";
  if (input.configuring) return "configuring";
  if (input.inspecting) return "inspecting";
  return "editing";
}

export interface OrbEntry {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  /** Component id the orb hovers over. */
  readonly focus: string;
  readonly activity: Activity;
  readonly action: PresenceAction;
  readonly role: ProjectRole;
  readonly muted: boolean;
  readonly speaking: boolean;
  readonly level: number;
}

/**
 * The orbs to draw: teammates (never yourself) in the same workspace whose focus is a
 * part that exists here, in a fixed order so they never reshuffle.
 */
export function orbEntries(
  roster: readonly PresenceEntry[],
  voice: readonly VoiceMember[],
  selfId: string | null,
  workspaceId: string | null,
  partExists: (id: string) => boolean,
): OrbEntry[] {
  const out: OrbEntry[] = [];
  for (const entry of roster) {
    if (entry.userId === selfId || entry.focus === null) continue;
    if (workspaceId !== null && entry.workspaceId !== workspaceId) continue;
    if (!partExists(entry.focus)) continue;
    const member = voice.find((m) => m.identity === entry.userId);
    out.push({
      userId: entry.userId,
      name: entry.name,
      color: orbColor(entry.userId),
      focus: entry.focus,
      activity: entry.activity,
      action: orbAction(entry),
      role: entry.role,
      muted: entry.mic !== "unmuted",
      speaking: member?.speaking ?? false,
      level: member?.level ?? 0,
    });
  }
  return out.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Where several orbs share one part, they fan out around it instead of stacking: the
 * n-th of `count` orbs sits on a small circle, as an offset in orb radii.
 */
export function orbSlot(index: number, count: number): { readonly x: number; readonly z: number } {
  if (count <= 1) return { x: 0, z: 0 };
  const angle = (index / count) * Math.PI * 2 + Math.PI / 6;
  const radius = 1.6 + 0.25 * Math.min(count, 6);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Soft locks: teammates currently building with this part selected. Advisory only —
 * edits are never blocked (the shared save still detects conflicting versions); this
 * tells you someone is on it before you change it.
 */
export function editorsOf(entries: readonly OrbEntry[], componentId: string): OrbEntry[] {
  return entries.filter((e) => e.focus === componentId && e.activity === "building");
}
