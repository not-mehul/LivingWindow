import { createRng } from '../core/random';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Seeds per colour, so no two noise beds share their randomness. */
const SEEDS: Record<NoiseColor, number> = { white: 7919, pink: 104729, brown: 1299709 };

/**
 * Looping noise buffers shared by every synthesized sound. Each is several
 * seconds long and generated from a different seed per channel, so loops
 * are not detectable and the stereo image stays wide.
 */
export class NoiseBank {
  private readonly cache = new Map<NoiseColor, AudioBuffer>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly seconds = 11,
  ) {}

  get(color: NoiseColor): AudioBuffer {
    let buffer = this.cache.get(color);
    if (!buffer) {
      buffer = this.generate(color);
      this.cache.set(color, buffer);
    }
    return buffer;
  }

  /** A looping, playing buffer source of the given noise. */
  source(color: NoiseColor, offset = Math.random() * this.seconds): AudioBufferSourceNode {
    const node = this.context.createBufferSource();
    node.buffer = this.get(color);
    node.loop = true;
    node.start(this.context.currentTime, offset);
    return node;
  }

  private generate(color: NoiseColor): AudioBuffer {
    const rate = this.context.sampleRate;
    const length = Math.floor(rate * this.seconds);
    const buffer = this.context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      buffer.getChannelData(ch).set(loopedNoise(length, color, createRng(SEEDS[color] * (ch + 1)), Math.floor(rate * 0.08)));
    }
    return buffer;
  }
}

/**
 * `length` samples of noise that loop seamlessly: a little extra is
 * generated past the end and cross-faded (equal power, as the two halves
 * are uncorrelated) into the start, so the last sample flows straight into
 * the first with no click and no dip in level.
 */
export function loopedNoise(length: number, color: NoiseColor, rng: () => number, fade: number): Float32Array {
  const raw = new Float32Array(length + fade);
  fillNoise(raw, color, rng);
  const out = raw.subarray(0, length);
  for (let i = 0; i < fade; i++) {
    const t = ((i + 0.5) / fade) * (Math.PI / 2);
    out[i] = raw[i] * Math.sin(t) + raw[length + i] * Math.cos(t);
  }
  return out;
}

export function fillNoise(data: Float32Array, color: NoiseColor, rng: () => number): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = rng() * 2 - 1;
    if (color === 'white') {
      data[i] = white * 0.5;
    } else if (color === 'pink') {
      // Paul Kellet's refined pink noise filter.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
}
