import { addNoiseBurst, Biquad, panGains, type Stereo } from '../synth';

/*
 * Animal calls, synthesized sample by sample. Birdsong is built from
 * syllables: a tone (with harmonics for harsher voices) following a pitch
 * contour, shaped by an envelope, with vibrato for warbles, amplitude
 * modulation for buzzy notes, and optionally a breathy noise component.
 * Mammal calls pass a harmonic-rich voice through vowel-like formants that
 * open and close. Each species gets patterns, not single beeps: phrases,
 * repetitions and pauses, varied on every take.
 */

/** Render a call into `out` (mono, centred); returns its length in seconds. */
export type CallVoice = (out: Stereo, rng: () => number) => number;

/** A pitch contour: [position 0..1 through the syllable, Hz]. */
type Contour = ReadonlyArray<readonly [number, number]>;

interface Syllable {
  length: number;
  pitch: Contour;
  /** Envelope over the syllable (u: 0..1). */
  amp?: (u: number) => number;
  /** Pitch vibrato: rate (Hz), depth (fraction). */
  vibrato?: readonly [number, number];
  /** Buzz: amplitude modulation rate (Hz), depth 0..1. */
  buzz?: readonly [number, number];
  /** Relative levels of harmonics 2, 3, 4… */
  harmonics?: readonly number[];
  /** Breath noise mixed in, relative to the tone. */
  breath?: number;
  /** Formant bands the voice passes through: [Hz, Q, gain]; and optionally a glide to second values. */
  formants?: ReadonlyArray<readonly [number, number, number]>;
  formantsTo?: ReadonlyArray<readonly [number, number, number]>;
}

const arc = (u: number) => Math.sin(Math.PI * u) ** 0.7;
const sharp = (u: number) => Math.min(1, u * 25) * (1 - u) ** 1.4;
const swell = (attack: number, release: number) => (u: number) => Math.min(1, u / attack, (1 - u) / release);

/** Pitch at `u` along a contour: log-frequency interpolation, eased per segment. */
function contourAt(contour: Contour, u: number): number {
  if (u <= contour[0][0]) return contour[0][1];
  for (let i = 1; i < contour.length; i++) {
    const [u1, f1] = contour[i];
    if (u <= u1) {
      const [u0, f0] = contour[i - 1];
      const x = (u - u0) / Math.max(1e-6, u1 - u0);
      const e = (1 - Math.cos(Math.PI * x)) / 2;
      return f0 * (f1 / f0) ** e;
    }
  }
  return contour[contour.length - 1][1];
}

/** Sing one syllable at `t` (s). */
function sing(out: Stereo, t: number, s: Syllable, peak: number, rng: () => number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(s.length * sr);
  const env = s.amp ?? arc;
  const harmonics = s.harmonics ?? [];
  const formants = s.formants?.map(([f, q]) => ({ f, q, filter: Biquad.make('bandpass', f, q, sr) }));
  const breath = s.breath ? Biquad.make('bandpass', contourAt(s.pitch, 0.5), 1.2, sr) : null;
  const [gl, gr] = panGains(0);
  // Formant glides are retuned every millisecond rather than every sample.
  const block = Math.round(sr * 0.001);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const time = i / sr;
    if (formants && s.formantsTo && i % block === 0) {
      formants.forEach((band, k) => {
        const [f1, q1] = s.formantsTo![k];
        band.filter.tune('bandpass', band.f * (f1 / band.f) ** u, band.q + (q1 - band.q) * u);
      });
    }
    let f = contourAt(s.pitch, u);
    if (s.vibrato) f *= 1 + s.vibrato[1] * Math.sin(2 * Math.PI * s.vibrato[0] * time);
    phase += f / sr;
    const p = 2 * Math.PI * phase;
    let v = Math.sin(p);
    for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(p * (h + 2));
    if (breath && s.breath) v += breath.process(rng() * 2 - 1) * s.breath * 4;
    if (formants) {
      let y = 0;
      for (let k = 0; k < formants.length; k++) y += formants[k].filter.process(v) * s.formants![k][2];
      v = y;
    }
    let a = env(u);
    if (s.buzz) a *= 1 - s.buzz[1] * (0.5 + 0.5 * Math.sin(2 * Math.PI * s.buzz[0] * time));
    out.add(start + i, v * a * peak, gl, gr);
  }
}

