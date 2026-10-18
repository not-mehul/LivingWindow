import type { NoiseBank } from '../noise';

/**
 * Synthesized stand-ins for every one-shot sound. Each voice renders into
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

const rand = (min: number, max: number) => min + Math.random() * (max - min);

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
  const bq = ctx.createBiquadFilter();
  bq.type = filter.type;
  bq.frequency.value = filter.frequency;
  bq.Q.value = filter.Q ?? 1;
  const amp = ctx.createGain();
  envelope(amp.gain, when, attack, peak, Math.max(0.005, duration - attack));
  src.connect(bq).connect(amp).connect(out);
  src.start(when, Math.random() * 5, duration + 0.05);
}

const sparrowChirp: SynthVoice = (ctx, out, when, gain, rate) => {
  const chirps = 2 + Math.floor(Math.random() * 4);
  let t = when;
  for (let i = 0; i < chirps; i++) {
    const [osc, amp] = tone(ctx, 'sine', out);
    const length = rand(0.035, 0.07);
    const base = rand(3600, 5200) * rate;
    // Each chirp is a fast down-up sweep, like a sparrow's "chip".
    osc.frequency.setValueAtTime(base * 1.25, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + length * 0.6);
    osc.frequency.exponentialRampToValueAtTime(base * 1.05, t + length);
    envelope(amp.gain, t, 0.004, 0.22 * gain, length);
    osc.start(t);
    osc.stop(t + length + 0.02);
    t += length + rand(0.05, 0.12);
  }
  return t - when;
};

const pigeonCoo: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const notes = [0.16, 0.16, 0.5];
  let t = when;
  for (const [i, length] of notes.entries()) {
    const [osc, amp] = tone(ctx, 'sine', out);
    const f = rand(290, 340) * rate * (i === 2 ? 0.94 : 1);
    osc.frequency.setValueAtTime(f * 0.92, t);
    osc.frequency.linearRampToValueAtTime(f, t + length * 0.3);
    osc.frequency.linearRampToValueAtTime(f * 0.85, t + length);
    // Throaty flutter.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const depth = ctx.createGain();
    depth.gain.value = 0.1 * gain;
    lfo.connect(depth).connect(amp.gain);
    envelope(amp.gain, t, 0.03, 0.3 * gain, length);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + length + 0.05);
    lfo.stop(t + length + 0.05);
    noiseBurst(ctx, noise, out, t, length, { type: 'lowpass', frequency: 600 }, 0.05 * gain, 0.03);
    t += length + 0.08;
  }
  return t - when;
};

const crowCaw: SynthVoice = (ctx, out, when, gain, rate) => {
  const caws = 1 + Math.floor(Math.random() * 3);
  let t = when;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 3);
  shaper.curve = curve;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1300;
  band.Q.value = 1.6;
  shaper.connect(band).connect(out);
  for (let i = 0; i < caws; i++) {
    const [osc, amp] = tone(ctx, 'sawtooth', shaper);
    const length = rand(0.22, 0.32);
    const f = rand(560, 640) * rate;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.72, t + length);
    envelope(amp.gain, t, 0.02, 0.35 * gain, length);
    osc.start(t);
    osc.stop(t + length + 0.05);
    t += length + rand(0.12, 0.2);
  }
  return t - when;
};

const wingFlap: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const flaps = 5 + Math.floor(Math.random() * 5);
  const interval = 1 / (rand(11, 15) * rate);
  for (let i = 0; i < flaps; i++) {
    const fade = 1 - i / flaps;
    noiseBurst(ctx, noise, out, when + i * interval, interval * 0.7, { type: 'bandpass', frequency: 700 * rate, Q: 0.8 }, 0.35 * gain * fade, 0.01);
  }
  return flaps * interval;
};

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

const windowSlide: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const duration = 0.6;
  const src = ctx.createBufferSource();
  src.buffer = noise.get('pink');
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 2;
  band.frequency.setValueAtTime(320 * rate, when);
  band.frequency.linearRampToValueAtTime(520 * rate, when + duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  // Stick-slip friction of wood on wood: an uneven, juddering level.
  for (let t = 0; t < duration; t += 0.03) {
    amp.gain.linearRampToValueAtTime(gain * rand(0.15, 0.45), when + t);
  }
  amp.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(band).connect(amp).connect(out);
  src.start(when, Math.random() * 5, duration + 0.05);
  return duration;
};

/** Iron hinges turning: a dry, rising squeal with a woody groan underneath. */
const windowCreak: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const duration = 0.9;
  // The squeal: a sawtooth whose pitch wanders as the hinge sticks and slips.
  const [osc, amp] = tone(ctx, 'sawtooth', out);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 6;
  band.frequency.value = 1400 * rate;
  osc.disconnect();
  osc.connect(band).connect(amp);
  const start = rand(520, 640) * rate;
  osc.frequency.setValueAtTime(start, when);
  for (let t = 0.06; t < duration; t += 0.06) {
    osc.frequency.linearRampToValueAtTime(start * (1 + t * 0.5) * rand(0.94, 1.06), when + t);
  }
  amp.gain.setValueAtTime(0, when);
  for (let t = 0.03; t < duration; t += 0.045) {
    amp.gain.linearRampToValueAtTime(gain * 0.09 * rand(0.2, 1), when + t);
  }
  amp.gain.linearRampToValueAtTime(0, when + duration);
  osc.start(when);
  osc.stop(when + duration + 0.05);
  // Wood flexing against wood.
  const src = ctx.createBufferSource();
  src.buffer = noise.get('brown');
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 380 * rate;
  const groan = ctx.createGain();
  groan.gain.setValueAtTime(0, when);
  groan.gain.linearRampToValueAtTime(gain * 0.35, when + 0.2);
  groan.gain.linearRampToValueAtTime(0, when + duration);
  src.connect(low).connect(groan).connect(out);
  src.start(when, Math.random() * 5, duration + 0.05);
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

