import { addNoiseBurst, Biquad, panGains, type Stereo } from '../synth';
import { breathe, smooth, vocalise } from './voice';

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

/** Raven: deep, rough "kraa"s and "kronk"s, after a recording: a low voice buried in gravel and rasp. */
const raven: CallVoice = (out, rng) => {
  const croaks = 1 + Math.floor(rng() * rng() * 3.5);
  let t = 0;
  for (let i = 0; i < croaks; i++) {
    const f = r(rng, 300, 420);
    const length = r(rng, 0.38, 0.62);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.94], [0.25, f], [1, f * r(rng, 0.8, 0.9)]],
      envelope: smooth(r(rng, 0.08, 0.14), r(rng, 0.3, 0.45)),
      tilt: 0.5,
      ceiling: 6500,
      jitter: r(rng, 0.03, 0.05),
      shimmer: 0.35,
      sub: r(rng, 0.5, 0.8),
      breath: r(rng, 0.18, 0.3),
      breathBand: [1100, 4000],
      pulsedBreath: 0.8,
      formants: [[0, [{ f: 1700, q: 3, gain: 1 }, { f: 2950, q: 4, gain: 0.55 }, { f: 3850, q: 5, gain: 0.3 }]], [1, [{ f: 1550, q: 3, gain: 1 }, { f: 2800, q: 4, gain: 0.5 }, { f: 3700, q: 5, gain: 0.25 }]]],
      dry: 0.03,
    }, 1, rng);
    t += length + r(rng, 0.22, 0.4);
  }
  return t;
};

/** Blue jay: a harsh, nasal "jaay", after a recording: usually twice, sometimes once or three times. */
const jay: CallVoice = (out, rng) => {
  const roll = rng();
  const calls = roll < 0.7 ? 2 : roll < 0.85 ? 1 : 3;
  let t = 0;
  for (let i = 0; i < calls; i++) {
    const f = r(rng, 760, 900);
    const length = r(rng, 0.3, 0.42);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.92], [0.15, f * 1.04], [0.65, f], [1, f * r(rng, 0.78, 0.86)]],
      envelope: smooth(0.08, 0.3),
      tilt: 0.72,
      ceiling: 10000,
      jitter: 0.025,
      shimmer: 0.2,
      sub: 0.15,
      breath: r(rng, 0.08, 0.14),
      breathBand: [3000, 9000],
      formants: [[0, [{ f: 3600, q: 2.5, gain: 1 }, { f: 5200, q: 3, gain: 0.8 }, { f: 7000, q: 3, gain: 0.45 }]], [1, [{ f: 3300, q: 2.5, gain: 1 }, { f: 4900, q: 3, gain: 0.7 }, { f: 6700, q: 3, gain: 0.4 }]]],
      dry: 0.04,
    }, 1, rng);
    t += length + r(rng, 0.1, 0.22);
  }
  return t;
};

/**
 * Herring gull: the laughing call, after a recording: a run of rough "kyow"s, each
 * leaping up and sliding down, a full stack of harmonics, the first one longest.
 */
const gull: CallVoice = (out, rng) => {
  const f = r(rng, 760, 900);
  const notes = 3 + Math.floor(rng() * 6);
  let t = 0;
  for (let i = 0; i < notes; i++) {
    const length = i === 0 ? r(rng, 0.38, 0.5) : r(rng, 0.2, 0.32);
    const k = 1 - i * 0.025 + r(rng, -0.04, 0.04);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.75 * k], [0.18, f * 1.2 * k], [0.4, f * 1.08 * k], [1, f * 0.72 * k]],
      envelope: smooth(0.06, 0.35),
      tilt: 0.62,
      ceiling: 5600,
      jitter: 0.012,
      shimmer: 0.1,
      sub: [[0, 0.2], [0.15, 0.02], [1, 0]],
      breath: [[0, 0.05], [0.2, 0.015], [1, 0.015]],
      breathBand: [1200, 5000],
      formants: [[0, [{ f: 1500, q: 2.5, gain: 1 }, { f: 2700, q: 3, gain: 0.8 }, { f: 4100, q: 3, gain: 0.7 }]], [1, [{ f: 1300, q: 2.5, gain: 1 }, { f: 2500, q: 3, gain: 0.7 }, { f: 3900, q: 3, gain: 0.6 }]]],
      dry: 0.08,
    }, 1 - i * 0.05, rng);
    t += length + r(rng, 0.12, 0.3);
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