const r = (rng: () => number, a: number, b: number) => a + (b - a) * rng();

// --- Songbirds ---------------------------------------------------------------

/** House sparrow: a run of bright "chirp, cheep" notes, each a quick swoop. */
const sparrow: CallVoice = (out, rng) => {
  const notes = 2 + Math.floor(rng() * 5);
  let t = 0;
  const base = r(rng, 3300, 4200);
  for (let i = 0; i < notes; i++) {
    const f = base * r(rng, 0.9, 1.12);
    const length = r(rng, 0.06, 0.11);
    sing(out, t, { length, pitch: [[0, f * 0.8], [0.35, f * 1.25], [1, f * 0.9]], amp: sharp, harmonics: [0.25, 0.08], breath: 0.03 }, 0.5, rng);
    t += length + r(rng, 0.12, 0.32);
  }
  return t;
};

/** Robin: caroling phrases of rising-falling whistles, "cheerily, cheer-up", with pauses between. */
const robin: CallVoice = (out, rng) => {
  const phrases = 3 + Math.floor(rng() * 3);
  let t = 0;
  for (let p = 0; p < phrases; p++) {
    const syllables = 2 + Math.floor(rng() * 3);
    const top = r(rng, 2600, 3500);
    for (let s = 0; s < syllables; s++) {
      const length = r(rng, 0.11, 0.18);
      const hi = top * r(rng, 0.92, 1.05);
      const lo = hi * r(rng, 0.68, 0.8);
      const contour: Contour = rng() < 0.6 ? [[0, lo], [0.45, hi], [1, lo * 1.05]] : [[0, hi], [0.6, lo], [1, lo * 1.1]];
      sing(out, t, { length, pitch: contour, vibrato: [r(rng, 30, 50), 0.012], harmonics: [0.06] }, 0.45, rng);
      t += length + r(rng, 0.03, 0.07);
    }
    t += r(rng, 0.35, 0.7);
  }
  return t;
};

/** Chickadee: either the sweet two-note "fee-bee" whistle or the scolding "chick-a-dee-dee-dee". */
const chickadee: CallVoice = (out, rng) => {
  if (rng() < 0.45) {
    const f = r(rng, 3700, 4100);
    sing(out, 0, { length: 0.32, pitch: [[0, f], [1, f * 0.98]], amp: swell(0.15, 0.25) }, 0.4, rng);
    sing(out, 0.42, { length: 0.34, pitch: [[0, f * 0.87], [0.2, f * 0.84], [1, f * 0.83]], amp: swell(0.1, 0.3) }, 0.36, rng);
    return 0.8;
  }
  let t = 0;
  for (let i = 0; i < 2; i++) {
    sing(out, t, { length: 0.05, pitch: [[0, 7200], [1, 5400]], amp: sharp, harmonics: [0.1] }, 0.35, rng);
    t += 0.08;
  }
  const dees = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < dees; i++) {
    sing(out, t, { length: 0.16, pitch: [[0, 3700], [1, 3550]], buzz: [r(rng, 140, 180), 0.8], harmonics: [0.35, 0.2, 0.1], breath: 0.05 }, 0.3, rng);
    t += 0.2;
  }
  return t;
};

/** Finch: a long, quick, jumbled warble of varied notes, sometimes ending in a buzz. */
const finch: CallVoice = (out, rng) => {
  const notes = 10 + Math.floor(rng() * 14);
  let t = 0;
  const centre = r(rng, 3000, 4200);
  for (let i = 0; i < notes; i++) {
    const length = r(rng, 0.035, 0.09);
    const a = centre * r(rng, 0.7, 1.4);
    const b = a * r(rng, 0.7, 1.4);
    sing(out, t, { length, pitch: [[0, a], [1, b]], amp: arc, harmonics: [0.1], vibrato: rng() < 0.3 ? [60, 0.03] : undefined }, 0.4, rng);
    t += length + r(rng, 0.01, 0.04);
  }
  if (rng() < 0.4) {
    sing(out, t + 0.03, { length: 0.25, pitch: [[0, centre * 0.9], [1, centre * 0.8]], buzz: [90, 0.85], harmonics: [0.3, 0.2] }, 0.3, rng);
    t += 0.3;
  }
  return t;
};