const carHorn: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(0.25, 0.6);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.connect(out);
  for (const f of [392, 494]) {
    const [osc, amp] = tone(ctx, 'square', filter);
    osc.frequency.value = f * rate;
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(0.06 * gain, when + 0.02);
    amp.gain.setValueAtTime(0.06 * gain, when + length);
    amp.gain.linearRampToValueAtTime(0, when + length + 0.05);
    osc.start(when);
    osc.stop(when + length + 0.1);
  }
  return length + 0.1;
};

const catMeow: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(0.45, 0.7);
  // A voiced "mee-ow": a buzzy tone through a vowel-like formant that opens and closes.
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.Q.value = 4;
  formant.frequency.setValueAtTime(900, when);
  formant.frequency.linearRampToValueAtTime(1600, when + length * 0.35);
  formant.frequency.linearRampToValueAtTime(700, when + length);
  formant.connect(out);
  const [osc, amp] = tone(ctx, 'sawtooth', formant);
  const f = rand(480, 620) * rate;
  osc.frequency.setValueAtTime(f * 0.9, when);
  osc.frequency.linearRampToValueAtTime(f * 1.25, when + length * 0.35);
  osc.frequency.linearRampToValueAtTime(f * 0.8, when + length);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.35 * gain, when + 0.05);
  amp.gain.setValueAtTime(0.35 * gain, when + length * 0.7);
  amp.gain.linearRampToValueAtTime(0, when + length);
  osc.start(when);
  osc.stop(when + length + 0.05);
  return length;
};

const catPurr: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const length = rand(1.6, 2.4);
  const src = ctx.createBufferSource();
  src.buffer = noise.get('brown');
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 320 * rate;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  // ~25 Hz rumble from an amplitude-modulated low noise.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 24 * rate;
  const depth = ctx.createGain();
  depth.gain.value = 0.35 * gain;
  lfo.connect(depth).connect(amp.gain);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(1, when + 0.3);
  env.gain.setValueAtTime(1, when + length - 0.4);
  env.gain.linearRampToValueAtTime(0, when + length);
  src.connect(lowpass).connect(amp).connect(env).connect(out);
  src.start(when, Math.random() * 5, length + 0.1);
  lfo.start(when);
  lfo.stop(when + length + 0.1);
  return length;
};

/** A pure, enveloped tone with an optional pitch glide. */
function blip(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  length: number,
  from: number,
  to: number,
  peak: number,
  type: OscillatorType = 'sine',
): void {
  const [osc, amp] = tone(ctx, type, out);
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + length);
  envelope(amp.gain, when, Math.min(0.01, length / 4), peak, length);
  osc.start(when);
  osc.stop(when + length + 0.03);
}

/** Harsh calls (jays, gulls) through a resonant band. */
function harsh(ctx: BaseAudioContext, out: AudioNode, center: number, q = 2): BiquadFilterNode {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = center;
  band.Q.value = q;
  band.connect(out);
  return band;
}

