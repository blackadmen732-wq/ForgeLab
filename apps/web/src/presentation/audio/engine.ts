import type { PlantRole } from "@forgelab/sim-core";
import type { StageProgress } from "../activation.js";
import type { PresentationDirector, PresentationEvent } from "../director.js";
import type { AlarmTier, FacilityState } from "../facility.js";
import type { PlantReading } from "../reading.js";
import { getSettings, subscribeSettings } from "../settings.js";
import type { ComponentVisual } from "../visualState.js";
import {
  MAX_FAILURE_VOICES,
  conditionSounds,
  cueEnd,
  facilityActions,
  failureActions,
  pickVoices,
  stageActions,
  type AudioAction,
  type SoundCue,
} from "./rules.js";
import {
  dbToGain,
  envelope,
  filter,
  gain,
  hallImpulse,
  looped,
  noiseBuffer,
  osc,
} from "./synth.js";

/**
 * The audio engine: AudioEventBus (the director's events) → AudioRulesEngine (rules.ts)
 * → per-machine emitters and one-shots → Web Audio graph with 3D panning → buses
 * (ambient, machinery, alarms, failures, interface) → ducking → master → limiter.
 *
 * All synthesized. The context starts on the first user gesture, as browsers require.
 * Nothing here reads anything but presentation state, and nothing is written back.
 */
type Vec3 = readonly [number, number, number];

interface Emitter {
  readonly role: PlantRole;
  readonly panner: PannerNode;
  readonly level: GainNode;
  readonly pitch: AudioParam[];
  readonly base: number[];
  readonly span: number[];
  readonly nodes: AudioScheduledSourceNode[];
  readonly loudness: number;
}

/** How loud each role is at full activity, relative (0..1). */
const ROLE_LOUDNESS: Partial<Record<PlantRole, number>> = {
  "coolant-pump": 0.5,
  turbine: 0.55,
  generator: 0.35,
  "vacuum-pump": 0.18,
  "magnet-coil": 0.22,
  "plasma-heater": 0.25,
  "power-supply": 0.18,
  "heat-exchanger": 0.2,
  "fuel-injector": 0.1,
};

const MAX_EMITTERS = 32;

/** A sound that lasts while a published condition does (rules.ts `conditionSounds`). */
interface Condition {
  readonly vent: GainNode;
  readonly cavitation: GainNode;
  readonly nodes: AudioScheduledSourceNode[];
  readonly out: GainNode;
}

const MAX_CONDITIONS = 8;