/** Bluebird: soft, low, burbling whistles, "tu-a-wee", each with a gentle warble. */
const bluebird: CallVoice = (out, rng) => {
  const notes = 3 + Math.floor(rng() * 3);
  let t = 0;
  for (let i = 0; i < notes; i++) {
    const f = r(rng, 1800, 2700);
    const length = r(rng, 0.16, 0.28);
    sing(out, t, { length, pitch: [[0, f], [0.5, f * r(rng, 1.05, 1.2)], [1, f * r(rng, 0.85, 1)]], vibrato: [r(rng, 18, 26), 0.03], amp: arc }, 0.4, rng);
    t += length + r(rng, 0.05, 0.12);
  }
  return t;
};

/** Pigeon: a soft, throaty "croo-oo-oo", the last note longest, rising then falling. */
const pigeon: CallVoice = (out, rng) => {
  const f = r(rng, 260, 330);
  const notes: Array<[number, number]> = [
    [0.18, 1],
    [0.16, 1.04],
    [0.55, 0.96],
  ];
  let t = 0;
  for (const [length, k] of notes) {
    sing(
      out,
      t,
      {
        length,
        pitch: [[0, f * k * 0.9], [0.3, f * k * 1.06], [1, f * k * 0.86]],
        amp: swell(0.25, 0.4),
        harmonics: [0.5, 0.2],
        breath: 0.15,
        buzz: [r(rng, 22, 30), 0.35],
        formants: [[500, 2, 1], [1100, 3, 0.3]],
      },
      0.6,
      rng,
    );
    t += length + 0.07;
  }
  return t;
};

/** A harsh, harmonic-rich call through a nasal formant (crows, jays, gulls). */
function harshCall(out: Stereo, t: number, length: number, contour: Contour, formants: Syllable['formants'], peak: number, rng: () => number, breath = 0.2): void {
  sing(out, t, { length, pitch: contour, harmonics: [0.9, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2], breath, formants, amp: swell(0.08, 0.35) }, peak, rng);
}

/** Crow: one to four hoarse, falling "caaw"s. */
const crow: CallVoice = (out, rng) => {
  const caws = 1 + Math.floor(rng() * 4);
  const f = r(rng, 480, 600);
  let t = 0;
  for (let i = 0; i < caws; i++) {
    const length = r(rng, 0.24, 0.36);
    harshCall(out, t, length, [[0, f], [0.25, f * 1.06], [1, f * 0.72]], [[1250, 3, 1], [2300, 4, 0.5]], 0.35, rng, 0.35);
    t += length + r(rng, 0.14, 0.24);
  }
  return t;
};

/** Raven: deep, hollow "kronk"s with a gurgle in them. */
const raven: CallVoice = (out, rng) => {
  const croaks = 1 + Math.floor(rng() * 3);
  let t = 0;
  for (let i = 0; i < croaks; i++) {
    const f = r(rng, 260, 320);
    const length = r(rng, 0.26, 0.36);
    sing(
      out,
      t,
      { length, pitch: [[0, f], [1, f * 0.85]], harmonics: [0.9, 0.7, 0.5, 0.35, 0.2], buzz: [r(rng, 28, 36), 0.5], breath: 0.2, formants: [[750, 2.5, 1], [1500, 3, 0.4]], amp: swell(0.1, 0.4) },
      0.4,
      rng,
    );
    t += length + r(rng, 0.25, 0.4);
  }
  return t;
};

/** Blue jay: two or three loud, descending "jeer"s. */
const jay: CallVoice = (out, rng) => {
  const calls = 2 + Math.floor(rng() * 2);
  let t = 0;
  for (let i = 0; i < calls; i++) {
    const f = r(rng, 2200, 2600);
    harshCall(out, t, 0.24, [[0, f], [0.2, f * 1.05], [1, f * 0.7]], [[2400, 2, 1], [4200, 3, 0.4]], 0.3, rng, 0.15);
    t += 0.33;
  }
  return t;
};

/** Herring gull: the "laugh": one long rising cry, then a run of shorter ones. */
const gull: CallVoice = (out, rng) => {
  const f = r(rng, 850, 1050);
  let t = 0;
  harshCall(out, t, 0.5, [[0, f * 0.8], [0.3, f * 1.4], [1, f * 0.95]], [[1700, 2.5, 1], [3000, 3, 0.4]], 0.32, rng, 0.1);
  t += 0.62;
  const kows = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < kows; i++) {
    const k = 1 - i * 0.04;
    harshCall(out, t, 0.2, [[0, f * k], [0.35, f * 1.25 * k], [1, f * 0.85 * k]], [[1600, 2.5, 1], [2900, 3, 0.35]], 0.28 * (1 - i * 0.08), rng, 0.1);
    t += 0.27;
  }
  return t;
};

