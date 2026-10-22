import { Biquad, panGains, type FilterType, type Stereo } from '../synth';

/*
 * A richer voice for animal calls, modelled on recordings rather than on
 * pure tones. A real throat or syrinx makes a buzz of pulses, not a sine:
 * many harmonics falling off at a set slope, its period wavering cycle to
 * cycle (jitter) and its loudness too (shimmer), often with a rough
 * undertone where alternate cycles differ (a subharmonic: the gravel in a
 * raven's croak or a dog's howl breaking) and breath hissing through in
 * time with each pulse. That sound then passes through the vocal tract's
 * resonances (formants), which move as the mouth and beak open and close.
 */

/** A value along a call, keyed by position u (0..1): [u, value]. */
export type Track = ReadonlyArray<readonly [number, number]>;

/** A resonance of the vocal tract. `gain` is linear. */
export interface Formant {
  f: number;
  q: number;
  gain: number;
}

export interface VoiceSpec {
  /** Seconds. */
  length: number;
  /** Fundamental frequency (Hz) along the call. */
  pitch: Track;
  /** Loudness along the call (u: 0..1). */
  envelope: (u: number) => number;
  /** How each octave of harmonics falls off, as an amplitude ratio (0.5 ≈ −6 dB/oct; lower is duller). */
  tilt?: number;
  /** Highest harmonic frequency drawn (Hz). */
  ceiling?: number;
  /** Random wander of the pitch, cycle to cycle (fraction, ~0.005–0.04). */
  jitter?: number;
  /** Random wander of each cycle's loudness (fraction, ~0.05–0.4). */
  shimmer?: number;
  /** Subharmonic (period-doubling) level along the call, 0..1: roughness, gravel, a voice breaking. */
  sub?: number | Track;
  /** Slow rough amplitude flutter: rate (Hz), depth 0..1, randomised in phase. */
  growl?: readonly [number, number];
  /** Pitch vibrato: rate (Hz), depth (fraction). */
  vibrato?: readonly [number, number];
  /** Breath noise level along the call, relative to the voiced sound. */
  breath?: number | Track;
  /** The breath's band (Hz). */
  breathBand?: readonly [number, number];
  /** How much the breath comes in bursts with each glottal pulse (0 steady … 1 fully pulsed). */
  pulsedBreath?: number;
  /** Formant sets keyed along the call: [u, formants]. Sets must have the same number of formants. */
  formants?: ReadonlyArray<readonly [number, ReadonlyArray<Formant>]>;
  /** How much of the raw source passes the formants untouched (0..1). */
  dry?: number;
}

/** Interpolate a track at `u`: log-scaled (for frequencies) or linear, eased per segment. */
export function trackAt(track: Track, u: number, log = true): number {
  if (u <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [u1, v1] = track[i];
    if (u <= u1) {
      const [u0, v0] = track[i - 1];
      const x = (u - u0) / Math.max(1e-6, u1 - u0);
      const e = (1 - Math.cos(Math.PI * x)) / 2;
      return log && v0 > 0 && v1 > 0 ? v0 * (v1 / v0) ** e : v0 + (v1 - v0) * e;
    }
  }
  return track[track.length - 1][1];
}

const level = (v: number | Track | undefined, u: number) => (v === undefined ? 0 : typeof v === 'number' ? v : trackAt(v, u, false));

/** A slowly wandering random value in about [-1, 1] (one-pole smoothed noise). */
class Wander {
  private v = 0;
  constructor(
    private readonly rng: () => number,
    private readonly smooth: number,
  ) {}
  next(): number {
    this.v += (this.rng() * 2 - 1 - this.v) * this.smooth;
    return this.v;
  }
}

