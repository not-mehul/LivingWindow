import { createRng } from '../core/random';
import type { NoiseBank } from './noise';
import type { Prerender } from './render';

/** Every texture loop is levelled to this RMS, so layer gains mean the same thing for each. */
const TEXTURE_RMS = 0.1;

/** Draw one grain into `out` at `when`; `rng` gives its random character. */
export type Grain = (ctx: BaseAudioContext, out: AudioNode, when: number, rng: () => number, noise: NoiseBank) => void;

export interface TextureSpec {
  /** Grains per second. */
  density: number;
  grain: Grain;
  /** Stereo spread of the grains, 0..1. */
  width?: number;
  seconds?: number;
}

/**
 * Scatter grains through an offline context: Poisson-timed (so no rhythm
 * emerges), each panned at random.
 */
export function scatterGrains(ctx: OfflineAudioContext, spec: TextureSpec, seconds: number, seed: number, noise: NoiseBank): void {
  const rng = createRng(seed);
  const width = spec.width ?? 0.9;
  let t = 0;
  while (true) {
    t += -Math.log(1 - rng()) / spec.density;
    if (t >= seconds) break;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (rng() * 2 - 1) * width;
    pan.connect(ctx.destination);
    spec.grain(ctx, pan, t, rng, noise);
  }
}

/**
 * A continuous texture made of many small sounds (raindrops, bubbles,
 * ticks), rendered once offline into a seamless loop and then played as a
 * single looping buffer. Its level is a plain gain the owner sets; the
 * playback rate wanders a touch so the loop never lines up the same way.
 */
export class TextureLayer {
  readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    prerender: Prerender,
    noise: NoiseBank,
    out: AudioNode,
    spec: TextureSpec,
    seed: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    const seconds = spec.seconds ?? 9;
    void prerender.loop(seconds, (offline) => scatterGrains(offline, spec, seconds, seed, noise)).then((buffer) => {
      if (!buffer || this.stopped) return;
      normalize(buffer, TEXTURE_RMS);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = 1;
      src.connect(this.gain);
      src.start(ctx.currentTime, Math.random() * seconds);
      this.source = src;
    });
  }

  /** Ease the level towards `value` (time constant `tau` s). */
  set(value: number, tau = 0.8): void {
    this.gain.gain.setTargetAtTime(value, this.ctx.currentTime, tau);
  }

  stop(): void {
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      // Not started.
    }
    this.gain.disconnect();
  }
}

/** Scale `buffer` to the given RMS, without letting any peak pass 0.95. */
export function normalize(buffer: { numberOfChannels: number; getChannelData(ch: number): Float32Array }, rms: number): void {
  let sum = 0;
  let peak = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    for (const v of buffer.getChannelData(ch)) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    count += buffer.getChannelData(ch).length;
  }
  if (sum === 0) return;
  const scale = Math.min(rms / Math.sqrt(sum / count), 0.95 / peak);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

// --- Grains -----------------------------------------------------------------

function noiseGrain(
  ctx: BaseAudioContext,
  noise: NoiseBank,
  out: AudioNode,
  when: number,
  rng: () => number,
  type: BiquadFilterType,
  frequency: number,
  q: number,
  peak: number,
  length: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise.get('white');
  const bq = ctx.createBiquadFilter();
  bq.type = type;
  bq.frequency.value = frequency;
  bq.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(peak, when + 0.0015);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + length);
  src.connect(bq).connect(amp).connect(out);
  src.start(when, rng() * 9, length + 0.02);
}

/**
 * A water bubble: a sine whose pitch rises as the bubble closes (the
 * Minnaert resonance), the "plip" of drops into puddles and streams.
 */
export function bubble(ctx: BaseAudioContext, out: AudioNode, when: number, rng: () => number, low: number, high: number, peak: number): void {
  const f = low * (high / low) ** rng();
  const length = 0.012 + 0.03 * rng() * (900 / f) ** 0.5;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f, when);
  osc.frequency.exponentialRampToValueAtTime(f * (1.3 + rng() * 0.6), when + length);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(peak * (0.3 + rng() * 0.7), when + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(amp).connect(out);
  osc.start(when);
  osc.stop(when + length + 0.01);
}

/** Rain on leaves: soft, bright ticks, with now and then a heavier drip off the canopy. */
export const leafDrop: Grain = (ctx, out, when, rng, noise) => {
  if (rng() < 0.08) noiseGrain(ctx, noise, out, when, rng, 'bandpass', 700 + rng() * 900, 1.4, 0.5, 0.05);
  else noiseGrain(ctx, noise, out, when, rng, 'bandpass', 2200 + rng() * 3200, 1.1, 0.12 + rng() * 0.25, 0.01 + rng() * 0.02);
};

/** Rain on grass: a dense, hushed patter, darker than leaves. */
export const grassDrop: Grain = (ctx, out, when, rng, noise) => {
  noiseGrain(ctx, noise, out, when, rng, 'bandpass', 1400 + rng() * 2200, 0.8, 0.06 + rng() * 0.14, 0.012 + rng() * 0.015);
};

/** Rain in town: ticks on stone and roofs, pings off metal, plips in the puddles. */
export const streetDrop: Grain = (ctx, out, when, rng, noise) => {
  const roll = rng();
  if (roll < 0.12) {
    // An awning or gutter: a short, ringing ping.
    noiseGrain(ctx, noise, out, when, rng, 'bandpass', 1800 + rng() * 2600, 18, 1.2, 0.06 + rng() * 0.05);
  } else if (roll < 0.3) {
    bubble(ctx, out, when, rng, 900, 2600, 0.12);
  } else {
    noiseGrain(ctx, noise, out, when, rng, 'highpass', 2500 + rng() * 2500, 0.7, 0.1 + rng() * 0.2, 0.006 + rng() * 0.01);
  }
};

/** Rain at the shore: muffled taps on wet sand and tiny plips on the water. */
export const shoreDrop: Grain = (ctx, out, when, rng, noise) => {
  if (rng() < 0.35) bubble(ctx, out, when, rng, 1800, 4200, 0.05);
  else noiseGrain(ctx, noise, out, when, rng, 'lowpass', 1600 + rng() * 1200, 0.7, 0.12 + rng() * 0.15, 0.015 + rng() * 0.02);
};

/**
 * A drop striking the window pane, heard from inside: a hard little click
 * that rings briefly at the glass's high resonance, over a soft thump of the
 * pane itself.
 */
export const glassDrop: Grain = (ctx, out, when, rng, noise) => {
  const big = rng() < 0.15;
  noiseGrain(ctx, noise, out, when, rng, 'bandpass', 3000 + rng() * 4500, 9 + rng() * 10, (big ? 0.7 : 0.3) * (0.4 + rng() * 0.6), 0.015 + rng() * 0.02);
  noiseGrain(ctx, noise, out, when, rng, 'lowpass', 380 + rng() * 260, 1.2, big ? 0.25 : 0.08, 0.03);
};

/** Water running down the glass and dripping off the frame: slow, quiet bubbles. */
export const runoff: Grain = (ctx, out, when, rng) => {
  bubble(ctx, out, when, rng, 500, 1400, 0.08);
};