/** Sandpiper: one to three thin, high "peep"s. */
const sandpiper: CallVoice = (out, rng) => {
  const peeps = 1 + Math.floor(rng() * 3);
  let t = 0;
  for (let i = 0; i < peeps; i++) {
    const f = r(rng, 4800, 5600);
    sing(out, t, { length: 0.06, pitch: [[0, f], [0.3, f * 1.05], [1, f * 0.88]], amp: sharp }, 0.35, rng);
    t += r(rng, 0.11, 0.16);
  }
  return t;
};

/** Tawny owl: "hoo… hu-hu-hu-hoooo", soft and round, the last note long and quavering. */
const owl: CallVoice = (out, rng) => {
  const f = r(rng, 380, 430);
  const hoot = (t: number, length: number, quaver = 0) =>
    sing(out, t, { length, pitch: [[0, f * 0.95], [0.2, f], [1, f * 0.93]], amp: swell(0.18, 0.4), harmonics: [0.12], breath: 0.08, buzz: quaver ? [quaver, 0.35] : undefined }, 0.5, rng);
  hoot(0, 0.45);
  let t = 1.4 + r(rng, 0, 0.6);
  for (let i = 0; i < 3; i++) {
    hoot(t, 0.1);
    t += 0.16;
  }
  hoot(t, 0.9, r(rng, 8, 11));
  return t + 0.95;
};

/** Bald eagle: a thin, high, chittering series that tumbles downwards. */
const eagle: CallVoice = (out, rng) => {
  const notes = 6 + Math.floor(rng() * 5);
  let t = 0;
  for (let i = 0; i < notes; i++) {
    const f = r(rng, 3200, 3500) * (1 - i * 0.025);
    sing(out, t, { length: 0.07, pitch: [[0, f * 1.05], [1, f * 0.9]], amp: sharp, harmonics: [0.2] }, 0.3, rng);
    t += r(rng, 0.08, 0.11);
  }
  return t;
};

/** Nightjar: a long, dry, mechanical churr, about forty notes a second, that shifts gear now and then. */
const nightjar: CallVoice = (out, rng) => {
  const length = r(rng, 2.8, 4.5);
  const rate = r(rng, 36, 42);
  let high = rng() < 0.5;
  let gear = r(rng, 0.4, 1.1);
  for (let t = 0; t < length; t += 1 / rate) {
    gear -= 1 / rate;
    if (gear <= 0) {
      high = !high;
      gear = r(rng, 0.4, 1.1);
    }
    const f = high ? 2100 : 1750;
    const fade = Math.min(1, t / 0.25, (length - t) / 0.3);
    sing(out, t, { length: 0.016, pitch: [[0, f], [1, f * 0.97]], amp: sharp, harmonics: [0.4, 0.2], breath: 0.2 }, 0.3 * fade, rng);
  }
  return length;
};

/** Woodpecker drumming: a fast, slowing roll of hollow knocks on dead wood. */
const woodpecker: CallVoice = (out, rng) => {
  const knocks = 12 + Math.floor(rng() * 10);
  let gap = 1 / r(rng, 17, 22);
  const tone = r(rng, 900, 1300);
  let t = 0;
  for (let i = 0; i < knocks; i++) {
    const fade = 1 - (i / knocks) * 0.6;
    addNoiseBurst(out, t, 0.03, Biquad.make('bandpass', tone, 6, out.sampleRate), 2.2 * fade, 0, rng, 0.0005);
    addNoiseBurst(out, t, 0.02, Biquad.make('lowpass', 400, 1, out.sampleRate), 0.8 * fade, 0, rng, 0.0005);
    t += gap;
    gap *= 1.012;
  }
  return t + 0.05;
};