/** Bald eagle: thin, piping notes in quick clusters, after a recording: rising, chittering, tumbling. */
const eagle: CallVoice = (out, rng) => {
  const clusters = 2 + Math.floor(rng() * 3);
  let t = 0;
  for (let c = 0; c < clusters; c++) {
    const notes = 2 + Math.floor(rng() * 3);
    const f = r(rng, 2300, 2700) * (1 - c * 0.04);
    for (let i = 0; i < notes; i++) {
      // The first note of a run is a drawn-out whistle; the rest are quick chitters.
      const length = i === 0 && rng() < 0.5 ? r(rng, 0.3, 0.45) : r(rng, 0.07, 0.15);
      vocalise(out, t, {
        length,
        pitch: [[0, f * 0.95], [0.3, f * 1.04], [1, f * 0.9]],
        envelope: smooth(0.15, 0.45),
        tilt: 0.35,
        ceiling: 10000,
        jitter: 0.01,
        shimmer: 0.1,
        breath: 0.06,
        breathBand: [2000, 6000],
        formants: [[0, [{ f: 2600, q: 2, gain: 1 }, { f: 5200, q: 3, gain: 0.35 }]]],
        dry: 0.5,
      }, 1, rng);
      t += length + r(rng, 0.02, 0.06);
    }
    t += r(rng, 0.25, 0.55);
  }
  return t;
};

/**
 * Nightjar, after a recording: a long, dry churr (a buzzing trill, nearly forty pulses a
 * second, that shifts gear now and then and catches its breath), with a soft "chuck" or
 * two between churrs, and now and then the clap of its wings.
 */