const woodpeckerDrum: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const knocks = 12 + Math.floor(Math.random() * 10);
  const interval = 1 / (rand(16, 22) * rate);
  for (let i = 0; i < knocks; i++) {
    const fade = 1 - (i / knocks) * 0.6;
    noiseBurst(ctx, noise, out, when + i * interval, 0.025, { type: 'bandpass', frequency: 1100 * rate, Q: 2.5 }, 0.5 * gain * fade);
  }
  return knocks * interval + 0.05;
};

const jayCall: SynthVoice = (ctx, out, when, gain, rate) => {
  const band = harsh(ctx, out, 2400 * rate, 1.5);
  const calls = 2 + Math.floor(Math.random() * 2);
  let t = when;
  for (let i = 0; i < calls; i++) {
    blip(ctx, band, t, 0.22, 2400 * rate, 1700 * rate, 0.25 * gain, 'sawtooth');
    t += 0.3;
  }
  return t - when;
};

const chickadeeCall: SynthVoice = (ctx, out, when, gain, rate) => {
  let t = when;
  blip(ctx, out, t, 0.07, 6200 * rate, 5200 * rate, 0.18 * gain);
  t += 0.1;
  blip(ctx, out, t, 0.06, 5600 * rate, 4800 * rate, 0.16 * gain);
  t += 0.12;
  // The buzzy "dee-dee-dee".
  const dees = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < dees; i++) {
    blip(ctx, out, t, 0.14, 3900 * rate, 3700 * rate, 0.12 * gain, 'square');
    t += 0.18;
  }
  return t - when;
};

const finchSong: SynthVoice = (ctx, out, when, gain, rate) => {
  const notes = 8 + Math.floor(Math.random() * 7);
  let t = when;
  for (let i = 0; i < notes; i++) {
    const f = rand(2600, 5200) * rate;
    const length = rand(0.04, 0.09);
    blip(ctx, out, t, length, f, f * rand(0.75, 1.3), 0.15 * gain);
    t += length + rand(0.01, 0.05);
  }
  return t - when;
};

const bluebirdSong: SynthVoice = (ctx, out, when, gain, rate) => {
  const phrases = 3 + Math.floor(Math.random() * 3);
  let t = when;
  for (let i = 0; i < phrases; i++) {
    const [osc, amp] = tone(ctx, 'sine', out);
    const f = rand(1800, 2700) * rate;
    const length = rand(0.18, 0.3);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * rand(0.85, 1.2), t + length);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 24;
    const depth = ctx.createGain();
    depth.gain.value = f * 0.04;
    lfo.connect(depth).connect(osc.frequency);
    envelope(amp.gain, t, 0.02, 0.16 * gain, length);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + length + 0.05);
    lfo.stop(t + length + 0.05);
    t += length + rand(0.05, 0.12);
  }
  return t - when;
};

const robinSong: SynthVoice = (ctx, out, when, gain, rate) => {
  const phrases = 4 + Math.floor(Math.random() * 3);
  let t = when;
  for (let i = 0; i < phrases; i++) {
    const hi = rand(2600, 3300) * rate;
    const lo = hi * rand(0.68, 0.82);
    const up = Math.random() < 0.5;
    blip(ctx, out, t, 0.11, up ? lo : hi, up ? hi : lo, 0.16 * gain);
    blip(ctx, out, t + 0.12, 0.1, up ? hi : lo, up ? lo : hi, 0.14 * gain);
    t += 0.3 + rand(0.02, 0.12);
  }
  return t - when;
};

const gullCry: SynthVoice = (ctx, out, when, gain, rate) => {
  const band = harsh(ctx, out, 1500 * rate, 1.8);
  const calls = 2 + Math.floor(Math.random() * 3);
  let t = when;
  for (let i = 0; i < calls; i++) {
    const f = rand(900, 1050) * rate * (1 - i * 0.05);
    const [osc, amp] = tone(ctx, 'sawtooth', band);
    const length = i === 0 ? 0.5 : 0.28;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.linearRampToValueAtTime(f * 1.45, t + length * 0.3);
    osc.frequency.linearRampToValueAtTime(f * 0.8, t + length);
    envelope(amp.gain, t, 0.03, 0.22 * gain, length);
    osc.start(t);
    osc.stop(t + length + 0.05);
    t += length + 0.08;
  }
  return t - when;
};

const sandpiperPeep: SynthVoice = (ctx, out, when, gain, rate) => {
  const peeps = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < peeps; i++) blip(ctx, out, when + i * 0.13, 0.06, 5200 * rate, 4600 * rate, 0.14 * gain);
  return peeps * 0.13;
};

