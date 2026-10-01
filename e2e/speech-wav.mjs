import { writeFileSync } from "node:fs";

/**
 * A synthetic voice for the browser's fake microphone (`--use-file-for-fake-audio-capture`).
 *
 * Chromium's default fake device plays a short beep once a second. A real voice pipeline
 * treats that badly: the noise suppressor attenuates a stationary periodic tone, and the
 * SFU's active-speaker detector wants speech-level audio for a good share of each window,
 * so whether a beeping participant registers as "speaking" was a matter of luck.
 *
 * This writes speech-shaped audio instead: voiced syllables (a gliding pitch with
 * harmonics shaped by two formants), short gaps between syllables and longer pauses
 * between phrases — what noise suppression is built to keep and speaker detection is
 * built to find. Deterministic (seeded), so every run hears the same voice.
 */
export function writeSpeechWav(path, seconds = 12, sampleRate = 48000) {
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(n);
  let t = 0.15;
  while (t < seconds - 0.5) {
    const syllables = 4 + Math.floor(rand() * 5);
    for (let s = 0; s < syllables && t < seconds - 0.5; s += 1) {
      const length = 0.15 + rand() * 0.2;
      const f0a = 105 + rand() * 50;
      const f0b = f0a * (0.85 + rand() * 0.35);
      const f1 = 450 + rand() * 350;
      const f2 = 1000 + rand() * 1200;
      const start = Math.floor(t * sampleRate);
      const count = Math.floor(length * sampleRate);
      let phase = 0;
      for (let i = 0; i < count && start + i < n; i += 1) {
        const u = i / count;
        const f0 = f0a + (f0b - f0a) * u;
        phase += (2 * Math.PI * f0) / sampleRate;
        // 20 ms raised-cosine attack and release.
        const edge = Math.min(1, i / (0.02 * sampleRate), (count - i) / (0.02 * sampleRate));
        const envelope = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, edge));
        let v = 0;
        for (let h = 1; h * f0 < 4000; h += 1) {
          const f = h * f0;
          const formant =
            1 / (1 + ((f - f1) / 120) ** 2) + 0.6 / (1 + ((f - f2) / 180) ** 2) + 0.05;
          v += (formant / Math.sqrt(h)) * Math.sin(h * phase);
        }
        samples[start + i] += v * envelope;
      }
      t += length + 0.04 + rand() * 0.08;
    }
    t += 0.3 + rand() * 0.3;
  }
  // Normalise to a −6 dBFS peak.
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.5 / peak : 0;
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), 44 + i * 2);
  writeFileSync(path, data);
  return path;
}
