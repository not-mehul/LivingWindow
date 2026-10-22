import type { NoiseBank } from '../noise';
import { rand } from '../../core/random';

/**
 * Synthesized stand-ins for the one-shots that aren't animal calls (those
 * are in calls.ts): foley, weather, the city. Each voice renders into
 * `out` starting at `when`, scaled by `gain`, pitched by `rate`, and
 * returns its duration in seconds. Real recordings listed in the audio
 * manifest replace these automatically.
 */
export type SynthVoice = (
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  gain: number,
  rate: number,
  noise: NoiseBank,
) => number;

/** Attack–decay envelope on a gain param. */
function envelope(param: AudioParam, when: number, attack: number, peak: number, decay: number): void {
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attack);
  param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
}

function tone(ctx: BaseAudioContext, type: OscillatorType, out: AudioNode): [OscillatorNode, GainNode] {
  const osc = ctx.createOscillator();
  osc.type = type;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(amp).connect(out);
  return [osc, amp];
}

/** A short burst of filtered noise. */
function noiseBurst(
  ctx: BaseAudioContext,
  noise: NoiseBank,
  out: AudioNode,
  when: number,
  duration: number,
  filter: { type: BiquadFilterType; frequency: number; Q?: number },
  peak: number,
  attack = 0.002,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise.get('white');
  // The noise loops seamlessly, so a long sound started late in it never cuts out.
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter.type;
  bq.frequency.value = filter.frequency;
  bq.Q.value = filter.Q ?? 1;
  const amp = ctx.createGain();
  envelope(amp.gain, when, attack, peak, Math.max(0.005, duration - attack));
  src.connect(bq).connect(amp).connect(out);
  src.start(when, Math.random() * 5, duration + 0.05);
}

const glassTap: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  noiseBurst(ctx, noise, out, when, 0.012, { type: 'bandpass', frequency: rand(2500, 6000) * rate, Q: 3 }, 0.5 * gain);
  const [osc, amp] = tone(ctx, 'sine', out);
  osc.frequency.value = rand(2400, 5200) * rate;
  envelope(amp.gain, when, 0.001, 0.05 * gain, 0.02);
  osc.start(when);
  osc.stop(when + 0.04);
  return 0.04;
};

const seedPour: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const duration = 0.7;
  // Seeds rattle into the bowl: a dense patter that thins out, over a soft hiss.
  for (let i = 0; i < 46; i++) {
    const t = when + duration * Math.random() ** 1.6;
    noiseBurst(ctx, noise, out, t, 0.004, { type: 'highpass', frequency: 2500 * rate }, rand(0.08, 0.3) * gain);
  }
  noiseBurst(ctx, noise, out, when, duration, { type: 'bandpass', frequency: 3200 * rate, Q: 0.7 }, 0.06 * gain, 0.08);
  return duration;
};

const windowThunk: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const [osc, amp] = tone(ctx, 'sine', out);
  osc.frequency.setValueAtTime(120 * rate, when);
  osc.frequency.exponentialRampToValueAtTime(60 * rate, when + 0.15);
  envelope(amp.gain, when, 0.003, 0.55 * gain, 0.18);
  osc.start(when);
  osc.stop(when + 0.25);
  noiseBurst(ctx, noise, out, when, 0.05, { type: 'lowpass', frequency: 900 }, 0.3 * gain);
  return 0.25;
};

/** A car horn a few streets down: a short, soft two-tone blare through the horn's brassy resonance. */
const carHorn: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(0.25, 0.5);
  const bell = ctx.createBiquadFilter();
  bell.type = 'bandpass';
  bell.frequency.value = 1100;
  bell.Q.value = 1.2;
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 2200;
  bell.connect(soften).connect(out);
  for (const f of [392, 494]) {
    const [osc, amp] = tone(ctx, 'sawtooth', bell);
    osc.frequency.value = f * rate;
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(0.09 * gain, when + 0.03);
    amp.gain.setValueAtTime(0.09 * gain, when + length);
    amp.gain.linearRampToValueAtTime(0, when + length + 0.08);
    osc.start(when);
    osc.stop(when + length + 0.12);
  }
  return length + 0.12;
};

