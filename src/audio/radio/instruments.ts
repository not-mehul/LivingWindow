import { createRng } from '../../core/random';
import { addNoiseBurst, Biquad, panGains, Stereo } from '../synth';
import { midiToFrequency } from './music';

/*
 * The lofi station's instruments, synthesized sample by sample into
 * buffers: each note is rendered once and then played as a single buffer
 * source. Levels are absolute (not normalised), so velocity and balance
 * carry through.
 */

/**
 * An electric piano note (FM, like a Rhodes): a sine carrier whose
 * brightness (modulation index) blooms at the hammer strike and settles,
 * a bell-like tine ping at the attack, and a long, slowly fading body.
 * Left and right are detuned a hair for a warm, chorused width.
 */
export function rhodes(midi: number, velocity: number, sampleRate: number, seconds = 4.5): Stereo {
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  const f = midiToFrequency(midi);
  // Low notes ring longer.
  const decay = 1.1 + 1.6 * Math.max(0, (72 - midi) / 30);
  const bark = 1.6 + 2.6 * velocity;
  for (let ch = 0; ch < 2; ch++) {
    const data = ch ? out.right : out.left;
    const fc = f * (ch ? 1.0012 : 0.9988);
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      const index = bark * Math.exp(-t / 0.3) + 0.7;
      const mod = Math.sin(2 * Math.PI * fc * t);
      const body = Math.sin(2 * Math.PI * fc * t + index * mod);
      const tine = Math.sin(2 * Math.PI * fc * 7.1 * t) * Math.exp(-t / 0.05) * 0.35 * velocity;
      // The note dies away over the buffer's last second rather than stopping.
      const tail = Math.min(1, (seconds - t) / 1);
      const env = Math.min(1, t / 0.002) * (0.75 * Math.exp(-t / decay) + 0.25 * Math.exp(-t / (decay * 3))) * tail;
      data[i] = (body + tine) * env * (0.3 + 0.7 * velocity) * 0.22;
    }
  }
  return out;
}

/** A round, plucked electric bass: a sine with a little growl of upper harmonics and a thumb thump. */
export function bass(midi: number, sampleRate: number, seconds = 2.4): Stereo {
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  const f = midiToFrequency(midi);
  const tone = Biquad.make('lowpass', 900, 0.7, sampleRate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    phase += (f * (1 + 0.04 * Math.exp(-t / 0.012))) / sampleRate;
    const p = 2 * Math.PI * phase;
    const v = Math.sin(p) + 0.3 * Math.sin(2 * p) * Math.exp(-t / 0.4) + 0.12 * Math.sin(3 * p) * Math.exp(-t / 0.25);
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 1.1);
    const s = tone.process(v) * env * 0.42;
    out.left[i] = s;
    out.right[i] = s;
  }
  return out;
}

/** A soft, round kick: a falling sine thump with a tiny click on top. */
export function kick(sampleRate: number): Stereo {
  const out = new Stereo(Math.floor(0.5 * sampleRate), sampleRate);
  let phase = 0;
  const rng = createRng(5);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    phase += (54 + 80 * Math.exp(-t / 0.03)) / sampleRate;
    const click = t < 0.003 ? (rng() * 2 - 1) * (1 - t / 0.003) * 0.25 : 0;
    const s = (Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.17) * Math.min(1, t / 0.0015) + click) * 0.8;
    out.left[i] = s;
    out.right[i] = s;
  }
  return out;
}

/** A dusty snare: a crack of filtered noise over the drum shell's ring. */
export function snare(sampleRate: number, seed = 1): Stereo {
  const out = new Stereo(Math.floor(0.4 * sampleRate), sampleRate);
  const rng = createRng(seed);
  const [gl, gr] = panGains(-0.08);
  addNoiseBurst(out, 0, 0.22, Biquad.make('bandpass', 1900, 0.6, sampleRate), 0.75, -0.08, rng, 0.001);
  addNoiseBurst(out, 0, 0.12, Biquad.make('highpass', 4500, 0.7, sampleRate), 0.35, -0.08, rng, 0.001);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const shell = (Math.sin(2 * Math.PI * 185 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t)) * Math.exp(-t / 0.045) * 0.3;
    out.add(i, shell, gl, gr);
  }
  return out;
}

/** A rim click: the stick's shoulder on the hoop, short and woody. */
export function rim(sampleRate: number): Stereo {
  const out = new Stereo(Math.floor(0.12 * sampleRate), sampleRate);
  const rng = createRng(9);
  addNoiseBurst(out, 0, 0.04, Biquad.make('bandpass', 2400, 4, sampleRate), 1.5, -0.15, rng, 0.0005);
  const [gl, gr] = panGains(-0.15);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    out.add(i, Math.sin(2 * Math.PI * 1150 * t) * Math.exp(-t / 0.012) * 0.5, gl, gr);
  }
  return out;
}

/**
 * A hi-hat: six detuned square waves at the inharmonic ratios of a struck
 * cymbal, high-passed so only the metallic shimmer is left.
 */
export function hat(sampleRate: number, open: boolean): Stereo {
  const seconds = open ? 0.6 : 0.14;
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const hp = Biquad.make('highpass', 5500, 0.7, sampleRate);
  const hp2 = Biquad.make('highpass', 5500, 0.7, sampleRate);
  const decay = open ? 0.17 : 0.022;
  const [gl, gr] = panGains(0.25);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const r of ratios) v += Math.sin(2 * Math.PI * 330 * r * t) > 0 ? 1 : -1;
    const s = hp2.process(hp.process(v / ratios.length)) * Math.exp(-t / decay) * Math.min(1, t / 0.0005);
    out.add(i, s * (open ? 1.6 : 2.4), gl, gr);
  }
  return out;
}