/** Formant bank state: one bandpass per formant, retuned as the set moves. */
function formantBank(spec: VoiceSpec, sr: number) {
  if (!spec.formants || spec.formants.length === 0) return null;
  const sets = spec.formants;
  const count = sets[0][1].length;
  const filters = Array.from({ length: count }, (_, k) => Biquad.make('bandpass', sets[0][1][k].f, sets[0][1][k].q, sr));
  const gains = new Float64Array(count);
  const tune = (u: number) => {
    for (let k = 0; k < count; k++) {
      const f = trackAt(
        sets.map(([at, fs]) => [at, fs[k].f] as const),
        u,
      );
      const q = trackAt(
        sets.map(([at, fs]) => [at, fs[k].q] as const),
        u,
        false,
      );
      gains[k] = trackAt(
        sets.map(([at, fs]) => [at, fs[k].gain] as const),
        u,
        false,
      );
      filters[k].tune('bandpass', f, q);
    }
  };
  tune(0);
  return {
    tune,
    process(x: number): number {
      let y = 0;
      for (let k = 0; k < count; k++) y += filters[k].process(x) * gains[k];
      return y;
    },
  };
}

/**
 * Voice a call at `t` (s) into `out`, mono and centred, at about `peak`.
 * `rng` drives every random wander, so a seed gives the same take.
 */
export function vocalise(out: Stereo, t: number, spec: VoiceSpec, peak: number, rng: () => number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(spec.length * sr);
  const [gl, gr] = panGains(0);
  const tilt = spec.tilt ?? 0.55;
  const slope = Math.log2(Math.max(0.05, Math.min(0.98, tilt)));
  const ceiling = Math.min(spec.ceiling ?? 9000, sr * 0.45);
  const jitter = new Wander(rng, 0.25);
  const drift = new Wander(rng, 0.002);
  const bank = formantBank(spec, sr);
  const dry = spec.formants ? (spec.dry ?? 0.15) : 1;
  const [b0, b1] = spec.breathBand ?? [600, 6000];
  const breathFilter = Biquad.make('bandpass', Math.sqrt(b0 * b1), Math.max(0.3, Math.sqrt(b0 * b1) / (b1 - b0)), sr);
  const pulsed = spec.pulsedBreath ?? 0.6;
  const growlPhase = rng() * Math.PI * 2;
  // Harmonic amplitudes depend only on the harmonic number.
  const maxK = 160;
  const amps = new Float64Array(maxK + 1);
  for (let k = 1; k <= maxK; k++) amps[k] = k ** slope;
  // Normalise the harmonic stack roughly, so tilt doesn't change loudness much.
  let norm = 0;
  for (let k = 1; k <= 24; k++) norm += amps[k];
  norm = 1 / Math.max(1, norm * 0.5);
  const block = Math.max(1, Math.round(sr * 0.001));
  let phase = rng();
  let cycle = 0;
  let cycleGain = 1;
  let jitterNow = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const time = i / sr;
    if (bank && i % block === 0) bank.tune(u);
    let f0 = trackAt(spec.pitch, u) * (1 + 0.01 * drift.next());
    if (spec.vibrato) f0 *= 1 + spec.vibrato[1] * Math.sin(2 * Math.PI * spec.vibrato[0] * time + growlPhase);
    f0 *= 1 + jitterNow;
    phase += f0 / sr;
    if (phase >= 1) {
      // A new glottal cycle: a fresh wobble in its period and loudness.
      phase -= 1;
      cycle++;
      jitterNow = (spec.jitter ?? 0.008) * jitter.next() * 2;
      cycleGain = 1 + (spec.shimmer ?? 0.08) * (rng() * 2 - 1);
    }
    // The harmonic stack by recurrence: sin(kθ) = 2cosθ·sin((k−1)θ) − sin((k−2)θ).
    const theta = 2 * Math.PI * phase;
    const kTop = Math.min(maxK, Math.floor(ceiling / Math.max(20, f0)));
    const c2 = 2 * Math.cos(theta);
    let s1 = Math.sin(theta);
    let s0 = 0;
    let voiced = 0;
    for (let k = 1; k <= kTop; k++) {
      // The top harmonics fade in and out as the pitch moves, so none pops in.
      const edge = Math.min(1, (kTop + 1 - k) / 3);
      voiced += amps[k] * edge * s1;
      const s2 = c2 * s1 - s0;
      s0 = s1;
      s1 = s2;
    }
    voiced *= norm * cycleGain;
    // A subharmonic: every other cycle pushed apart, an octave-down series of odd partials.
    const subLevel = level(spec.sub, u);
    if (subLevel > 0) {
      const half = (phase + (cycle % 2)) / 2;
      const th = 2 * Math.PI * half;
      let sub = 0;
      for (let j = 1; j <= Math.min(24, kTop * 2); j += 2) sub += amps[j] * Math.sin(th * j);
      voiced += sub * norm * subLevel;
    }
    let v = voiced;
    const breathLevel = level(spec.breath, u);
    if (breathLevel > 0) {
      const pulse = (0.5 + 0.5 * Math.cos(theta)) ** 3;
      v += breathFilter.process(rng() * 2 - 1) * breathLevel * 2.5 * (1 - pulsed + pulsed * pulse * 2);
    }
    if (bank) v = bank.process(v) + v * dry;
    let a = spec.envelope(u);
    if (spec.growl) a *= 1 - spec.growl[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * spec.growl[0] * time + growlPhase));
    out.add(start + i, v * a * peak, gl, gr);
  }
}