export class AudioEngine {
  #director: PresentationDirector;
  #ctx: AudioContext | null = null;
  #buses: {
    master: GainNode;
    duck: GainNode;
    ambient: GainNode;
    machinery: GainNode;
    alarms: GainNode;
    failures: GainNode;
    ui: GainNode;
    reverb: ConvolverNode;
  } | null = null;
  #noise: Record<"white" | "pink" | "brown", AudioBuffer> | null = null;
  #ambient: { hvac: GainNode; hvacFilter: BiquadFilterNode; hum: GainNode } | null = null;
  #emitters = new Map<string, Emitter>();
  #conditions = new Map<string, Condition>();
  #alarmTier: AlarmTier = "NONE";
  #alarmTimer: ReturnType<typeof setInterval> | null = null;
  #activeVoices = 0;
  #meter: AnalyserNode | null = null;
  #unsubscribe: Array<() => void> = [];
  #lastStages = new Map<string, StageProgress>();

  constructor(director: PresentationDirector) {
    this.#director = director;
  }

  get running(): boolean {
    return this.#ctx !== null && this.#ctx.state === "running";
  }

  /** Call from a user gesture. Idempotent. */
  start(): void {
    if (this.#ctx !== null) {
      if (this.#ctx.state === "suspended") void this.#ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.#ctx = ctx;
    this.#noise = {
      white: noiseBuffer(ctx, 3, "white"),
      pink: noiseBuffer(ctx, 3, "pink"),
      brown: noiseBuffer(ctx, 4, "brown"),
    };
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    limiter.connect(meter);
    this.#meter = meter;
    const master = gain(ctx, 0);
    master.connect(limiter);
    const duck = gain(ctx, 1);
    duck.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = hallImpulse(ctx, 3.2);
    const reverbReturn = gain(ctx, 0.35);
    reverb.connect(reverbReturn).connect(master);
    const bus = (target: AudioNode, send: number) => {
      const g = gain(ctx, 1);
      g.connect(target);
      if (send > 0) g.connect(gain(ctx, send)).connect(reverb);
      return g;
    };
    this.#buses = {
      master,
      duck,
      reverb,
      ambient: bus(duck, 0.25),
      machinery: bus(duck, 0.45),
      alarms: bus(master, 0.6),
      failures: bus(master, 0.8),
      ui: bus(master, 0),
    };
    this.#startAmbient();
    this.#applySettings();
    this.#unsubscribe = [
      this.#director.on(this.#onEvent),
      subscribeSettings(() => this.#applySettings()),
    ];
    const state = this.#director.getState();
    this.#run(facilityActions(state.facility, "BUILD"));
  }

  dispose(): void {
    for (const u of this.#unsubscribe) u();
    this.#unsubscribe = [];
    this.#stopAlarm();
    this.#emitters.clear();
    this.#conditions.clear();
    void this.#ctx?.close();
    this.#ctx = null;
    this.#buses = null;
  }

  /** Camera pose, every frame. */
  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX !== undefined) {
      l.positionX.setTargetAtTime(position[0], t, 0.03);
      l.positionY.setTargetAtTime(position[1], t, 0.03);
      l.positionZ.setTargetAtTime(position[2], t, 0.03);
      l.forwardX.setTargetAtTime(forward[0], t, 0.03);
      l.forwardY.setTargetAtTime(forward[1], t, 0.03);
      l.forwardZ.setTargetAtTime(forward[2], t, 0.03);
      l.upX.setTargetAtTime(up[0], t, 0.03);
      l.upY.setTargetAtTime(up[1], t, 0.03);
      l.upZ.setTargetAtTime(up[2], t, 0.03);
    } else {
      l.setPosition(...position);
      l.setOrientation(...forward, ...up);
    }
  }

  /** Where a machine is now (it may be falling), every frame. */
  setEmitterPosition(id: string, x: number, y: number, z: number): void {
    const e = this.#emitters.get(id);
    const ctx = this.#ctx;
    if (e === undefined || ctx === null) return;
    const t = ctx.currentTime;
    e.panner.positionX.setTargetAtTime(x, t, 0.05);
    e.panner.positionY.setTargetAtTime(y, t, 0.05);
    e.panner.positionZ.setTargetAtTime(z, t, 0.05);
  }

  /** RMS level of the master output right now (0 when silent) — for tests and meters. */
  level(): number {
    const meter = this.#meter;
    if (meter === null) return 0;
    const data = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    return Math.sqrt(sum / data.length);
  }

  emitterIds(): string[] {
    return [...this.#emitters.keys()];
  }

  /* -------------------------------------------------------------------------------- */

  #applySettings(): void {
    const b = this.#buses;
    const ctx = this.#ctx;
    if (b === null || ctx === null) return;
    const s = getSettings();
    const t = ctx.currentTime;
    b.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume * 0.9, t, 0.05);
    b.alarms.gain.setTargetAtTime(s.alarmVolume, t, 0.05);
    b.ambient.gain.setTargetAtTime(s.ambientVolume, t, 0.05);
  }

  #onEvent = (event: PresentationEvent): void => {
    switch (event.type) {
      case "facility":
        this.#run(facilityActions(event.state, event.previous));
        return;
      case "destruction":
        this.#run(failureActions(event.event));
        return;
      case "stage": {
        const previous = this.#lastStages.get(event.stage.id);
        this.#lastStages.set(event.stage.id, event.stage);
        this.#run(stageActions(event.stage, previous));
        return;
      }
      case "reading":
        this.#updateEmitters(event.reading, this.#director.getState().visuals);
        return;
      case "reset":
        this.#lastStages.clear();
        this.#clearEmitters();
        return;
    }
  };

  #run(actions: readonly AudioAction[]): void {
    if (this.#ctx === null) return;
    const failures = actions.filter(
      (a): a is Extract<AudioAction, { kind: "failure" }> => a.kind === "failure",
    );
    for (const f of pickVoices(failures, MAX_FAILURE_VOICES - this.#activeVoices))
      this.#failure(f.cues, f.position, f.severity);
    for (const action of actions) {
      switch (action.kind) {
        case "alarm":
          this.#setAlarm(action.tier);
          break;
        case "duck":
          this.#duck(action.depthDb, action.seconds);
          break;
        case "ambient":
          this.#setAmbient(action.facility);
          break;
        case "stage":
          this.#chime(action.reached);
          break;
        case "stop-all":
          this.#setAlarm("NONE");
          this.#clearEmitters();
          break;
        default:
          break;
      }
    }
  }

  /* Ambient: HVAC and mains hum, which follow the facility's power. ------------------ */

  #startAmbient(): void {
    const ctx = this.#ctx!;
    const b = this.#buses!;
    const hvacSrc = looped(ctx, this.#noise!.brown);
    const hvacFilter = filter(ctx, "lowpass", 420, 0.5);
    const hvac = gain(ctx, 0.12);
    hvacSrc.connect(hvacFilter).connect(hvac).connect(b.ambient);
    hvacSrc.start();
    // Slow air movement.
    const lfo = osc(ctx, "sine", 0.07);
    const lfoDepth = gain(ctx, 0.03);
    lfo.connect(lfoDepth).connect(hvac.gain);
    lfo.start();
    const hum = gain(ctx, 0.012);
    for (const [f, a] of [
      [50, 1],
      [100, 0.6],
      [150, 0.25],
    ] as const) {
      const o = osc(ctx, "sine", f);
      o.connect(gain(ctx, a)).connect(hum);
      o.start();
    }
    hum.connect(b.ambient);
    this.#ambient = { hvac, hvacFilter, hum };
  }

  #setAmbient(state: FacilityState): void {
    const a = this.#ambient;
    const ctx = this.#ctx;
    if (a === null || ctx === null) return;
    const t = ctx.currentTime;
    const powerLoss = state === "POWER_LOSS";
    // HVAC fans spin down on power loss; the hum of energised plant rises when running.
    a.hvac.gain.setTargetAtTime(powerLoss ? 0.02 : 0.12, t, powerLoss ? 1.5 : 0.8);
    a.hvacFilter.frequency.setTargetAtTime(powerLoss ? 160 : 420, t, powerLoss ? 1.5 : 0.8);
    const hum = powerLoss ? 0 : state === "RUNNING" || state === "WARNING" ? 0.03 : 0.012;
    a.hum.gain.setTargetAtTime(hum, t, 0.6);
  }

  /* Machinery: one spatial emitter per running machine. ----------------------------- */

  #emitterFor(id: string, role: PlantRole): Emitter | null {
    const ctx = this.#ctx;
    const b = this.#buses;
    const loudness = ROLE_LOUDNESS[role];
    if (ctx === null || b === null || loudness === undefined) return null;
    if (this.#emitters.size >= MAX_EMITTERS) return null;
    const panner = new PannerNode(ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 8,
      rolloffFactor: 1.1,
      maxDistance: 400,
    });
    const level = gain(ctx, 0);
    level.connect(panner).connect(b.machinery);
    const pitch: AudioParam[] = [];
    const base: number[] = [];
    const span: number[] = [];
    const nodes: AudioScheduledSourceNode[] = [];
    const tone = (type: OscillatorType, f0: number, f1: number, amp: number, lp?: number) => {
      const o = osc(ctx, type, f0);
      const g = gain(ctx, amp);
      if (lp !== undefined) o.connect(filter(ctx, "lowpass", lp)).connect(g);
      else o.connect(g);
      g.connect(level);
      o.start();
      pitch.push(o.frequency);
      base.push(f0);
      span.push(f1 - f0);
      nodes.push(o);
    };
    const hiss = (type: BiquadFilterType, f: number, q: number, amp: number) => {
      const n = looped(ctx, this.#noise!.pink);
      n.playbackRate.value = 0.8 + Math.random() * 0.4;
      n.connect(filter(ctx, type, f, q))
        .connect(gain(ctx, amp))
        .connect(level);
      n.start();
      nodes.push(n);
    };
    switch (role) {
      case "coolant-pump":
        tone("sawtooth", 22, 48, 0.5, 700); // motor and blade-pass
        tone("sine", 50, 100, 0.25);
        hiss("bandpass", 650, 0.8, 0.6); // water through the volute
        break;
      case "turbine":
        tone("triangle", 60, 300, 0.35);
        tone("sine", 180, 900, 0.12);
        hiss("highpass", 1800, 0.5, 0.35); // steam
        break;
      case "generator":
        tone("sine", 100, 100, 0.4); // electrical hum at grid frequency
        tone("sawtooth", 50, 150, 0.12, 500);
        break;
      case "vacuum-pump":
        tone("sine", 300, 1100, 0.3); // turbomolecular whine
        hiss("bandpass", 2400, 3, 0.1);
        break;
      case "magnet-coil":
        tone("sine", 100, 100, 0.35);
        tone("sine", 200, 200, 0.12);
        hiss("lowpass", 180, 0.7, 0.4); // cold-box compressors
        break;
      case "plasma-heater":
        tone("sawtooth", 400, 400, 0.12, 1600);
        hiss("highpass", 3000, 0.7, 0.2);
        break;
      case "power-supply":
        tone("sine", 100, 100, 0.4);
        tone("sine", 300, 300, 0.1);
        break;
      case "heat-exchanger":
        hiss("bandpass", 450, 0.6, 0.7);
        break;
      case "fuel-injector":
        hiss("bandpass", 3500, 2, 0.3);
        break;
      default:
        break;
    }
    const emitter: Emitter = { role, panner, level, pitch, base, span, nodes, loudness };
    this.#emitters.set(id, emitter);
    return emitter;
  }

  #conditionFor(id: string, position: Vec3): Condition | null {
    const ctx = this.#ctx;
    const b = this.#buses;
    const noise = this.#noise;
    if (ctx === null || b === null || noise === null) return null;
    if (this.#conditions.size >= MAX_CONDITIONS) return null;
    const panner = new PannerNode(ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 10,
      positionX: position[0],
      positionY: position[1],
      positionZ: position[2],
    });
    const out = gain(ctx, 1);
    out.connect(panner).connect(b.failures);
    // Helium venting through the relief line: a broad hiss with a hollow band.
    const vent = gain(ctx, 0);
    const v1 = looped(ctx, noise.pink);
    v1.connect(filter(ctx, "bandpass", 1100, 0.9)).connect(vent);
    const v2 = looped(ctx, noise.white);
    v2.connect(filter(ctx, "highpass", 3500, 0.7))
      .connect(gain(ctx, 0.3))
      .connect(vent);
    vent.connect(out);
    // Cavitation: vapour bubbles collapsing on the impeller — gravel in the pump, a
    // band of noise chopped irregularly.
    const cavitation = gain(ctx, 0);
    const c1 = looped(ctx, noise.white);
    const chop = gain(ctx, 0.5);
    c1.connect(filter(ctx, "bandpass", 1900, 1.4))
      .connect(chop)
      .connect(cavitation);
    const lfo = osc(ctx, "square", 17);
    lfo.connect(gain(ctx, 0.5)).connect(chop.gain);
    const lfo2 = osc(ctx, "square", 6.3);
    lfo2.connect(gain(ctx, 0.25)).connect(chop.gain);
    cavitation.connect(out);
    const nodes = [v1, v2, c1, lfo, lfo2];
    for (const n of nodes) n.start();
    const condition: Condition = { vent, cavitation, nodes, out };
    this.#conditions.set(id, condition);
    return condition;
  }

  #updateConditions(reading: PlantReading): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const t = ctx.currentTime;
    for (const c of reading.components) {
      const level = conditionSounds(c);
      let cond = this.#conditions.get(c.id);
      if (cond === undefined) {
        if (level.vent === 0 && level.cavitation === 0) continue;
        const created = this.#conditionFor(c.id, c.position);
        if (created === null) continue;
        cond = created;
      }
      cond.vent.gain.setTargetAtTime(0.5 * level.vent, t, 0.4);
      cond.cavitation.gain.setTargetAtTime(0.35 * level.cavitation, t, 0.3);
    }
  }

  #updateEmitters(reading: PlantReading, visuals: ReadonlyMap<string, ComponentVisual>): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const t = ctx.currentTime;
    this.#updateConditions(reading);
    for (const c of reading.components) {
      const visual = visuals.get(c.id);
      if (visual === undefined) continue;
      let e = this.#emitters.get(c.id);
      if (e === undefined) {
        if (visual.activity <= 0.01) continue;
        const created = this.#emitterFor(c.id, c.role);
        if (created === null) continue;
        e = created;
        e.panner.positionX.value = c.position[0];
        e.panner.positionY.value = c.position[1];
        e.panner.positionZ.value = c.position[2];
      }
      const silent = visual.state === "FAILED" || visual.state === "OFF";
      const a = silent ? 0 : visual.activity;
      // Spin-up is quick, coast-down slower, like the machines themselves.
      const tau = a > e.level.gain.value ? 0.6 : 1.4;
      e.level.gain.setTargetAtTime(e.loudness * Math.sqrt(a), t, tau);
      e.pitch.forEach((p, i) => p.setTargetAtTime(e.base[i]! + e.span[i]! * a, t, tau));
    }
  }

  #clearEmitters(): void {
    const ctx = this.#ctx;
    for (const e of this.#emitters.values()) {
      if (ctx !== null) e.level.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      const nodes = e.nodes;
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.stop();
          } catch {
            // already stopped
          }
        }
        e.level.disconnect();
      }, 1500);
    }
    this.#emitters.clear();
    for (const c of this.#conditions.values()) {
      if (ctx !== null) c.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => {
        for (const n of c.nodes) {
          try {
            n.stop();
          } catch {
            // already stopped
          }
        }
        c.out.disconnect();
      }, 1500);
    }
    this.#conditions.clear();
  }

  /* Alarms: repeating patterns by tier, through the hall PA (not spatial). ----------- */

  #setAlarm(tier: AlarmTier): void {
    if (tier === this.#alarmTier) return;
    this.#alarmTier = tier;
    this.#stopAlarm();
    if (tier === "NONE") return;
    const period = { ADVISORY: 0, CAUTION: 5000, WARNING: 1100, EMERGENCY: 1700 }[tier];
    this.#alarmPulse(tier);
    if (period > 0) this.#alarmTimer = setInterval(() => this.#alarmPulse(tier), period);
  }

  #stopAlarm(): void {
    if (this.#alarmTimer !== null) clearInterval(this.#alarmTimer);
    this.#alarmTimer = null;
  }

  #alarmPulse(tier: AlarmTier): void {
    const ctx = this.#ctx;
    const b = this.#buses;
    if (ctx === null || b === null || document.hidden) return;
    const t = ctx.currentTime + 0.02;
    const out = gain(ctx, 1);
    out.connect(b.alarms);
    const note = (
      f: number,
      at: number,
      dur: number,
      amp: number,
      type: OscillatorType = "sine",
    ) => {
      const o = osc(ctx, type, f);
      const g = gain(ctx, 0);
      o.connect(g).connect(out);
      envelope(g.gain, at, amp, 0.01, dur);
      o.start(at);
      o.stop(at + dur + 0.1);
    };
    switch (tier) {
      case "ADVISORY": // single soft chime
        note(880, t, 0.9, 0.08);
        note(1320, t, 0.7, 0.04);
        break;
      case "CAUTION": // two-tone chime
        note(988, t, 0.6, 0.1);
        note(784, t + 0.45, 0.8, 0.1);
        break;
      case "WARNING": // repeating beep
        note(1000, t, 0.22, 0.12, "square");
        break;
      case "EMERGENCY": {
        // Whoop: a rising sweep, as industrial evacuation alarms do.
        const o = osc(ctx, "sawtooth", 500);
        const lp = filter(ctx, "lowpass", 2400);
        const g = gain(ctx, 0);
        o.connect(lp).connect(g).connect(out);
        o.frequency.setValueAtTime(500, t);
        o.frequency.exponentialRampToValueAtTime(1150, t + 0.85);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.05);
        g.gain.setValueAtTime(0.09, t + 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        o.start(t);
        o.stop(t + 1);
        break;
      }
      default:
        break;
    }
    setTimeout(() => out.disconnect(), 2500);
  }

  #chime(reached: boolean): void {
    const ctx = this.#ctx;
    const b = this.#buses;
    if (ctx === null || b === null) return;
    const t = ctx.currentTime + 0.01;
    const o = osc(ctx, "sine", reached ? 1568 : 330);
    const g = gain(ctx, 0);
    o.connect(g).connect(b.ui);
    envelope(g.gain, t, reached ? 0.03 : 0.05, 0.005, reached ? 0.35 : 0.5);
    o.start(t);
    o.stop(t + 0.7);
  }

  #duck(depthDb: number, seconds: number): void {
    const ctx = this.#ctx;
    const b = this.#buses;
    if (ctx === null || b === null) return;
    const t = ctx.currentTime;
    const g = b.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(dbToGain(depthDb), t + 0.04);
    g.setTargetAtTime(1, t + 0.3, seconds / 3);
  }

  /* Debris impacts: short metallic clanks, rate-limited. ---------------------------- */

  #lastImpact = 0;

  /** A debris fragment hit something with `force` newtons (from the debris physics). */
  impact(position: Vec3, force: number): void {
    const ctx = this.#ctx;
    const b = this.#buses;
    const noise = this.#noise;
    if (ctx === null || b === null || noise === null) return;
    const now = ctx.currentTime;
    if (now - this.#lastImpact < 0.06) return;
    this.#lastImpact = now;
    const loud = Math.min(1, Math.log10(Math.max(force, 1e3)) / 7);
    const panner = new PannerNode(ctx, {
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 6,
      positionX: position[0],
      positionY: position[1],
      positionZ: position[2],
    });
    const out = gain(ctx, 0.25 * loud);
    out.connect(panner).connect(b.failures);
    const n = ctx.createBufferSource();
    n.buffer = noise.white;
    const g = gain(ctx, 0);
    n.connect(filter(ctx, "bandpass", 900 + Math.random() * 2500, 3))
      .connect(g)
      .connect(out);
    envelope(g.gain, now, 0.8, 0.001, 0.12);
    n.start(now);
    n.stop(now + 0.2);
    const o = osc(ctx, "sine", 700 + Math.random() * 1600);
    const og = gain(ctx, 0);
    o.connect(og).connect(out);
    envelope(og.gain, now, 0.25, 0.001, 0.35);
    o.start(now);
    o.stop(now + 0.4);
    setTimeout(() => out.disconnect(), 800);
  }

  /* Failure one-shots, placed where the failure happened. --------------------------- */

  #failure(cues: readonly SoundCue[], position: Vec3, severity: number): void {
    const ctx = this.#ctx;
    const b = this.#buses;
    const noise = this.#noise;
    if (ctx === null || b === null || noise === null || cues.length === 0) return;
    const t = ctx.currentTime + 0.01;
    const panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "inverse",
      refDistance: 12,
      rolloffFactor: 0.8,
      positionX: position[0],
      positionY: position[1],
      positionZ: position[2],
    });
    const out = gain(ctx, 0.6 + 0.8 * severity);
    out.connect(panner).connect(b.failures);
    this.#activeVoices += 1;
    let length = 1;
    for (const cue of cues) {
      const at = t + cue.at;
      length = Math.max(length, cueEnd(cue));
      switch (cue.type) {
        case "noise": {
          const n = ctx.createBufferSource();
          n.buffer = noise[cue.color];
          n.loop = true;
          const g = gain(ctx, 0);
          n.connect(filter(ctx, cue.filter, cue.f, cue.q))
            .connect(g)
            .connect(out);
          envelope(g.gain, at, cue.peak, cue.attack, cue.decay);
          n.start(at);
          n.stop(at + cue.attack + cue.decay + 0.1);
          break;
        }
        case "thud": {
          const o = osc(ctx, "sine", cue.f * 2);
          o.frequency.setValueAtTime(cue.f * 2, at);
          o.frequency.exponentialRampToValueAtTime(cue.f, at + 0.15);
          const g = gain(ctx, 0);
          o.connect(g).connect(out);
          envelope(g.gain, at, cue.peak, 0.005, cue.decay);
          o.start(at);
          o.stop(at + cue.decay + 0.1);
          break;
        }
        case "ring":
          for (const [i, f] of cue.partials.entries()) {
            const o = osc(ctx, "sine", f);
            const g = gain(ctx, 0);
            o.connect(g).connect(out);
            envelope(g.gain, at, cue.peak / (i + 1), 0.002, cue.decay * (1 - i * 0.12));
            o.start(at);
            o.stop(at + cue.decay + 0.1);
          }
          break;
        case "groan": {
          const o = osc(ctx, "sawtooth", cue.from);
          const g = gain(ctx, 0);
          o.connect(filter(ctx, "lowpass", 400, 4))
            .connect(g)
            .connect(out);
          o.frequency.setValueAtTime(cue.from, at);
          o.frequency.exponentialRampToValueAtTime(cue.to, at + cue.duration);
          envelope(g.gain, at, cue.peak, 0.2, cue.duration);
          o.start(at);
          o.stop(at + cue.duration + 0.3);
          break;
        }
      }
    }
    setTimeout(
      () => {
        this.#activeVoices = Math.max(0, this.#activeVoices - 1);
        out.disconnect();
      },
      (length + 0.5) * 1000,
    );
  }
}