const nightjar: CallVoice = (out, rng) => {
  let t = 0;
  const churrs = 1 + Math.floor(rng() * 2);
  for (let c = 0; c < churrs; c++) {
    const length = r(rng, 1.6, 2.8);
    const base = r(rng, 1550, 1750);
    // Gear changes: the pitch steps between two levels.
    const pitch: Array<[number, number]> = [[0, base]];
    let u = 0;
    let high = false;
    while (u < 1) {
      u += r(rng, 0.18, 0.4);
      high = !high;
      pitch.push([Math.min(1, u - 0.02), pitch[pitch.length - 1][1]], [Math.min(1, u), base * (high ? 1.12 : 1)]);
    }
    vocalise(out, t, {
      length,
      pitch,
      envelope: smooth(0.04, 0.06),
      tilt: 0.3,
      ceiling: 5000,
      jitter: 0.01,
      shimmer: 0.2,
      growl: [r(rng, 27, 32), 0.9],
      sub: 0.35,
      breath: 0.1,
      breathBand: [1200, 3000],
      formants: [[0, [{ f: 1800, q: 2.5, gain: 1 }, { f: 3500, q: 4, gain: 0.12 }]]],
      dry: 0.3,
    }, 1, rng);
    t += length + r(rng, 0.25, 0.6);
    // A soft "chuck" or two.
    const chucks = Math.floor(rng() * 3);
    for (let i = 0; i < chucks; i++) {
      const f = r(rng, 1300, 1700);
      vocalise(out, t, {
        length: r(rng, 0.06, 0.1),
        pitch: [[0, f * 1.15], [1, f * 0.85]],
        envelope: smooth(0.2, 0.5),
        tilt: 0.5,
        breath: 0.2,
        formants: [[0, [{ f: 2000, q: 3, gain: 1 }]]],
        dry: 0.5,
      }, 0.7, rng);
      t += r(rng, 0.25, 0.5);
    }
    // The clap of its wings, now and then.
    if (rng() < 0.3) {
      breathe(out, t, { length: 0.05, envelope: smooth(0.1, 0.8), bands: [{ type: 'bandpass', f: [[0, 1400]], q: 0.8 }] }, 0.9, rng);
      t += 0.3;
    }
  }
  return Math.min(t, 6.8);
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

/** Wings, after a recording: a run of soft, airy feather-swishes, slowing and fading as the bird climbs away. */
const wings: CallVoice = (out, rng) => {
  const flaps = 4 + Math.floor(rng() * 7);
  let interval = 1 / r(rng, 7, 10);
  let t = 0;
  for (let i = 0; i < flaps; i++) {
    const fade = 1 - (i / flaps) * 0.7;
    const length = interval * r(rng, 0.75, 0.95);
    breathe(out, t, {
      length,
      envelope: smooth(r(rng, 0.25, 0.4), 0.55),
      bands: [{ type: 'highpass', f: [[0, 180], [1, 260]], q: 0.6 }, { type: 'lowpass', f: [[0, 9000], [1, 6000]], q: 0.5 }],
      // The downstroke's soft thump of air.
      body: [r(rng, 160, 220), 0.18],
      flutter: [r(rng, 60, 90), 0.25],
    }, fade, rng);
    t += interval;
    interval *= r(rng, 1.02, 1.08);
  }
  return t + 0.05;
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

/**
 * Cat, after a recording: a "meow" of about two-thirds of a second, a rich stack of
 * harmonics on a voice near 600 Hz that lifts at the start, holds and sags at the end,
 * the mouth opening from "mm" through "eee" to "ow".
 */
const meow: CallVoice = (out, rng) => {
  const f = r(rng, 560, 680);
  const length = r(rng, 0.5, 0.8);
  vocalise(out, 0, {
    length,
    pitch: [[0, f * 0.82], [0.12, f * 1.08], [0.3, f * r(rng, 1.02, 1.12)], [0.75, f], [1, f * r(rng, 0.78, 0.88)]],
    envelope: smooth(0.12, 0.3),
    tilt: 0.45,
    ceiling: 6500,
    jitter: 0.008,
    shimmer: 0.06,
    vibrato: [r(rng, 5, 7), 0.006],
    breath: [[0, 0.03], [0.3, 0.01], [1, 0.03]],
    breathBand: [1500, 6000],
    formants: [
      [0, [{ f: 1100, q: 3, gain: 0.6 }, { f: 1700, q: 3, gain: 0.5 }, { f: 3300, q: 4, gain: 0.25 }]],
      [0.3, [{ f: 1500, q: 3, gain: 1 }, { f: 2100, q: 3, gain: 0.9 }, { f: 3400, q: 4, gain: 0.3 }]],
      [1, [{ f: 1300, q: 3, gain: 1 }, { f: 1800, q: 3, gain: 0.6 }, { f: 3200, q: 4, gain: 0.15 }]],
    ],
    dry: 0.02,
  }, 1, rng);
  return length + 0.05;
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

/**
 * Dog, after a recording: a deep, chesty "boof" from behind the glass, a low voice
 * (around 100 Hz) mostly breath and rumble, with a mid formant giving the "oo"; once,
 * or a couple in a row.
 */
const boof: CallVoice = (out, rng) => {
  const count = rng() < 0.55 ? 1 : 2 + Math.floor(rng() * 2);
  let t = 0;
  for (let i = 0; i < count; i++) {
    const f = r(rng, 85, 125);
    const length = r(rng, 0.22, 0.38);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 1.3], [0.2, f * 1.15], [1, f * 0.85]],
      envelope: smooth(0.12, 0.6),
      tilt: 0.35,
      ceiling: 2000,
      jitter: 0.03,
      shimmer: 0.25,
      sub: 0.3,
      breath: [[0, 0.35], [0.4, 0.25], [1, 0.2]],
      breathBand: [100, 900],
      pulsedBreath: 0.7,
      formants: [[0, [{ f: 380, q: 2, gain: 1 }, { f: 1250, q: 3, gain: 0.15 }]], [1, [{ f: 320, q: 2, gain: 1 }, { f: 1150, q: 3, gain: 0.1 }]]],
      dry: 0.35,
    }, 1, rng);
    t += length + r(rng, 0.25, 0.45);
  }
  return t;
};

