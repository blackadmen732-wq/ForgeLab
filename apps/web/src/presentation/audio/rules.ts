import type { StageProgress } from "../activation.js";
import type { DestructionEvent, FailureFamily } from "../destruction.js";
import type { ComponentReading } from "../reading.js";
import { ALARM_ORDER, alarmTier, type AlarmTier, type FacilityState } from "../facility.js";
import { INSULATION_IGNITION_K } from "../vfx/recipes.js";

/**
 * Audio rules: which sounds a presentation event calls for. Pure, so the mapping is
 * testable without a sound card. The engine turns actions into Web Audio.
 *
 * Every sound is a consequence of something the simulation published: a failure it
 * raised, a stage it reached, a state it is in. No sound implies an event that did not
 * happen, and nothing here reaches the simulation.
 */
/**
 * One element of a failure's sound, timed from the event (seconds). The engine renders
 * cues with oscillators, noise and filters; the score itself is pure and testable.
 */
export type SoundCue =
  | {
      /** Filtered noise with an attack–decay envelope: hiss, roar, crackle, crack. */
      readonly type: "noise";
      readonly color: "white" | "pink" | "brown";
      readonly filter: "lowpass" | "highpass" | "bandpass";
      readonly f: number;
      readonly q: number;
      readonly at: number;
      readonly peak: number;
      readonly attack: number;
      readonly decay: number;
    }
  | {
      /** A low sine that drops an octave: a bang, a breaker, a boom. */
      readonly type: "thud";
      readonly f: number;
      readonly at: number;
      readonly peak: number;
      readonly decay: number;
    }
  | {
      /** Struck metal: inharmonic partials ringing down. */
      readonly type: "ring";
      readonly partials: readonly number[];
      readonly at: number;
      readonly peak: number;
      readonly decay: number;
    }
  | {
      /** Steel groaning under load: a falling low sawtooth. */
      readonly type: "groan";
      readonly from: number;
      readonly to: number;
      readonly at: number;
      readonly duration: number;
      readonly peak: number;
    };

