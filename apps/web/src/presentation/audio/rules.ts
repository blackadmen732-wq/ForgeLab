import type { StageProgress } from "../activation.js";
import type { DestructionEvent, FailureFamily } from "../destruction.js";
import { ALARM_ORDER, alarmTier, type AlarmTier, type FacilityState } from "../facility.js";

/**
 * Audio rules: which sounds a presentation event calls for. Pure, so the mapping is
 * testable without a sound card. The engine turns actions into Web Audio.
 *
 * Every sound is a consequence of something the simulation published: a failure it
 * raised, a stage it reached, a state it is in. No sound implies an event that did not
 * happen, and nothing here reaches the simulation.
 */
export type AudioAction =
  | {
      readonly kind: "failure";
      readonly family: FailureFamily;
      readonly position: readonly [number, number, number];
      readonly severity: number;
      /** Higher plays first when voices run out. */
      readonly priority: number;
    }
  | { readonly kind: "alarm"; readonly tier: AlarmTier }
  | { readonly kind: "duck"; readonly depthDb: number; readonly seconds: number }
  | { readonly kind: "ambient"; readonly facility: FacilityState }
  | { readonly kind: "stage"; readonly reached: boolean }
  | { readonly kind: "stop-all" };

/** Families loud enough to duck the machinery and hall ambience under them. */
const PRIORITY: Readonly<Record<FailureFamily, number>> = {
  disruption: 10,
  quench: 9,
  structural: 8,
  electrical: 7,
  coolant: 6,
  cryogenic: 5,
  thermal: 3,
  brownout: 3,
  flow: 2,
  plasma: 4,
  control: 1,
};

export function failureActions(event: DestructionEvent): AudioAction[] {
  const priority = PRIORITY[event.family];
  const actions: AudioAction[] = [
    {
      kind: "failure",
      family: event.family,
      position: event.worldPosition,
      severity: event.severity,
      priority,
    },
  ];
  if (priority >= 5) {
    // Duck in proportion to how violent the event is: −4 dB for a steam release, up to
    // −14 dB for a disruption, recovering over a couple of seconds.
    actions.push({
      kind: "duck",
      depthDb: -(4 + 10 * event.severity),
      seconds: 1.2 + 1.8 * event.severity,
    });
  }
  return actions;
}

export function facilityActions(state: FacilityState, previous: FacilityState): AudioAction[] {
  const actions: AudioAction[] = [{ kind: "ambient", facility: state }];
  const tier = alarmTier(state);
  if (tier !== alarmTier(previous)) actions.push({ kind: "alarm", tier });
  if (state === "BUILD") actions.push({ kind: "stop-all" });
  return actions;
}

export function stageActions(stage: StageProgress, previous?: StageProgress): AudioAction[] {
  if (previous?.status === stage.status) return [];
  if (stage.status === "done" && previous !== undefined && previous.status !== "done")
    return [{ kind: "stage", reached: true }];
  if (stage.status === "stalled" && previous?.status === "active")
    return [{ kind: "stage", reached: false }];
  return [];
}

/** The louder of two alarm tiers. */
export function louder(a: AlarmTier, b: AlarmTier): AlarmTier {
  return ALARM_ORDER.indexOf(a) >= ALARM_ORDER.indexOf(b) ? a : b;
}

/** Voices available for one-shot failure sounds; lower priorities are dropped first. */
export const MAX_FAILURE_VOICES = 8;

/**
 * Chooses which pending one-shots to play when more arrive at once than there are
 * voices: highest priority first, then severity.
 */
export function pickVoices<T extends { priority: number; severity: number }>(
  pending: readonly T[],
  free: number,
): T[] {
  return [...pending]
    .sort((a, b) => b.priority - a.priority || b.severity - a.severity)
    .slice(0, Math.max(0, free));
}