/**
 * Dog howling, after a recording: a yelp that drops into a long, steady, dark "ooooo"
 * near 330 Hz (a few clear harmonics, no wobble), lifting a little before it fades.
 */
const dogHowl: CallVoice = (out, rng) => {
  const f = r(rng, 300, 360);
  const length = r(rng, 2, 3.2);
  vocalise(out, 0, {
    length,
    pitch: [[0, f * r(rng, 1.6, 1.9)], [0.04, f * 1.05], [0.1, f], [0.85, f * r(rng, 0.95, 1)], [1, f * r(rng, 1.04, 1.12)]],
    envelope: smooth(0.03, 0.18),
    tilt: 0.2,
    ceiling: 2500,
    jitter: 0.004,
    shimmer: 0.04,
    sub: [[0, 0.3], [0.06, 0], [1, 0]],
    breath: [[0, 0.08], [0.08, 0.005], [1, 0.01]],
    breathBand: [300, 2000],
    formants: [[0, [{ f: 650, q: 3, gain: 1 }, { f: 1400, q: 4, gain: 0.2 }]], [0.1, [{ f: 640, q: 3, gain: 1 }, { f: 1300, q: 4, gain: 0.1 }]]],
    dry: 0.3,
  }, 1, rng);
  return length;
};

/** Wolf: a long, pure, gliding howl; sometimes a second wolf answers a little higher. */
const wolf: CallVoice = (out, rng) => {
  // After a recording: a rich, full-throated howl (many harmonics, no pure tone), sliding up
  // from about 330 Hz to a held ~470, then sinking slowly; now and then a second wolf joins.
  const voices = rng() < 0.4 ? 2 : 1;
  let end = 0;
  for (let v = 0; v < voices; v++) {
    const t = v * r(rng, 1, 2.2);
    const length = r(rng, 3.2, 5.2);
    const f = r(rng, 300, 350) * (v ? r(rng, 1.12, 1.3) : 1);
    const top = r(rng, 1.3, 1.45);
    const hold = r(rng, 0.32, 0.45);
    vocalise(out, t, {
      length,
      pitch: [[0, f], [r(rng, 0.1, 0.16), f * top], [hold, f * top * r(rng, 0.98, 1.02)], [hold + 0.15, f * r(rng, 1.06, 1.12)], [1, f * r(rng, 0.98, 1.04)]],
      envelope: smooth(r(rng, 0.06, 0.1), r(rng, 0.2, 0.3)),
      tilt: r(rng, 0.17, 0.22),
      ceiling: 7000,
      jitter: 0.004,
      shimmer: 0.04,
      vibrato: [r(rng, 4, 5.5), 0.0025],
      sub: [[0, 0.12], [0.08, 0], [0.92, 0], [1, 0.1]],
      breath: [[0, 0.06], [0.12, 0.012], [1, 0.02]],
      breathBand: [400, 1600],
      formants: [[0, [{ f: 560, q: 3, gain: 1 }, { f: 1000, q: 4, gain: 0.3 }, { f: 2600, q: 5, gain: 0.04 }]], [0.3, [{ f: 820, q: 3, gain: 1 }, { f: 1350, q: 4, gain: 0.25 }, { f: 3000, q: 5, gain: 0.04 }]], [1, [{ f: 700, q: 3, gain: 1 }, { f: 1200, q: 4, gain: 0.22 }, { f: 2800, q: 5, gain: 0.03 }]]],
      dry: 0.6,
    }, v ? 0.7 : 1, rng);
    end = Math.max(end, t + length);
  }
  return end;
};

/**
 * Bull elk, after a recording: a low grunt, then a whistle that climbs in steps from
 * about 1 kHz to a piercing 2.2–2.5 kHz and holds, breaking at the end into a rough,
 * falling squeal (the "tinge"), and a few chuckling grunts.
 */
