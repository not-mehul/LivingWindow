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

export const SYNTH_VOICES = {
  'sparrow-chirp': sparrowChirp,
  'pigeon-coo': pigeonCoo,
  'crow-caw': crowCaw,
  'wing-flap': wingFlap,
  'glass-tap': glassTap,
  'seed-pour': seedPour,
  'window-slide': windowSlide,
  'window-thunk': windowThunk,
  'car-horn': carHorn,
  'cat-meow': catMeow,
  'cat-purr': catPurr,
} satisfies Record<string, SynthVoice>;