/** Wings: a quick train of soft whooshes, fading as the bird climbs away. */
const wings: CallVoice = (out, rng) => {
  const flaps = 5 + Math.floor(rng() * 5);
  const interval = 1 / r(rng, 10, 14);
  for (let i = 0; i < flaps; i++) {
    const fade = 1 - i / flaps;
    addNoiseBurst(out, i * interval, interval * 0.8, Biquad.make('bandpass', r(rng, 550, 850), 0.8, out.sampleRate), fade, 0, rng, interval * 0.3);
  }
  return flaps * interval;
};

// --- Mammals -----------------------------------------------------------------

/** A voice through vowel formants that move from one vowel to another: the basis of every mammal call. */
function vocal(
  out: Stereo,
  t: number,
  length: number,
  pitch: Contour,
  from: ReadonlyArray<readonly [number, number, number]>,
  to: ReadonlyArray<readonly [number, number, number]>,
  peak: number,
  rng: () => number,
  extra: Partial<Syllable> = {},
): void {
  sing(out, t, { length, pitch, harmonics: [0.8, 0.65, 0.5, 0.4, 0.3, 0.22, 0.15, 0.1], formants: from, formantsTo: to, breath: 0.08, amp: swell(0.12, 0.3), ...extra }, peak, rng);
}

/** Cat: a "mee-ow", pitch arching up and the mouth opening, then closing. */
const meow: CallVoice = (out, rng) => {
  const f = r(rng, 480, 620);
  const length = r(rng, 0.5, 0.75);
  vocal(out, 0, length * 0.45, [[0, f * 0.9], [1, f * 1.2]], [[500, 4, 1], [2200, 6, 0.4]], [[950, 4, 1], [1700, 6, 0.4]], 0.5, rng);
  vocal(out, length * 0.4, length * 0.6, [[0, f * 1.2], [1, f * 0.78]], [[950, 4, 1], [1700, 6, 0.4]], [[600, 4, 1], [1100, 6, 0.4]], 0.5, rng, { amp: swell(0.05, 0.5) });
  return length;
};

/** Cat purring: breathing in and out, each a run of soft, low, pulsing rumbles. */
const purr: CallVoice = (out, rng) => {
  const length = r(rng, 1.8, 2.6);
  const rate = r(rng, 23, 28);
  const breath = r(rng, 0.7, 0.95);
  for (let t = 0; t < length; t += 1 / rate) {
    const inhale = Math.floor(t / breath) % 2 === 1;
    const phase = (t % breath) / breath;
    const level = Math.sin(Math.PI * phase) ** 0.5 * (inhale ? 0.7 : 1) * Math.min(1, t / 0.3, (length - t) / 0.4);
    addNoiseBurst(out, t, 0.03, Biquad.make('lowpass', inhale ? 380 : 300, 1.2, out.sampleRate), 1.8 * level, 0, rng, 0.006);
  }
  return length;
};

/** Dog: one or two soft, closed-mouth "boof"s, chesty and low. */
const boof: CallVoice = (out, rng) => {
  const boofs = rng() < 0.6 ? 1 : 2;
  let t = 0;
  for (let i = 0; i < boofs; i++) {
    const f = r(rng, 140, 180);
    vocal(out, t, 0.17, [[0, f * 1.3], [1, f * 0.8]], [[400, 2, 1], [900, 3, 0.4]], [[520, 2, 1], [1000, 3, 0.4]], 0.6, rng, { amp: swell(0.08, 0.6), breath: 0.25 });
    t += r(rng, 0.3, 0.42);
  }
  return t;
};

/** Dog joining in with something far off: a soft, rising, wavering "ooo-ooo". */
const dogHowl: CallVoice = (out, rng) => {
  const f = r(rng, 330, 400);
  const length = r(rng, 1.6, 2.3);
  vocal(out, 0, length, [[0, f * 0.8], [0.3, f * 1.35], [0.65, f * 1.35], [1, f * 0.95]], [[450, 3, 1], [950, 4, 0.3]], [[650, 3, 1], [1100, 4, 0.3]], 0.45, rng, {
    vibrato: [5.5, 0.025],
    amp: swell(0.15, 0.3),
    harmonics: [0.35, 0.15, 0.08],
  });
  return length;
};