const elk: CallVoice = (out, rng) => {
  let t = 0;
  // The opening grunt.
  vocalise(out, t, {
    length: 0.12,
    pitch: [[0, 140], [1, 110]],
    envelope: smooth(0.2, 0.5),
    tilt: 0.5,
    sub: 0.5,
    breath: 0.6,
    breathBand: [200, 1500],
    formants: [[0, [{ f: 500, q: 2, gain: 1 }]]],
    dry: 0.4,
  }, 0.5, rng);
  t += 0.17;
  const top = r(rng, 2150, 2450);
  const climb = r(rng, 0.35, 0.55);
  const hold = r(rng, 1, 1.6);
  const fall = r(rng, 0.35, 0.55);
  const length = climb + hold + fall;
  const a = climb / length;
  const b = (climb + hold) / length;
  vocalise(out, t, {
    length,
    pitch: [[0, top * 0.42], [a * 0.45, top * 0.62], [a * 0.55, top * 0.8], [a, top * 0.97], [b * 0.97, top * r(rng, 1, 1.06)], [b, top * 1.02], [1, top * r(rng, 0.5, 0.6)]],
    envelope: smooth(0.06, 0.12),
    tilt: 0.42,
    ceiling: 9000,
    jitter: 0.006,
    shimmer: 0.08,
    vibrato: [r(rng, 6, 8), 0.008],
    sub: [[0, 0.15], [a, 0], [b, 0.05], [Math.min(0.99, b + 0.05), 0.6], [1, 0.7]],
    breath: [[0, 0.15], [a, 0.04], [b, 0.08], [1, 0.6]],
    breathBand: [1000, 6000],
    formants: [[0, [{ f: 1600, q: 2, gain: 1 }, { f: 3200, q: 3, gain: 0.3 }]], [b, [{ f: 2400, q: 2, gain: 1 }, { f: 4700, q: 3, gain: 0.35 }]], [1, [{ f: 1500, q: 2, gain: 1 }, { f: 3000, q: 3, gain: 0.5 }]]],
    dry: 0.5,
  }, 1, rng);
  t += length + 0.15;
  // Chuckles: a few deep, quick grunts.
  const grunts = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < grunts; i++) {
    vocalise(out, t, {
      length: r(rng, 0.1, 0.16),
      pitch: [[0, r(rng, 110, 140)], [1, r(rng, 80, 95)]],
      envelope: smooth(0.15, 0.5),
      tilt: 0.45,
      sub: 0.5,
      breath: 0.5,
      breathBand: [150, 1500],
      formants: [[0, [{ f: 450, q: 2, gain: 1 }, { f: 1100, q: 3, gain: 0.3 }]]],
      dry: 0.4,
    }, 0.45, rng);
    t += r(rng, 0.22, 0.32);
  }
  return t;
};

/**
 * Red fox, after a recording: a hoarse, screaming bark (half voice, half rasp)
 * falling as it goes; sometimes a second, shorter one.
 */
const fox: CallVoice = (out, rng) => {
  const count = rng() < 0.6 ? 1 : 2;
  let t = 0;
  for (let i = 0; i < count; i++) {
    const f = r(rng, 900, 1150) * (i ? 0.92 : 1);
    const length = i ? r(rng, 0.3, 0.45) : r(rng, 0.5, 0.75);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.85], [0.1, f * 1.1], [0.5, f], [1, f * 0.62]],
      envelope: smooth(0.05, 0.5),
      tilt: 0.55,
      ceiling: 7000,
      jitter: 0.04,
      shimmer: 0.3,
      sub: 0.15,
      breath: 0.28,
      breathBand: [1200, 5000],
      pulsedBreath: 0.6,
      formants: [[0, [{ f: 1900, q: 2.5, gain: 1 }, { f: 3600, q: 3, gain: 0.3 }, { f: 4800, q: 3, gain: 0.08 }]], [1, [{ f: 1700, q: 2.5, gain: 1 }, { f: 3300, q: 3, gain: 0.25 }, { f: 4500, q: 3, gain: 0.06 }]]],
      dry: 0.08,
    }, 1, rng);
    t += length + r(rng, 0.35, 0.6);
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

/**
 * Sheep, after a recording: a bright, nasal, quavering "baa-aa" near 300 Hz (its
 * pitch and loudness trembling together), once or twice.
 */
