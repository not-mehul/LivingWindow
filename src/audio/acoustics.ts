import { createRng } from '../core/random';

/** How the outdoors sounds around the window: the space sounds echo in. */
export interface Acoustics {
  /** Reverb tail length (s). */
  decay: number;
  /** How quickly highs die in the tail: 0 = bright, 1 = dull. */
  damping: number;
  /** Discrete early echoes off nearby walls: delay (s) and level. */
  reflections: ReadonlyArray<readonly [delay: number, level: number]>;
  /** Pre-delay before the diffuse tail starts (s). */
  predelay: number;
  /** How much reverb a sound at the horizon gets (sends rise with depth up to this). */
  send: number;
}

export type AcousticsId = 'city' | 'forest' | 'meadows' | 'beach';

export const ACOUSTICS: Record<AcousticsId, Acoustics> = {
  // Hard façades: tight slap-back echoes, then a short, bright, dense tail.
  city: { decay: 1.6, damping: 0.35, reflections: [[0.045, 0.5], [0.09, 0.32], [0.14, 0.22], [0.21, 0.14]], predelay: 0.02, send: 0.55 },
  // Trunks scatter sound into a long, soft, diffuse tail that loses its highs.
  forest: { decay: 2.8, damping: 0.65, reflections: [[0.03, 0.18], [0.07, 0.15], [0.12, 0.12]], predelay: 0.015, send: 0.6 },
  // Open grass: barely any reverb, just a far-off hint from the treeline.
  meadows: { decay: 1.1, damping: 0.7, reflections: [[0.18, 0.12]], predelay: 0.03, send: 0.3 },
  // Open air over water: airy and wide, with little to bounce off.
  beach: { decay: 1.4, damping: 0.5, reflections: [[0.25, 0.08]], predelay: 0.03, send: 0.32 },
};

/**
 * A stereo impulse response for `acoustics`: exponentially decaying noise
 * (reaching -60 dB at `decay`), low-passed more and more as it fades so the
 * tail darkens like real air, plus a few early reflections, each slightly
 * different per channel for width.
 */
export function impulseResponse(acoustics: Acoustics, sampleRate: number, seed = 1): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.floor(sampleRate * (acoustics.predelay + acoustics.decay));
  const channels: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(length), new Float32Array(length)];
  const pre = Math.floor(sampleRate * acoustics.predelay);
  for (let ch = 0; ch < 2; ch++) {
    const data = channels[ch];
    const rng = createRng(seed * 977 + ch * 131);
    let low = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sampleRate;
      const env = 10 ** ((-3 * t) / acoustics.decay);
      // One-pole low-pass whose cutoff falls as the tail fades.
      const k = 1 - Math.min(0.97, acoustics.damping * (0.25 + (t / acoustics.decay) * 0.75));
      low += k * ((rng() * 2 - 1) - low);
      // Fade the first few ms in so the onset doesn't click.
      const onset = Math.min(1, (i - pre) / (sampleRate * 0.004));
      data[i] = low * env * onset;
    }
    for (const [delay, level] of acoustics.reflections) {
      const at = Math.floor(sampleRate * delay * (ch ? 1.07 : 1));
      if (at + 8 >= length) continue;
      // A short, slightly smeared click per wall.
      for (let j = 0; j < 8; j++) data[at + j] += level * (1 - j / 8) * (j % 2 ? -0.6 : 1);
    }
    // Normalise so every space returns about the same energy.
    let energy = 0;
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
    const scale = energy > 0 ? 0.6 / Math.sqrt(energy) : 0;
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return channels;
}