/** Chords the busker cycles through (semitones above the root). */
const CHORDS = [
  [0, 7, 12, 16, 19],
  [5, 12, 17, 21, 24],
  [7, 14, 19, 23, 26],
  [-3, 4, 9, 12, 16],
];
let chord = 0;

const guitarStrum: SynthVoice = (ctx, out, when, gain, rate) => {
  // A plucked chord, strummed down the strings: bright attack, warm decay.
  const notes = CHORDS[chord++ % CHORDS.length];
  const root = 110 * rate;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(3200, when);
  tone.frequency.exponentialRampToValueAtTime(900, when + 1.2);
  tone.connect(out);
  notes.forEach((semi, i) => {
    const t = when + i * rand(0.012, 0.022);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = root * 2 ** (semi / 12);
    const amp = ctx.createGain();
    envelope(amp.gain, t, 0.003, (0.12 * gain) / (1 + i * 0.15), rand(1.2, 1.8));
    osc.connect(amp).connect(tone);
    osc.start(t);
    osc.stop(t + 2);
  });
  return 2;
};

/** A coconut hitting the sand: a dull, hollow thump, a softer one as it bounces, and a hiss of sand. */
const coconutThud: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  let t = when;
  for (const [peak, gap] of [
    [0.6, 0.32],
    [0.22, 0.2],
  ]) {
    const [osc, amp] = tone(ctx, 'sine', out);
    osc.frequency.setValueAtTime(150 * rate, t);
    osc.frequency.exponentialRampToValueAtTime(62 * rate, t + 0.12);
    envelope(amp.gain, t, 0.004, peak * gain, 0.16);
    osc.start(t);
    osc.stop(t + 0.22);
    // The husk's hollow knock.
    noiseBurst(ctx, noise, out, t, 0.06, { type: 'bandpass', frequency: 420 * rate, Q: 4 }, peak * 0.5 * gain);
    noiseBurst(ctx, noise, out, t + 0.01, 0.12, { type: 'highpass', frequency: 3000 }, peak * 0.08 * gain);
    t += gap;
  }
  return t - when + 0.2;
};


/** A bumblebee drifting past: a low, wavering hum that swells and fades away. */
const beeBuzz: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(2.2, 3.8);
  const f = rand(140, 190) * rate;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f * 1.03, when);
  osc.frequency.linearRampToValueAtTime(f * 0.97, when + length);
  // Wingbeats never hold perfectly steady.
  const wobble = ctx.createOscillator();
  wobble.frequency.value = rand(5, 9);
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = f * 0.025;
  wobble.connect(wobbleDepth).connect(osc.frequency);
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 1500;
  body.Q.value = 0.7;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.06 * gain, when + length * 0.4);
  amp.gain.linearRampToValueAtTime(0.045 * gain, when + length * 0.6);
  amp.gain.linearRampToValueAtTime(0, when + length);
  osc.connect(body).connect(amp).connect(out);
  osc.start(when);
  wobble.start(when);
  osc.stop(when + length + 0.05);
  wobble.stop(when + length + 0.05);
  return length;
};

/** A siren many streets away: a slow wail, softened by distance and walls. */
const sirenFar: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(5, 6.5);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const low = 620 * rate;
  const high = 1150 * rate;
  const cycle = rand(1.6, 2.2);
  osc.frequency.setValueAtTime(low, when);
  for (let t = 0; t < length; t += cycle) {
    osc.frequency.linearRampToValueAtTime(high, when + t + cycle * 0.45);
    osc.frequency.linearRampToValueAtTime(low, when + t + cycle);
  }
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1600;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.06 * gain, when + 1.5);
  amp.gain.setValueAtTime(0.06 * gain, when + length - 2);
  amp.gain.linearRampToValueAtTime(0, when + length);
  osc.connect(lowpass).connect(amp).connect(out);
  osc.start(when);
  osc.stop(when + length + 0.05);
  return length;
};

export const SYNTH_VOICES = {
  'bee-buzz': beeBuzz,
  'siren-far': sirenFar,
  'coconut-thud': coconutThud,
  'glass-tap': glassTap,
  'seed-pour': seedPour,
  'window-thunk': windowThunk,
  'car-horn': carHorn,
  'guitar-strum': guitarStrum,
} satisfies Record<string, SynthVoice>;