const baa: CallVoice = (out, rng) => {
  const count = rng() < 0.5 ? 1 : 2;
  let t = 0;
  for (let i = 0; i < count; i++) {
    const f = r(rng, 290, 340);
    const length = r(rng, 0.7, 1.05);
    const tremble = r(rng, 5, 7.5);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.7], [0.08, f * 1.02], [0.6, f], [1, f * 0.95]],
      envelope: smooth(0.08, 0.3),
      tilt: 0.72,
      ceiling: 9000,
      jitter: 0.015,
      shimmer: 0.12,
      vibrato: [tremble, 0.035],
      growl: [tremble, 0.45],
      breath: 0.4,
      breathBand: [2500, 8000],
      formants: [[0, [{ f: 1000, q: 3, gain: 0.25 }, { f: 1800, q: 3, gain: 0.8 }, { f: 3400, q: 3, gain: 0.9 }, { f: 4600, q: 3, gain: 0.8 }]], [0.25, [{ f: 1100, q: 3, gain: 0.3 }, { f: 1700, q: 3, gain: 0.9 }, { f: 3300, q: 3, gain: 1 }, { f: 4500, q: 3, gain: 0.9 }]]],
      dry: 0.015,
    }, 1, rng);
    t += length + r(rng, 0.35, 0.55);
  }
  return t;
};

/**
 * Horse, after a recording: a high, quavering whinny that tumbles down from about
 * 1.3 kHz, ending in a snort; and now and then a low, rumbling nicker or a grunt.
 */
const whinny: CallVoice = (out, rng) => {
  let t = 0;
  if (rng() < 0.9) {
    const f = r(rng, 1150, 1400);
    const length = r(rng, 1, 1.45);
    vocalise(out, t, {
      length,
      pitch: [[0, f * 0.85], [0.08, f], [0.3, f * 0.85], [0.7, f * 0.65], [1, f * 0.45]],
      envelope: smooth(0.06, 0.25),
      tilt: 0.5,
      ceiling: 7000,
      jitter: 0.015,
      shimmer: 0.15,
      vibrato: [r(rng, 9, 13), 0.06],
      sub: [[0, 0], [0.6, 0.1], [1, 0.35]],
      breath: 0.04,
      breathBand: [1500, 6000],
      formants: [[0, [{ f: 1800, q: 2.5, gain: 1 }, { f: 3400, q: 3, gain: 0.35 }]], [1, [{ f: 1300, q: 2.5, gain: 1 }, { f: 2600, q: 3, gain: 0.3 }]]],
      dry: 0.45,
    }, 1, rng);
    t += length + r(rng, 0.15, 0.35);
    // The snort that ends it.
    breathe(out, t, { length: r(rng, 0.18, 0.28), envelope: smooth(0.1, 0.6), bands: [{ type: 'lowpass', f: [[0, 2600], [1, 1400]], q: 0.7 }], body: [r(rng, 60, 90), 0.6], flutter: [r(rng, 35, 50), 0.6] }, 0.9, rng);
    t += 0.3;
  }
  if (t === 0 || rng() < 0.4) {
    // A nicker: a low, fluttering rumble of quick voiced pulses; or a single grunt.
    const nicker = rng() < 0.6;
    const length = nicker ? r(rng, 0.5, 0.9) : r(rng, 0.15, 0.25);
    vocalise(out, t, {
      length,
      pitch: [[0, r(rng, 110, 150)], [1, r(rng, 85, 110)]],
      envelope: smooth(0.1, 0.4),
      tilt: 0.5,
      ceiling: 4000,
      jitter: 0.03,
      shimmer: 0.3,
      sub: 0.4,
      growl: nicker ? [r(rng, 14, 20), 0.85] : undefined,
      breath: 0.25,
      breathBand: [150, 2000],
      formants: [[0, [{ f: 450, q: 2, gain: 1 }, { f: 1200, q: 3, gain: 0.35 }]]],
      dry: 0.45,
    }, 0.8, rng);
    t += length;
  }
  return t + 0.05;
};