export interface BreathSpec {
  length: number;
  envelope: (u: number) => number;
  /** Noise shaping: filters in series, keyed as [u, Hz] where they sweep. */
  bands: ReadonlyArray<{ type: FilterType; f: Track; q: number }>;
  /** A low, voiced rumble under the breath (Hz, level), as in a huff or a snort's chest. */
  body?: readonly [number, number];
  /** Fluttering of the nostrils or lips: rate (Hz), depth 0..1. */
  flutter?: readonly [number, number];
}

/** A breathy, unvoiced sound: a snort, a huff, a blow. */
export function breathe(out: Stereo, t: number, spec: BreathSpec, peak: number, rng: () => number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(spec.length * sr);
  const [gl, gr] = panGains(0);
  const filters = spec.bands.map((b) => ({ ...b, filter: Biquad.make(b.type, trackAt(b.f, 0), b.q, sr) }));
  const block = Math.max(1, Math.round(sr * 0.001));
  const flutterPhase = rng() * Math.PI * 2;
  let bodyPhase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (i % block === 0) for (const b of filters) b.filter.tune(b.type, trackAt(b.f, u), b.q);
    let v = rng() * 2 - 1;
    for (const b of filters) v = b.filter.process(v);
    if (spec.body) {
      bodyPhase += (spec.body[0] * (1 + 0.04 * (rng() * 2 - 1))) / sr;
      const th = 2 * Math.PI * bodyPhase;
      v += spec.body[1] * (Math.sin(th) + 0.5 * Math.sin(2 * th) + 0.25 * Math.sin(3 * th)) * 0.3;
    }
    let a = spec.envelope(u);
    if (spec.flutter) a *= 1 - spec.flutter[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * spec.flutter[0] * (i / sr) + flutterPhase));
    out.add(start + i, v * a * peak, gl, gr);
  }
}

/** An envelope with a smooth (raised-cosine) rise over `attack` and fall over `release`, as fractions of the length. */
export function smooth(attack: number, release: number): (u: number) => number {
  return (u) => {
    const rise = u < attack ? 0.5 - 0.5 * Math.cos((Math.PI * u) / attack) : 1;
    const fall = u > 1 - release ? 0.5 - 0.5 * Math.cos((Math.PI * (1 - u)) / release) : 1;
    return rise * fall;
  };
}

/** Uniform random in [a, b]. */
export const between = (rng: () => number, a: number, b: number) => a + (b - a) * rng();