/** Wolf: a long, pure, gliding howl; sometimes a second wolf answers a little higher. */
const wolf: CallVoice = (out, rng) => {
  const voices = rng() < 0.5 ? 2 : 1;
  let end = 0;
  for (let v = 0; v < voices; v++) {
    const t = v * r(rng, 0.8, 1.6);
    const length = r(rng, 2.6, 3.4);
    const f = r(rng, 300, 360) * (v ? 1.18 : 1);
    vocal(out, t, length, [[0, f * 0.75], [0.28, f * 1.6], [0.7, f * 1.6], [1, f * 1.15]], [[500, 3, 1], [1000, 4, 0.2]], [[700, 3, 1], [1100, 4, 0.2]], 0.35, rng, {
      vibrato: [r(rng, 4.5, 6), 0.02],
      harmonics: [0.25, 0.1],
      amp: swell(0.18, 0.35),
      breath: 0.04,
    });
    end = Math.max(end, t + length);
  }
  return end;
};

/** Bull elk: a rising whistle breaking into a high, piercing bugle, then a few grunts. */
const elk: CallVoice = (out, rng) => {
  const length = r(rng, 1.6, 2.1);
  const f = r(rng, 560, 640);
  sing(out, 0, { length, pitch: [[0, f], [0.45, f * 3], [0.8, f * 3], [1, f * 2.2]], vibrato: [7, 0.02], harmonics: [0.2, 0.05], breath: 0.08, amp: swell(0.15, 0.25) }, 0.35, rng);
  let t = length + 0.15;
  for (let i = 0; i < 3; i++) {
    vocal(out, t, 0.2, [[0, 110], [1, 82]], [[350, 2, 1], [800, 3, 0.4]], [[300, 2, 1], [700, 3, 0.4]], 0.35, rng, { breath: 0.3 });
    t += 0.32;
  }
  return t;
};

/** Fox: a hoarse, rising-falling "wow-wow", two or three harsh yelps. */
const fox: CallVoice = (out, rng) => {
  const yelps = 2 + Math.floor(rng() * 2);
  let t = 0;
  for (let i = 0; i < yelps; i++) {
    const f = r(rng, 520, 640);
    const length = r(rng, 0.15, 0.2);
    vocal(out, t, length, [[0, f * 0.8], [0.35, f * 1.25], [1, f * 0.7]], [[900, 3, 1], [1800, 4, 0.5]], [[1300, 3, 1], [2200, 4, 0.5]], 0.4, rng, { breath: 0.35 });
    t += length + r(rng, 0.18, 0.32);
  }
  return t;
};

/** Cow: a long "mmm-ooo", starting closed and nasal, opening up, sagging at the end. */
const moo: CallVoice = (out, rng) => {
  const length = r(rng, 1.1, 1.7);
  const f = r(rng, 105, 135);
  vocal(out, 0, length, [[0, f], [0.3, f * 1.15], [1, f * 0.85]], [[300, 3, 1], [800, 4, 0.3]], [[700, 2.5, 1], [1150, 4, 0.5]], 0.6, rng, { amp: swell(0.15, 0.3), breath: 0.1 });
  return length;
};

/** Sheep: a wavering "baa", nasal, with the bleat's fast tremble in pitch and loudness. */
const baa: CallVoice = (out, rng) => {
  const length = r(rng, 0.55, 0.9);
  const f = r(rng, 280, 360);
  vocal(out, 0, length, [[0, f], [0.25, f * 1.08], [1, f * 0.9]], [[750, 3, 1], [1300, 4, 0.5]], [[850, 3, 1], [1250, 4, 0.5]], 0.5, rng, {
    vibrato: [r(rng, 7, 10), 0.05],
    buzz: [r(rng, 7, 10), 0.4],
    amp: swell(0.08, 0.35),
  });
  return length;
};

/** Horse: a high, quavering whinny tumbling down, ending in a snort. */
const whinny: CallVoice = (out, rng) => {
  const length = r(rng, 1, 1.35);
  const f = r(rng, 850, 1050);
  vocal(out, 0, length, [[0, f], [0.15, f * 1.1], [1, f * 0.35]], [[1500, 2, 1], [2600, 3, 0.4]], [[700, 2, 1], [1300, 3, 0.4]], 0.4, rng, { vibrato: [r(rng, 9, 12), 0.06], amp: swell(0.08, 0.3) });
  addNoiseBurst(out, length * 0.95, 0.3, Biquad.make('bandpass', 500, 0.8, out.sampleRate), 0.8, 0, rng, 0.01);
  return length + 0.35;
};