/**
 * Squirrel, after a recording: a scolding run of "kuk"s (each a burst of rasping
 * noise with a squeaky whistle in it, a couple a second), often breaking into a
 * fast rattle, and sometimes a drawn-out, squealing "quaaa".
 */
const squirrel: CallVoice = (out, rng) => {
  let t = 0;
  const kuks = 3 + Math.floor(rng() * 6);
  const whistle = r(rng, 2900, 3400);
  const kuk = (at: number, length: number, level: number) => {
    breathe(out, at, { length, envelope: smooth(0.12, 0.6), bands: [{ type: 'highpass', f: [[0, 2200]], q: 0.7 }, { type: 'lowpass', f: [[0, 10000]], q: 0.5 }] }, level, rng);
    vocalise(out, at, {
      length: length * 0.8,
      pitch: [[0, whistle * 1.06], [1, whistle * 0.94]],
      envelope: smooth(0.15, 0.6),
      tilt: 0.4,
      ceiling: 11000,
      jitter: 0.02,
      breath: 0.2,
      breathBand: [3000, 9000],
      formants: [[0, [{ f: whistle, q: 4, gain: 1 }, { f: whistle * 1.65, q: 4, gain: 0.7 }]]],
      dry: 0.2,
    }, level * 0.8, rng);
  };
  for (let i = 0; i < kuks; i++) {
    kuk(t, r(rng, 0.09, 0.14), r(rng, 0.75, 1));
    t += r(rng, 0.3, 0.5);
  }
  if (rng() < 0.6) {
    // The rattle: quick, softer kuks, a dozen or more a second.
    const rattle = 8 + Math.floor(rng() * 16);
    const rate = r(rng, 11, 16);
    for (let i = 0; i < rattle; i++) {
      kuk(t, r(rng, 0.045, 0.06), 0.6 * (1 - (i / rattle) * 0.4));
      t += 1 / rate;
    }
    t += 0.2;
  }
  if (rng() < 0.25) {
    // A squeal.
    vocalise(out, t, {
      length: r(rng, 0.3, 0.5),
      pitch: [[0, whistle * 0.9], [0.3, whistle * 1.05], [1, whistle * 0.8]],
      envelope: smooth(0.1, 0.4),
      tilt: 0.45,
      ceiling: 11000,
      jitter: 0.03,
      sub: 0.3,
      breath: 0.5,
      breathBand: [2500, 9000],
      formants: [[0, [{ f: whistle * 1.2, q: 2, gain: 1 }, { f: whistle * 1.8, q: 3, gain: 0.6 }]]],
      dry: 0.2,
    }, 0.6, rng);
    t += 0.55;
  }
  return Math.min(t, 6.8);
};

/**
 * Hen, after a recording: a contented run of low, short "buk"s (a resonance near
 * 900 Hz, a few a second), and now and then a long, rising "ba-GAWK".
 */
const cluck: CallVoice = (out, rng) => {
  const clucks = 3 + Math.floor(rng() * 6);
  let t = 0;
  const f = r(rng, 220, 300);
  const buk = (at: number, length: number, level: number) =>
    vocalise(out, at, {
      length,
      pitch: [[0, f * 1.15], [1, f * 0.85]],
      envelope: smooth(0.12, 0.65),
      tilt: 0.45,
      ceiling: 6000,
      jitter: 0.03,
      shimmer: 0.25,
      sub: 0.25,
      breath: 0.2,
      breathBand: [400, 3000],
      formants: [[0, [{ f: r(rng, 850, 950), q: 2.5, gain: 1 }, { f: 2500, q: 3, gain: 0.2 }]]],
      dry: 0.2,
    }, level, rng);
  for (let i = 0; i < clucks; i++) {
    buk(t, r(rng, 0.05, 0.09), r(rng, 0.7, 1));
    t += r(rng, 0.13, 0.24);
  }
  if (rng() < 0.3) {
    buk(t, 0.07, 0.9);
    t += 0.12;
    const g = f * r(rng, 1.9, 2.3);
    vocalise(out, t, {
      length: r(rng, 0.28, 0.38),
      pitch: [[0, g * 0.85], [0.3, g * 1.05], [1, g * 0.9]],
      envelope: smooth(0.08, 0.35),
      tilt: 0.55,
      ceiling: 8000,
      jitter: 0.02,
      shimmer: 0.15,
      sub: 0.2,
      breath: 0.25,
      breathBand: [1000, 6000],
      formants: [[0, [{ f: 1000, q: 2.5, gain: 1 }, { f: 2600, q: 3, gain: 0.5 }, { f: 4400, q: 3, gain: 0.25 }]]],
      dry: 0.15,
    }, 1, rng);
    t += 0.42;
  }
  return t;
};

