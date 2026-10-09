/**
 * Synthesis building blocks. Every sound in ForgeLab is generated here from oscillators,
 * noise and filters — no recorded assets to download, license or keep in sync.
 */

export type NoiseColor = "white" | "pink" | "brown";

/** Seeded so every session sounds the same. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  color: NoiseColor,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = mulberry32(color === "white" ? 11 : color === "pink" ? 23 : 37);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = random() * 2 - 1;
    if (color === "white") data[i] = white;
    else if (color === "pink") {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/**
 * A large hall's impulse response: decaying stereo noise with a slow high-frequency
 * roll-off. `seconds` is roughly RT60.
 */
export function hallImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    const random = mulberry32(101 + ch);
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const env = Math.pow(1 - t, 3.2);
      // Darker as it decays: a one-pole low-pass whose coefficient falls with time.
      const k = 0.55 - 0.45 * t;
      lp += k * (random() * 2 - 1 - lp);
      data[i] = lp * env * (i < ctx.sampleRate * 0.012 ? 0.3 : 1);
    }
  }
  return buffer;
}

export function looped(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

export function filter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.7,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  return o;
}

/** Attack–decay envelope on a gain param starting at `t`. */
export function envelope(
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(0.0001, peak), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