export type AudioAction =
  | {
      readonly kind: "failure";
      readonly family: FailureFamily;
      readonly position: readonly [number, number, number];
      readonly severity: number;
      /** Higher plays first when voices run out. */
      readonly priority: number;
      readonly cues: readonly SoundCue[];
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
      cues: failureScore(event),
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

function seeded(text: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < text.length; i += 1) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noise = (
  color: "white" | "pink" | "brown",
  filter: "lowpass" | "highpass" | "bandpass",
  f: number,
  at: number,
  peak: number,
  attack: number,
  decay: number,
  q = 0.7,
): SoundCue => ({ type: "noise", color, filter, f, q, at, peak, attack, decay });
const thud = (f: number, at: number, peak: number, decay: number): SoundCue => ({
  type: "thud",
  f,
  at,
  peak,
  decay,
});

/** Burning insulation: sparse crackles and a low roar that dies with the fuel. */
function fireCues(from: number, seconds: number, rand: () => number): SoundCue[] {
  const out: SoundCue[] = [noise("brown", "lowpass", 220, from, 0.25, 1.5, seconds)];
  for (let i = 0; i < seconds * 3; i += 1)
    out.push(
      noise(
        "white",
        "bandpass",
        1800 + rand() * 2500,
        from + rand() * seconds,
        0.12,
        0.001,
        0.03,
        4,
      ),
    );
  return out;
}

/**
 * What a failure sounds like, in the same stages its effects play (recipes.ts): the
 * first break, the primary event, secondary reactions, the tail. Seeded by the event, so
 * a replayed failure sounds the same. Every cue answers to something published: an arc's
 * crackle to an electrical fault, a jet's pitch to the break size and pressure, a fire's
 * crackle only to insulation hot enough to burn.
 */
export function failureScore(event: DestructionEvent): SoundCue[] {
  const s = event.severity;
  const rand = seeded(event.eventId);
  switch (event.family) {
    case "electrical": {
      // The arc crackles for as long as it burns, re-strikes, then the breaker clears.
      const arcS = 0.18 + 0.4 * s;
      const out: SoundCue[] = [];
      for (let at = 0; at < arcS; at += 0.035)
        out.push(noise("white", "highpass", 2500, at + rand() * 0.02, 0.35, 0.002, 0.03));
      for (let i = 0; i < 4; i += 1)
        out.push(noise("white", "highpass", 2800, 0.35 + i * 0.03, 0.25, 0.002, 0.025));
      out.push(noise("white", "bandpass", 4000, 0, 0.12, 0.01, 0.6, 3)); // ozone buzz
      out.push(thud(70, Math.max(arcS, 0.47) + 0.05, 0.6, 0.5)); // breaker
      if (event.combustible && s > 0.5) out.push(...fireCues(0.6, 12, rand));
      return out;
    }
    case "coolant": {
      if (event.failureType !== "pipe_rupture")
        // Pressure relief: a thump, then a long steam hiss.
        return [
          thud(55, 0, 0.4, 0.4),
          noise("pink", "highpass", 2800, 0.05, 0.45, 0.15, 3 + 3 * s),
        ];
      const pressureMPa = Math.max(0.1, (event.pressure ?? 1.5e7) / 1e6);
      const blowdown = 6 + 14 * s;
      if (s < 0.4)
        // A pinhole screams: a narrow, high whistle that falls as the loop empties.
        return [
          noise("white", "highpass", 3000, 0, 0.3, 0.001, 0.05),
          noise(
            "white",
            "bandpass",
            Math.min(9000, 3500 + 300 * pressureMPa),
            0.02,
            0.35,
            0.05,
            blowdown,
            9,
          ),
          noise("pink", "highpass", 2500, 12, 0.08, 1, 20), // weeping
        ];
      // A break: the bang of the wall letting go, a broadband roar, water hammering the
      // floor, then the weep.
      return [
        noise("white", "highpass", 1200, 0, 0.7 * s + 0.2, 0.001, 0.08),
        thud(48, 0, 0.8, 0.9),
        noise(
          "pink",
          "lowpass",
          1400 + 120 * pressureMPa,
          0.01,
          0.6 + 0.3 * s,
          0.05,
          blowdown * 0.6,
        ),
        noise("white", "highpass", 3500, 0.05, 0.3, 0.1, blowdown * 0.5),
        noise("brown", "lowpass", 500, 0.3, 0.3, 0.2, 4 + 4 * s), // spray on the floor
        noise("pink", "highpass", 2500, 12, 0.08, 1, 20),
      ];
    }
    case "flow":
      return [noise("brown", "lowpass", 300, 0, 0.3, 0.05, 1.2)];
    case "cryogenic":
      // The vent itself follows the published boil-off (a live sound); this is its onset.
      return [noise("pink", "bandpass", 1100, 0, 0.25, 0.4, 2, 0.9)];
    case "quench":
      // The winding goes normal with a deep boom; at the relief pressure the valve pops
      // and vents. The continuing vent follows the boil-off live.
      return [
        thud(38, 0, 0.9, 2.2),
        noise("brown", "lowpass", 180, 0, 0.6, 0.01, 1.8),
        noise("white", "highpass", 1500, 0.4, 0.5, 0.001, 0.05),
        noise("pink", "bandpass", 1100, 0.4, 0.55, 0.05, 1.2 + 1.5 * s + 2, 0.9),
        noise("brown", "lowpass", 120, 0.4, 0.4, 0.05, 1.5), // the shock through the floor
      ];
    case "disruption":
      // A sharp crack, the second as the current quenches, the vessel ringing like a
      // struck bell, a heavy thud underneath.
      return [
        noise("white", "highpass", 1200, 0, 0.9, 0.001, 0.06),
        noise("white", "highpass", 1600, 0.18, 0.5, 0.001, 0.05),
        {
          type: "ring",
          partials: [310, 587, 922, 1377, 1703],
          at: 0,
          peak: 0.25,
          decay: 3 + 2 * s,
        },
        thud(45, 0.01, 0.9, 1.6),
        noise("brown", "lowpass", 400, 0.02, 0.5, 0.02, 1.5),
      ];
    case "structural": {
      // Steel groaning under load, the crash, then pieces settling.
      const out: SoundCue[] = [
        { type: "groan", from: 95, to: 48, at: 0, duration: 0.9, peak: 0.3 },
        thud(40, 0.9, 0.9, 1.4),
      ];
      for (let i = 0; i < 8; i += 1)
        out.push(
          noise("white", "bandpass", 600 + rand() * 2400, 0.95 + rand() * 0.8, 0.3, 0.002, 0.15, 2),
        );
      for (let i = 0; i < 6; i += 1)
        out.push(
          noise("white", "bandpass", 1500 + rand() * 3000, 2 + rand() * 4, 0.1, 0.002, 0.08, 3),
        );
      return out;
    }
    case "thermal": {
      if (event.combustible && event.temperature >= INSULATION_IGNITION_K)
        return fireCues(0, 15, rand);
      // Thermal expansion: metal ticking.
      const out: SoundCue[] = [];
      for (let i = 0; i < 5; i += 1)
        out.push(noise("white", "bandpass", 3000, i * 0.4 + rand() * 0.2, 0.08, 0.001, 0.03, 4));
      return out;
    }
    case "brownout":
      // Relays dropping out.
      return [0, 0.12, 0.3].map((at) => noise("white", "highpass", 1500, at, 0.2, 0.001, 0.02));
    default:
      return [noise("white", "highpass", 2000, 0, 0.1, 0.001, 0.02)]; // relay click
  }
}

/** When a cue ends, s. */
export function cueEnd(cue: SoundCue): number {
  switch (cue.type) {
    case "noise":
      return cue.at + cue.attack + cue.decay;
    case "groan":
      return cue.at + cue.duration + 0.3;
    default:
      return cue.at + cue.decay;
  }
}

/**
 * Sounds that last as long as a published condition does, rather than playing once: the
 * helium vent of a quenched or under-cooled magnet follows its boil-off, and a cavitating
 * pump rattles in proportion to the head it has lost. Levels 0..1.
 */
export interface ConditionSounds {
  readonly vent: number;
  readonly cavitation: number;
}

export function conditionSounds(part: ComponentReading): ConditionSounds {
  // log-scaled: 0.1 kg/s is a hiss, 100 kg/s a roar.
  const boil = part.heliumBoilOffKgS;
  const vent = boil > 1e-3 ? Math.min(1, Math.max(0.1, (Math.log10(boil) + 2) / 4)) : 0;
  const cavitation = Math.min(1, Math.max(0, 1 - part.headFraction));
  return { vent, cavitation };
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
