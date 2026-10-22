import { createRng } from '../core/random';
import { addBubble, addNoiseBurst, Biquad, panGains, poissonTimes, Stereo, type FilterType } from './synth';

/** Every texture loop is levelled to this RMS, so layer gains mean the same thing for each… */
const TEXTURE_RMS = 0.1;
/**
 * …unless that would push its loudest moment past this many times the RMS.
 * A sparse texture (light rain, a few pebbles) is mostly silence: raising
 * it to the full RMS would make every tick in it a sharp crackle, so it is
 * left quieter instead.
 */
const MAX_CREST = 4;

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
 * Lay a continuous stream of sound, sample by sample from `source`, across
 * the whole loop at `pan`. It runs a little past the end and fades across
 * the join, so the loop has no seam.
 */
export function wash(out: Stereo, pan: number, source: () => number): void {
  const join = Math.round(0.25 * out.sampleRate);
  const [gl, gr] = panGains(pan);
  for (let i = 0; i < out.length + join; i++) {
    const v = source();
    const fade = i < join ? Math.sin((Math.PI / 2) * (i / join)) : i >= out.length ? Math.cos((Math.PI / 2) * ((i - out.length) / join)) : 1;
    out.add(i, v * fade, gl, gr);
  }
}

/** What rain falls on: the sound of one drop, and the band of the hush of countless finer ones under them. */
export interface Surface {
  drop: Grain;
  hush: readonly [FilterType, number, number];
}

/** How loud the hush is beside the drops it lies under (RMS ratio). */
const HUSH = 0.7;

/**
 * Rain on a surface: its drops at `density` a second, over a soft hush of
 * the countless smaller ones too fine to hear apart. The hush is what real
 * rain sounds like between the drops; without it each drop stands out of
 * silence as a click.
 */
export function rainOn(density: number, surface: Surface, width = 0.9): TextureSpec {
  const drops = scattered(density, surface.drop, width);
  return {
    render: (out, rng) => {
      drops.render(out, rng);
      const hush = new Stereo(out.length, out.sampleRate);
      for (const pan of [-0.7, 0.7]) {
        const [type, f, q] = surface.hush;
        const filter = Biquad.make(type, f, q, out.sampleRate);
        wash(hush, pan, () => filter.process(rng() * 2 - 1));
      }
      const scale = (HUSH * rms(out)) / Math.max(1e-9, rms(hush));
      for (let i = 0; i < out.length; i++) {
        out.left[i] += hush.left[i] * scale;
        out.right[i] += hush.right[i] * scale;
      }
    },
  };
}

function rms(s: Stereo): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.left[i] ** 2 + s.right[i] ** 2;
  return Math.sqrt(sum / (2 * s.length));
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
  normalize({ numberOfChannels: 2, getChannelData: (ch) => (ch ? out.right : out.left) }, TEXTURE_RMS, TEXTURE_RMS * MAX_CREST);
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

/** Scale `buffer` to the given RMS, without letting any peak pass `ceiling`. */
export function normalize(buffer: { numberOfChannels: number; getChannelData(ch: number): Float32Array }, rms: number, ceiling = 0.95): void {
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
  const scale = Math.min(rms / Math.sqrt(sum / count), ceiling / peak);
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
  attack?: number,
): void {
  addNoiseBurst(out, t, length, Biquad.make(type, frequency, q, out.sampleRate), peak, pan, rng, attack);
}

/** A drop into water: the "plip" of a bubble, pitched somewhere in [low, high] Hz. */
export function plip(out: Stereo, t: number, pan: number, rng: () => number, low: number, high: number, peak: number): void {
  const f = low * (high / low) ** rng();
  addBubble(out, t, f, 0.012 + 0.035 * rng() * Math.sqrt(900 / f), peak * (0.3 + rng() * 0.7), pan, 1.3 + rng() * 0.6);
}

/*
 * The drops are soft-edged on purpose: a real drop's tap takes a few
 * milliseconds to bloom, and anything quicker or brighter reads as a crackle.
 */

/** Rain on leaves: soft, bright pats, with now and then a heavier drip off the canopy. */
export const leafDrop: Grain = (out, t, pan, rng) => {
  if (rng() < 0.08) burst(out, t, pan, rng, 'bandpass', 700 + rng() * 900, 1.4, 0.8, 0.06 + rng() * 0.03, 0.006);
  else burst(out, t, pan, rng, 'bandpass', 2200 + rng() * 3000, 1.1, 0.3 + rng() * 0.5, 0.015 + rng() * 0.02, 0.005);
};

/** Rain on grass: a dense, hushed patter, darker than leaves. */
export const grassDrop: Grain = (out, t, pan, rng) => {
  burst(out, t, pan, rng, 'bandpass', 1400 + rng() * 2200, 0.8, 0.3 + rng() * 0.5, 0.015 + rng() * 0.015, 0.005);
};

/** Rain in town: pats on stone and roofs, a ring off metal now and then, plips in the puddles. */
export const streetDrop: Grain = (out, t, pan, rng) => {
  const roll = rng();
  if (roll < 0.1) burst(out, t, pan, rng, 'bandpass', 1800 + rng() * 2200, 8, 0.6, 0.06 + rng() * 0.05, 0.004);
  else if (roll < 0.3) plip(out, t, pan, rng, 900, 2600, 0.3);
  else burst(out, t, pan, rng, 'bandpass', 2000 + rng() * 2500, 0.8, 0.3 + rng() * 0.4, 0.014 + rng() * 0.014, 0.005);
};

/** Rain at the shore: muffled taps on wet sand and tiny plips on the water. */
export const shoreDrop: Grain = (out, t, pan, rng) => {
  if (rng() < 0.35) plip(out, t, pan, rng, 1800, 4200, 0.18);
  else burst(out, t, pan, rng, 'lowpass', 1600 + rng() * 1200, 0.7, 0.4 + rng() * 0.4, 0.015 + rng() * 0.02, 0.005);
};

/**
 * A drop striking the window pane, heard from inside: a little tap that
 * rings briefly at the glass's resonance, over a soft thump of the pane itself.
 */
export const glassDrop: Grain = (out, t, pan, rng) => {
  const big = rng() < 0.15;
  burst(out, t, pan, rng, 'bandpass', 2500 + rng() * 3000, 5 + rng() * 4, (big ? 1.6 : 1) * (0.4 + rng() * 0.6), 0.02 + rng() * 0.02, 0.003);
  burst(out, t, pan, rng, 'lowpass', 380 + rng() * 260, 1.2, big ? 0.5 : 0.15, 0.04, 0.005);
};

/** The surfaces rain falls on. */
export const LEAVES: Surface = { drop: leafDrop, hush: ['bandpass', 3000, 0.5] };
export const GRASS: Surface = { drop: grassDrop, hush: ['bandpass', 2000, 0.5] };
export const STREET: Surface = { drop: streetDrop, hush: ['bandpass', 2500, 0.6] };
export const SAND: Surface = { drop: shoreDrop, hush: ['lowpass', 2500, 0.5] };
export const GLASS: Surface = { drop: glassDrop, hush: ['bandpass', 2800, 0.7] };

/** Water running down the glass and dripping off the frame: slow, quiet bubbles. */
export const runoff: Grain = (out, t, pan, rng) => plip(out, t, pan, rng, 500, 1400, 0.4);
