import type { Activity, PresenceEntry } from "@forgelab/protocol";
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

export function activityText(activity: Activity): string {
  switch (activity) {
    case "building":
      return "Editing";
    case "simulating":
      return "Watching the run";
    case "observing":
      return "Inspecting";
  }
}

export interface OrbEntry {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
  /** Component id the orb hovers over. */
  readonly focus: string;
  readonly activity: Activity;
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
      muted: entry.mic !== "unmuted",
      speaking: member?.speaking ?? false,
      level: member?.level ?? 0,
    });
  }
  return out.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}