const owlHoot: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  const notes: Array<[number, number]> = [
    [0, 0.28],
    [0.42, 0.18],
    [0.66, 0.7],
  ];
  for (const [at, length] of notes) {
    const t = when + at;
    const [osc, amp] = tone(ctx, 'sine', out);
    osc.frequency.setValueAtTime(390 * rate, t);
    osc.frequency.linearRampToValueAtTime(350 * rate, t + length);
    envelope(amp.gain, t, 0.05, 0.3 * gain, length);
    osc.start(t);
    osc.stop(t + length + 0.08);
    noiseBurst(ctx, noise, out, t, length, { type: 'lowpass', frequency: 500 }, 0.03 * gain, 0.05);
  }
  return 1.45;
};

const eagleCry: SynthVoice = (ctx, out, when, gain, rate) => {
  const notes = 6 + Math.floor(Math.random() * 4);
  let t = when;
  for (let i = 0; i < notes; i++) {
    const f = (3600 - i * 120) * rate;
    blip(ctx, out, t, 0.07, f, f * 0.9, 0.12 * gain);
    t += 0.09;
  }
  return t - when;
};

const squirrelChatter: SynthVoice = (ctx, out, when, gain, rate) => {
  const chirps = 8 + Math.floor(Math.random() * 10);
  for (let i = 0; i < chirps; i++) {
    blip(ctx, out, when + i * 0.055, 0.035, rand(3200, 4600) * rate, rand(2400, 3200) * rate, 0.12 * gain, 'square');
  }
  return chirps * 0.055;
};

const deerSnort: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  noiseBurst(ctx, noise, out, when, 0.3, { type: 'bandpass', frequency: 700 * rate, Q: 1.2 }, 0.4 * gain, 0.02);
  return 0.32;
};

const cowMoo: SynthVoice = (ctx, out, when, gain, rate) => {
  const length = rand(1, 1.6);
  const formant = ctx.createBiquadFilter();
  formant.type = 'lowpass';
  formant.Q.value = 6;
  formant.frequency.setValueAtTime(300, when);
  formant.frequency.linearRampToValueAtTime(900, when + length * 0.4);
  formant.frequency.linearRampToValueAtTime(400, when + length);
  formant.connect(out);
  const [osc, amp] = tone(ctx, 'sawtooth', formant);
  const f = rand(105, 135) * rate;
  osc.frequency.setValueAtTime(f, when);
  osc.frequency.linearRampToValueAtTime(f * 1.15, when + length * 0.3);
  osc.frequency.linearRampToValueAtTime(f * 0.85, when + length);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.4 * gain, when + 0.15);
  amp.gain.setValueAtTime(0.4 * gain, when + length * 0.75);
  amp.gain.linearRampToValueAtTime(0, when + length);
  osc.start(when);
  osc.stop(when + length + 0.05);
  return length;
};

const chickenCluck: SynthVoice = (ctx, out, when, gain, rate) => {
  const band = harsh(ctx, out, 900 * rate, 3);
  const clucks = 2 + Math.floor(Math.random() * 4);
  let t = when;
  for (let i = 0; i < clucks; i++) {
    blip(ctx, band, t, 0.06, 420 * rate, 300 * rate, 0.35 * gain, 'square');
    t += rand(0.12, 0.22);
  }
  return t - when;
};

const splash: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  noiseBurst(ctx, noise, out, when, 0.45, { type: 'highpass', frequency: 1200 * rate }, 0.4 * gain, 0.005);
  noiseBurst(ctx, noise, out, when, 0.2, { type: 'lowpass', frequency: 500 }, 0.3 * gain, 0.003);
  return 0.5;
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

const fireworkPop: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  // The boom of the burst, rolling off between the buildings, then a crackle of sparks.
  noiseBurst(ctx, noise, out, when, 0.9, { type: 'lowpass', frequency: 220 * rate, Q: 0.8 }, 0.75 * gain, 0.004);
  noiseBurst(ctx, noise, out, when, 0.25, { type: 'bandpass', frequency: 700 * rate, Q: 1 }, 0.3 * gain, 0.002);
  const crackles = 6 + Math.floor(Math.random() * 10);
  for (let i = 0; i < crackles; i++) {
    noiseBurst(ctx, noise, out, when + rand(0.35, 1.4), 0.03, { type: 'highpass', frequency: 2600 }, rand(0.04, 0.12) * gain, 0.001);
  }
  return 1.6;
};

