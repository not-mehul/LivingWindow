import { createRng } from '../core/random';
import { addBubble, addNoiseBurst, Biquad, panGains, poissonTimes, Stereo } from './synth';

/** Every texture loop is levelled to this RMS, so layer gains mean the same thing for each. */
const TEXTURE_RMS = 0.1;

/** Draw a whole texture into `out` (its times wrap at the end, so it loops seamlessly). */
export type TextureRender = (out: Stereo, rng: () => number) => void;

export interface TextureSpec {
  render: TextureRender;
  seconds?: number;
}

/** One small event in a texture at time `t` (s), panned to `pan`. */
export type Grain = (out: Stereo, t: number, pan: number, rng: () => number) => void;

/** A texture of `grain`s at Poisson-random times (so no rhythm emerges), spread across the stereo field. */
export function scattered(density: number, grain: Grain, width = 0.9, seconds?: number): TextureSpec {
  return {
    seconds,
    render: (out, rng) => {
      for (const t of poissonTimes(out.seconds, density, rng)) grain(out, t, (rng() * 2 - 1) * width, rng);
    },
  };
}

/**
 * A texture scattered from recordings: each grain is one of `buffers`
 * (their first channel), at a random level and a slightly random speed.
 */
export function sampled(density: number, buffers: readonly { getChannelData(ch: number): Float32Array; length: number }[], width = 0.85): TextureSpec {
  return scattered(
    density,
    (out, t, pan, rng) => {
      const data = buffers[Math.floor(rng() * buffers.length)].getChannelData(0);
      const rate = 0.9 + rng() * 0.2;
      const gain = 0.3 + rng() * 0.7;
      const [gl, gr] = panGains(pan);
      const start = Math.round(t * out.sampleRate);
      for (let i = 0; i * rate < data.length - 1; i++) {
        const x = i * rate;
        const k = Math.floor(x);
        out.add(start + i, (data[k] + (data[k + 1] - data[k]) * (x - k)) * gain, gl, gr);
      }
    },
    width,
  );
}

/** Synthesize a texture into a fresh, levelled stereo buffer. */
export function renderTexture(spec: TextureSpec, sampleRate: number, seed: number): Stereo {
  const out = new Stereo(Math.floor((spec.seconds ?? 9) * sampleRate), sampleRate);
  spec.render(out, createRng(seed));
  normalize({ numberOfChannels: 2, getChannelData: (ch) => (ch ? out.right : out.left) }, TEXTURE_RMS);
  return out;
}

/**
 * A continuous texture made of many small sounds (raindrops, bubbles,
 * insects), synthesized once into a seamless loop and then played as a
 * single looping buffer. Its level is a plain gain the owner sets.
 */
export class TextureLayer {
  readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    spec: TextureSpec,
    seed: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    // Off the current frame, so building several layers never stalls one.
    window.setTimeout(() => {
      if (this.stopped) return;
      const stereo = renderTexture(spec, ctx.sampleRate, seed);
      const buffer = ctx.createBuffer(2, stereo.length, ctx.sampleRate);
      buffer.copyToChannel(stereo.left, 0);
      buffer.copyToChannel(stereo.right, 1);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(this.gain);
      src.start(ctx.currentTime, Math.random() * buffer.duration);
      this.source = src;
    }, 0);
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

// --- Rain grains -------------------------------------------------------------

/** A short burst of noise through one filter. */
export function burst(
  out: Stereo,
  t: number,
  pan: number,
  rng: () => number,
  type: 'lowpass' | 'highpass' | 'bandpass',
  frequency: number,
  q: number,
  peak: number,
  length: number,
): void {
  addNoiseBurst(out, t, length, Biquad.make(type, frequency, q, out.sampleRate), peak, pan, rng);
}

/** A drop into water: the "plip" of a bubble, pitched somewhere in [low, high] Hz. */
export function plip(out: Stereo, t: number, pan: number, rng: () => number, low: number, high: number, peak: number): void {
  const f = low * (high / low) ** rng();
  addBubble(out, t, f, 0.012 + 0.035 * rng() * Math.sqrt(900 / f), peak * (0.3 + rng() * 0.7), pan, 1.3 + rng() * 0.6);
}

/** Rain on leaves: soft, bright ticks, with now and then a heavier drip off the canopy. */
export const leafDrop: Grain = (out, t, pan, rng) => {
  if (rng() < 0.08) burst(out, t, pan, rng, 'bandpass', 700 + rng() * 900, 1.4, 1.4, 0.05);
  else burst(out, t, pan, rng, 'bandpass', 2200 + rng() * 3200, 1.1, 0.4 + rng() * 0.6, 0.01 + rng() * 0.02);
};

/** Rain on grass: a dense, hushed patter, darker than leaves. */
export const grassDrop: Grain = (out, t, pan, rng) => {
  burst(out, t, pan, rng, 'bandpass', 1400 + rng() * 2200, 0.8, 0.3 + rng() * 0.5, 0.012 + rng() * 0.015);
};

/** Rain in town: ticks on stone and roofs, pings off metal, plips in the puddles. */
export const streetDrop: Grain = (out, t, pan, rng) => {
  const roll = rng();
  if (roll < 0.12) burst(out, t, pan, rng, 'bandpass', 1800 + rng() * 2200, 14, 1.3, 0.06 + rng() * 0.05);
  else if (roll < 0.3) plip(out, t, pan, rng, 900, 2600, 0.5);
  else burst(out, t, pan, rng, 'highpass', 2500 + rng() * 2500, 0.7, 0.3 + rng() * 0.5, 0.006 + rng() * 0.01);
};

/** Rain at the shore: muffled taps on wet sand and tiny plips on the water. */
export const shoreDrop: Grain = (out, t, pan, rng) => {
  if (rng() < 0.35) plip(out, t, pan, rng, 1800, 4200, 0.25);
  else burst(out, t, pan, rng, 'lowpass', 1600 + rng() * 1200, 0.7, 0.4 + rng() * 0.4, 0.015 + rng() * 0.02);
};

/**
 * A drop striking the window pane, heard from inside: a hard little click
 * that rings briefly at the glass's high resonance, over a soft thump of the
 * pane itself.
 */
export const glassDrop: Grain = (out, t, pan, rng) => {
  const big = rng() < 0.15;
  burst(out, t, pan, rng, 'bandpass', 3000 + rng() * 4500, 9 + rng() * 10, (big ? 3 : 1.3) * (0.4 + rng() * 0.6), 0.015 + rng() * 0.02);
  burst(out, t, pan, rng, 'lowpass', 380 + rng() * 260, 1.2, big ? 0.5 : 0.15, 0.03);
};

/** Water running down the glass and dripping off the frame: slow, quiet bubbles. */
export const runoff: Grain = (out, t, pan, rng) => plip(out, t, pan, rng, 500, 1400, 0.4);
