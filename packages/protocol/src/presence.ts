import { isUuid } from "./ids.js";
import { isProjectRole, type ProjectRole } from "./roles.js";

/**
 * Ephemeral presence. Published over Realtime (never written to Postgres), signed by the
 * sender's session key (see signing.ts), and rebuilt from scratch on every reconnect.
 */
export type MicState = "unmuted" | "muted" | "unavailable";
export type Activity = "building" | "simulating" | "observing";
/**
 * What the member is doing with the focused part right now, finer than `activity`. It is
 * what teammates read on a presence orb ("Maya · TF Coil 12 · Editing"). Optional on the
 * wire: clients that predate it send none, and readers fall back to `activity`.
 */
export type PresenceAction = "inspecting" | "editing" | "moving" | "viewing" | "configuring";
export const PRESENCE_ACTIONS: readonly PresenceAction[] = [
  "inspecting",
  "editing",
  "moving",
  "viewing",
  "configuring",
];

export interface PresenceState {
  readonly voiceChannelId: string | null;
  readonly mic: MicState;
  readonly deafened: boolean;
  readonly activity: Activity;
  /** The work area the user is in; informational only — it never affects voice routing. */
  readonly workspaceId: string;
  /** Component the user is focused on, if any (for "come look at this"). */
  readonly focus: string | null;
  /** What they are doing with it; null or absent when the client does not say. */
  readonly action?: PresenceAction | null;
}

/** A verified roster entry: identity comes from the server-signed ticket, not the payload. */
export interface PresenceEntry extends PresenceState {
  readonly userId: string;
  readonly name: string;
  readonly role: ProjectRole;
  /** Receiver's clock when this state was last refreshed. */
  readonly seenAt: number;
  readonly seq: number;
}

export const IDLE_PRESENCE: PresenceState = Object.freeze({
  voiceChannelId: null,
  mic: "muted",
  deafened: false,
  activity: "building",
  workspaceId: "",
  focus: null,
  action: null,
});

const MIC: readonly string[] = ["unmuted", "muted", "unavailable"];
const ACTIVITY: readonly string[] = ["building", "simulating", "observing"];
const SHORT_ID = /^[A-Za-z0-9:_-]{0,80}$/;

/** Strict validation of an untrusted presence payload. */
export function parsePresenceState(input: unknown): PresenceState | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (r["voiceChannelId"] !== null && !isUuid(r["voiceChannelId"])) return null;
  if (typeof r["mic"] !== "string" || !MIC.includes(r["mic"])) return null;
  if (typeof r["deafened"] !== "boolean") return null;
  if (typeof r["activity"] !== "string" || !ACTIVITY.includes(r["activity"])) return null;
  if (typeof r["workspaceId"] !== "string" || !SHORT_ID.test(r["workspaceId"])) return null;
  if (r["focus"] !== null && (typeof r["focus"] !== "string" || !SHORT_ID.test(r["focus"])))
    return null;
  const action = r["action"] ?? null;
  if (action !== null && !PRESENCE_ACTIONS.includes(action as PresenceAction)) return null;
  return {
    voiceChannelId:
      r["voiceChannelId"] === null ? null : (r["voiceChannelId"] as string).toLowerCase(),
    mic: r["mic"] as MicState,
    deafened: r["deafened"],
    activity: r["activity"] as Activity,
    workspaceId: r["workspaceId"],
    focus: (r["focus"] as string | null) ?? null,
    action: action as PresenceAction | null,
  };
}

export { isProjectRole };