const foxBark: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  // A fox's hoarse "wow-wow": two or three harsh, rising-falling yelps.
  const yelps = 2 + Math.floor(Math.random() * 2);
  let t = when;
  for (let i = 0; i < yelps; i++) {
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.value = 1400 * rate;
    band.connect(out);
    const [osc, amp] = tone(ctx, 'sawtooth', band);
    const f = rand(520, 640) * rate;
    const length = rand(0.14, 0.2);
    osc.frequency.setValueAtTime(f * 0.8, t);
    osc.frequency.linearRampToValueAtTime(f * 1.25, t + length * 0.35);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + length);
    envelope(amp.gain, t, 0.01, 0.28 * gain, length);
    osc.start(t);
    osc.stop(t + length + 0.05);
    noiseBurst(ctx, noise, band, t, length * 0.8, { type: 'highpass', frequency: 900 }, 0.08 * gain, 0.005);
    t += length + rand(0.18, 0.32);
  }
  return t - when;
};

const sheepBaa: SynthVoice = (ctx, out, when, gain, rate) => {
  // A wavering "baa": a reedy tone with a fast bleating tremolo, nasal formant.
  const length = rand(0.55, 0.9);
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.Q.value = 2.5;
  formant.frequency.setValueAtTime(900 * rate, when);
  formant.frequency.linearRampToValueAtTime(1300 * rate, when + length * 0.3);
  formant.connect(out);
  const [osc, amp] = tone(ctx, 'sawtooth', formant);
  const f = rand(280, 360) * rate;
  osc.frequency.setValueAtTime(f, when);
  osc.frequency.linearRampToValueAtTime(f * 1.08, when + length * 0.25);
  osc.frequency.linearRampToValueAtTime(f * 0.9, when + length);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rand(14, 19);
  const depth = ctx.createGain();
  depth.gain.value = 0.18 * gain;
  lfo.connect(depth).connect(amp.gain);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(0.32 * gain, when + 0.05);
  amp.gain.setValueAtTime(0.32 * gain, when + length * 0.7);
  amp.gain.linearRampToValueAtTime(0, when + length);
  osc.start(when);
  lfo.start(when);
  osc.stop(when + length + 0.05);
  lfo.stop(when + length + 0.05);
  return length;
};

const horseWhinny: SynthVoice = (ctx, out, when, gain, rate, noise) => {
  // A whinny: a high, quavering cry tumbling down, ending in a snort.
  const length = rand(1, 1.4);
  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.Q.value = 1.8;
  formant.frequency.setValueAtTime(1600 * rate, when);
  formant.frequency.linearRampToValueAtTime(700 * rate, when + length);
  formant.connect(out);
  const [osc, amp] = tone(ctx, 'sawtooth', formant);
  const f = rand(900, 1100) * rate;
  osc.frequency.setValueAtTime(f, when);
  osc.frequency.exponentialRampToValueAtTime(f * 0.35, when + length);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rand(9, 12);
  const depth = ctx.createGain();
  depth.gain.value = f * 0.06;
  lfo.connect(depth).connect(osc.frequency);
  envelope(amp.gain, when, 0.06, 0.24 * gain, length);
  osc.start(when);
  lfo.start(when);
  osc.stop(when + length + 0.05);
  lfo.stop(when + length + 0.05);
  noiseBurst(ctx, noise, out, when + length * 0.95, 0.3, { type: 'bandpass', frequency: 500, Q: 0.8 }, 0.35 * gain, 0.01);
  return length + 0.35;
};

export const SYNTH_VOICES = {
  'sparrow-chirp': sparrowChirp,
  'pigeon-coo': pigeonCoo,
  'crow-caw': crowCaw,
  'wing-flap': wingFlap,
  'glass-tap': glassTap,
  'seed-pour': seedPour,
  'window-slide': windowSlide,
  'window-thunk': windowThunk,
  'window-creak': windowCreak,
  'car-horn': carHorn,
  'cat-meow': catMeow,
  'cat-purr': catPurr,
  'woodpecker-drum': woodpeckerDrum,
  'jay-call': jayCall,
  'chickadee-call': chickadeeCall,
  'finch-song': finchSong,
  'bluebird-song': bluebirdSong,
  'robin-song': robinSong,
  'gull-cry': gullCry,
  'sandpiper-peep': sandpiperPeep,
  'owl-hoot': owlHoot,
  'eagle-cry': eagleCry,
  'squirrel-chatter': squirrelChatter,
  'deer-snort': deerSnort,
  'cow-moo': cowMoo,
  'chicken-cluck': chickenCluck,
  'guitar-strum': guitarStrum,
  'firework-pop': fireworkPop,
  'fox-bark': foxBark,
  'sheep-baa': sheepBaa,
  'horse-whinny': horseWhinny,
  splash,
} satisfies Record<string, SynthVoice>;