/** A shaker: a soft swish of beads, swelling a moment before it peaks. */
export function shaker(sampleRate: number): Stereo {
  const out = new Stereo(Math.floor(0.12 * sampleRate), sampleRate);
  addNoiseBurst(out, 0, 0.09, Biquad.make('highpass', 6000, 0.7, sampleRate), 1.3, 0.35, createRng(13), 0.02);
  return out;
}

/**
 * A muted, nylon-ish guitar note by Karplus–Strong: a burst of noise
 * circulating in a delay line the length of one period, softened a little
 * on every pass, as a plucked string's highs die first.
 */
export function guitar(midi: number, sampleRate: number, seconds = 2.2): Stereo {
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  // The loop's delay: whole samples, plus half a sample for the averaging,
  // plus an all-pass for the fraction left over, so the pitch is true.
  const period = sampleRate / midiToFrequency(midi);
  const n = Math.max(2, Math.floor(period - 0.5));
  const frac = period - 0.5 - n;
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(n);
  const rng = createRng(midi * 7);
  // A softened pluck: the noise is pre-filtered so the attack isn't harsh.
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.5 * (rng() * 2 - 1 - lp);
    line[i] = lp;
  }
  const damping = 0.994;
  const body = Biquad.make('lowpass', 2600, 0.7, sampleRate);
  const [gl, gr] = panGains(0.2);
  let apIn = 0;
  let apOut = 0;
  let previous = 0;
  let k = 0;
  for (let i = 0; i < out.length; i++) {
    const x = line[k];
    // Averaging with the sample before: the string's gentle high-cut.
    const avg = 0.5 * (x + previous) * damping;
    previous = x;
    const ap = c * avg + apIn - c * apOut;
    apIn = avg;
    apOut = ap;
    line[k] = ap;
    k = (k + 1) % n;
    out.add(i, body.process(x) * Math.min(1, i / (sampleRate * 0.003)) * 0.5, gl, gr);
  }
  return out;
}

/** A soft bell for melodies: a gentle FM chime with a slow vibrato. */
export function bell(midi: number, sampleRate: number, seconds = 2): Stereo {
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  const f = midiToFrequency(midi);
  const [gl, gr] = panGains(0.15);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5 * t) * Math.min(1, t / 0.4);
    const index = 1.2 * Math.exp(-t / 0.3);
    const v = Math.sin(2 * Math.PI * f * vib * t + index * Math.sin(2 * Math.PI * f * 3.5 * t));
    out.add(i, v * Math.min(1, t / 0.004) * Math.exp(-t / 0.7) * 0.22, gl, gr);
  }
  return out;
}

/**
 * A warm pad holding a chord for `seconds`: two slightly detuned saws per
 * note, low-passed, fading in slowly and away again, one voice of each pair
 * leaning left and the other right.
 */
export function pad(notes: readonly number[], seconds: number, sampleRate: number): Stereo {
  const release = 1.4;
  const out = new Stereo(Math.floor((seconds + release) * sampleRate), sampleRate);
  for (const midi of notes) {
    const f = midiToFrequency(midi);
    for (const [detune, pan] of [
      [0.997, -0.5],
      [1.003, 0.5],
    ] as const) {
      const [gl, gr] = panGains(pan);
      const lp = Biquad.make('lowpass', 900, 0.6, sampleRate);
      let phase = Math.random();
      for (let i = 0; i < out.length; i++) {
        const t = i / sampleRate;
        phase += (f * detune) / sampleRate;
        const saw = 2 * (phase - Math.floor(phase)) - 1;
        const env = Math.min(1, t / 0.9) * (t > seconds ? Math.exp(-(t - seconds) / (release / 3)) : 1);
        out.add(i, lp.process(saw) * env * 0.035, gl, gr);
      }
    }
  }
  return out;
}

/**
 * Vinyl surface noise for one side of a record: a faint warm hiss, sparse
 * soft ticks, now and then a louder pop, and the slow once-a-turn thump of
 * a slightly warped disc. Each track gets its own, so it never loops
 * audibly.
 */
export function crackle(seconds: number, sampleRate: number, seed: number): Stereo {
  const out = new Stereo(Math.floor(seconds * sampleRate), sampleRate);
  const rng = createRng(seed);
  const hiss = [Biquad.make('lowpass', 5000, 0.5, sampleRate), Biquad.make('lowpass', 5000, 0.5, sampleRate)];
  const turn = 60 / 33.3;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const wobble = 0.7 + 0.3 * Math.sin((2 * Math.PI * t) / turn);
    out.left[i] = hiss[0].process(rng() * 2 - 1) * 0.012 * wobble;
    out.right[i] = hiss[1].process(rng() * 2 - 1) * 0.012 * wobble;
  }
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - rng()) / 9;
    const pop = rng() < 0.08;
    const level = pop ? 0.25 + rng() * 0.3 : 0.03 + rng() * 0.08;
    const pan = rng() * 1.4 - 0.7;
    addNoiseBurst(out, t, pop ? 0.004 : 0.0015, Biquad.make('highpass', pop ? 1200 : 2500, 0.7, sampleRate), level, pan, rng, 0.0002);
  }
  return out;
}
