/**
 * A tiny sample-level synthesizer for building looping textures directly in
 * JS. Thousands of raindrops or bubbles as Web Audio nodes would take
 * seconds to render; written straight into arrays they take milliseconds.
 * Everything wraps around the end of the buffer, so whatever rings past the
 * end lands on the start and the loop is seamless by construction.
 */
export class Stereo {
  readonly left: Float32Array<ArrayBuffer>;
  readonly right: Float32Array<ArrayBuffer>;

  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
  }

  get seconds(): number {
    return this.length / this.sampleRate;
  }

  /** Add `value` at sample `i` (wrapping), panned with gains `gl`, `gr`. */
  add(i: number, value: number, gl: number, gr: number): void {
    const k = ((i % this.length) + this.length) % this.length;
    this.left[k] += value * gl;
    this.right[k] += value * gr;
  }
}

/** Equal-power stereo gains for `pan` ∈ [-1, 1]. */
export function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** An RBJ-cookbook biquad filter, processed one sample at a time. */
export class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  private constructor(private readonly sampleRate: number) {}

  static make(type: FilterType, frequency: number, q: number, sampleRate: number): Biquad {
    const filter = new Biquad(sampleRate);
    filter.tune(type, frequency, q);
    return filter;
  }

  /** Change the filter's response, keeping its state so a moving filter doesn't click. */
  tune(type: FilterType, frequency: number, q: number): void {
    const w = (2 * Math.PI * Math.min(frequency, this.sampleRate * 0.45)) / this.sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      // Constant 0 dB peak gain.
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Grain times for a Poisson process of `density` events a second over the buffer. */
export function poissonTimes(seconds: number, density: number, rng: () => number): number[] {
  const times: number[] = [];
  let t = -Math.log(1 - rng()) / density;
  while (t < seconds) {
    times.push(t);
    t += -Math.log(1 - rng()) / density;
  }
  return times;
}

/**
 * A water bubble at `t` (s): a sine whose pitch rises as it closes (the
 * Minnaert resonance), with a near-instant attack and exponential decay.
 */
export function addBubble(out: Stereo, t: number, frequency: number, length: number, peak: number, pan: number, rise = 1.5): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const [gl, gr] = panGains(pan);
  const attack = Math.max(1, Math.round(0.0015 * sr));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (2 * Math.PI * frequency * (1 + (rise - 1) * u)) / sr;
    const env = (i < attack ? i / attack : 1) * Math.exp(-5 * u);
    out.add(start + i, Math.sin(phase) * env * peak, gl, gr);
  }
}

/** A burst of filtered noise at `t` (s): sharp attack, exponential decay over `length`. */
export function addNoiseBurst(out: Stereo, t: number, length: number, filter: Biquad, peak: number, pan: number, rng: () => number, attack = 0.0015): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const a = Math.max(1, Math.round(attack * sr));
  const [gl, gr] = panGains(pan);
  for (let i = 0; i < n; i++) {
    const env = (i < a ? i / a : 1) * Math.exp((-6.9 * i) / n);
    out.add(start + i, filter.process(rng() * 2 - 1) * env * peak, gl, gr);
  }
}

/**
 * A tone at `t` (s) shaped by `envelope(u)` over its length (u: 0..1),
 * gliding from `from` to `to` Hz, with optional extra harmonics [ratio, level].
 */
export function addTone(
  out: Stereo,
  t: number,
  length: number,
  from: number,
  to: number,
  peak: number,
  pan: number,
  envelope: (u: number) => number,
  harmonics: ReadonlyArray<readonly [number, number]> = [],
): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const [gl, gr] = panGains(pan);
  let phase = 0;
  // An exponential glide, stepped multiplicatively per sample.
  let step = (2 * Math.PI * from) / sr;
  const ratio = (to / from) ** (1 / Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += step;
    step *= ratio;
    let v = Math.sin(phase);
    for (const [ratio, level] of harmonics) v += Math.sin(phase * ratio) * level;
    out.add(start + i, v * envelope(u) * peak, gl, gr);
  }
}

/** Attack–decay envelope helper: linear rise over `attack` (0..1 of length), then exponential fall. */
export function pluck(attack: number, decay = 5): (u: number) => number {
  return (u) => (u < attack ? u / attack : Math.exp((-decay * (u - attack)) / (1 - attack)));
}