/**
 * Deer, after a recording: a forceful snort, a blast of air through the nostrils
 * (broad hiss, fluttering) over a deep rumble from the chest.
 */
const snort: CallVoice = (out, rng) => {
  const length = r(rng, 0.32, 0.48);
  breathe(out, 0, {
    length,
    envelope: (u) => Math.min(1, u / 0.06) * (1 - u) ** 1.6,
    bands: [{ type: 'highpass', f: [[0, 500], [1, 350]], q: 0.6 }, { type: 'lowpass', f: [[0, 9000], [1, 5000]], q: 0.5 }],
    body: [r(rng, 75, 110), 0.45],
    flutter: [r(rng, 25, 45), 0.35],
  }, 1, rng);
  return length + 0.05;
};

/**
 * Bear: deep, breathy huffs (a short blast of air, rough with the lips, over a low
 * voiced rumble), two to four in a row, and now and then a clack of the jaws.
 */
const huff: CallVoice = (out, rng) => {
  const count = 2 + Math.floor(rng() * 3);
  let t = 0;
  for (let i = 0; i < count; i++) {
    const length = r(rng, 0.25, 0.45);
    breathe(out, t, {
      length,
      envelope: (u) => Math.min(1, u / 0.08) * (1 - u) ** 1.3,
      bands: [{ type: 'lowpass', f: [[0, 2600], [1, 1200]], q: 0.6 }, { type: 'highpass', f: [[0, 90]], q: 0.6 }],
      body: [r(rng, 70, 100), 1.6],
      flutter: [r(rng, 18, 30), 0.5],
    }, 1 - i * 0.1, rng);
    t += length + r(rng, 0.25, 0.5);
  }
  if (rng() < 0.3) {
    // A jaw clack: two quick knocks.
    for (const dt of [0, r(rng, 0.08, 0.12)]) {
      breathe(out, t + dt, { length: 0.03, envelope: smooth(0.15, 0.8), bands: [{ type: 'bandpass', f: [[0, r(rng, 900, 1300)]], q: 3 }] }, 0.8, rng);
    }
    t += 0.2;
  }
  return t;
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
  'raven-croak': [raven, 0.42],
  'jay-call': [jay, 0.24],
  'gull-cry': [gull, 0.24],
  'sandpiper-peep': [sandpiper, 0.15],
  'owl-hoot': [owl, 0.3],
  'eagle-cry': [eagle, 0.28],
  'nightjar-churr': [nightjar, 0.25],
  'woodpecker-drum': [woodpecker, 0.45],
  'wing-flap': [wings, 0.18],
  'cat-meow': [meow, 0.35],
  'cat-purr': [purr, 0.3],
  'dog-boof': [boof, 0.45],
  'dog-howl': [dogHowl, 0.3],
  'wolf-howl': [wolf, 0.24],
  'elk-bugle': [elk, 0.3],
  'fox-bark': [fox, 0.38],
  'cow-moo': [moo, 0.4],
  'sheep-baa': [baa, 0.32],
  'horse-whinny': [whinny, 0.26],
  'squirrel-chatter': [squirrel, 0.26],
  'chicken-cluck': [cluck, 0.3],
  'deer-snort': [snort, 0.45],
  'bear-huff': [huff, 0.62],
} as const satisfies Record<string, readonly [CallVoice, number]>;

export type CallId = keyof typeof CALL_VOICES;

/** Longest any call runs (s). */
export const MAX_CALL_SECONDS = 7;