/** Squirrel: a rapid, scolding chatter of noisy "chuk"s and squeaky chips. */
const squirrel: CallVoice = (out, rng) => {
  const notes = 8 + Math.floor(rng() * 12);
  let t = 0;
  for (let i = 0; i < notes; i++) {
    if (rng() < 0.6) addNoiseBurst(out, t, 0.03, Biquad.make('bandpass', r(rng, 2200, 3400), 3, out.sampleRate), 1.5, 0, rng, 0.002);
    else sing(out, t, { length: 0.04, pitch: [[0, r(rng, 3600, 4400)], [1, r(rng, 2600, 3200)]], amp: sharp, harmonics: [0.3, 0.15], breath: 0.3 }, 0.3, rng);
    t += r(rng, 0.05, 0.075);
  }
  return t;
};

/** Hen: a few contented "buk"s, and now and then a rising "ba-GAWK". */
const cluck: CallVoice = (out, rng) => {
  const clucks = 2 + Math.floor(rng() * 4);
  let t = 0;
  const f = r(rng, 300, 380);
  for (let i = 0; i < clucks; i++) {
    vocal(out, t, 0.07, [[0, f * 1.1], [1, f * 0.85]], [[900, 3, 1], [1700, 4, 0.4]], [[750, 3, 1], [1500, 4, 0.4]], 0.45, rng, { amp: sharp, breath: 0.2 });
    t += r(rng, 0.12, 0.22);
  }
  if (rng() < 0.3) {
    vocal(out, t, 0.32, [[0, f], [0.3, f * 1.8], [1, f * 1.5]], [[800, 3, 1], [1600, 4, 0.4]], [[1100, 3, 1], [2000, 4, 0.4]], 0.45, rng, { amp: swell(0.1, 0.4), breath: 0.2 });
    t += 0.36;
  }
  return t;
};

/** Breathy noises: a deer's snort, a bear's deep huff. */
const snort: CallVoice = (out, rng) => {
  addNoiseBurst(out, 0, 0.3, Biquad.make('bandpass', r(rng, 600, 800), 1.2, out.sampleRate), 1.4, 0, rng, 0.02);
  return 0.32;
};
const huff: CallVoice = (out, rng) => {
  addNoiseBurst(out, 0, 0.3, Biquad.make('lowpass', 320, 0.8, out.sampleRate), 1.6, 0, rng, 0.03);
  addNoiseBurst(out, 0.45, 0.3, Biquad.make('lowpass', 300, 0.8, out.sampleRate), 1.3, 0, rng, 0.03);
  return 0.8;
};

/** The calls synthesized here, by sound id, with the peak level each is played at. */
export const CALL_VOICES = {
  'sparrow-chirp': [sparrow, 0.22],
  'robin-song': [robin, 0.2],
  'chickadee-call': [chickadee, 0.18],
  'finch-song': [finch, 0.17],
  'bluebird-song': [bluebird, 0.17],
  'pigeon-coo': [pigeon, 0.28],
  'crow-caw': [crow, 0.3],
  'raven-croak': [raven, 0.3],
  'jay-call': [jay, 0.24],
  'gull-cry': [gull, 0.24],
  'sandpiper-peep': [sandpiper, 0.15],
  'owl-hoot': [owl, 0.3],
  'eagle-cry': [eagle, 0.14],
  'nightjar-churr': [nightjar, 0.25],
  'woodpecker-drum': [woodpecker, 0.45],
  'wing-flap': [wings, 0.3],
  'cat-meow': [meow, 0.35],
  'cat-purr': [purr, 0.3],
  'dog-boof': [boof, 0.45],
  'dog-howl': [dogHowl, 0.3],
  'wolf-howl': [wolf, 0.24],
  'elk-bugle': [elk, 0.18],
  'fox-bark': [fox, 0.28],
  'cow-moo': [moo, 0.4],
  'sheep-baa': [baa, 0.32],
  'horse-whinny': [whinny, 0.26],
  'squirrel-chatter': [squirrel, 0.14],
  'chicken-cluck': [cluck, 0.3],
  'deer-snort': [snort, 0.4],
  'bear-huff': [huff, 0.5],
} as const satisfies Record<string, readonly [CallVoice, number]>;

export type CallId = keyof typeof CALL_VOICES;

/** Longest any call runs (s). */
export const MAX_CALL_SECONDS = 7;
