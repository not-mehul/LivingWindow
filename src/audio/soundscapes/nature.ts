import { addBubble, addNoiseBurst, addTone, Biquad, panGains, pluck, poissonTimes, type Stereo } from '../synth';
import { burst, wash, type TextureSpec } from '../textures';

/*
 * The living textures of each landscape — insects, frogs, water, far-off
 * birds and voices — synthesized sample by sample into seamless loops (see
 * TextureLayer), each built from many small, individually varied events.
 */

/** Where one member of a chorus sits: its pan, and a level that falls with distance. */
function place(rng: () => number, width = 0.9): { pan: number; level: number } {
  const distance = 0.15 + rng() * 0.85;
  return { pan: (rng() * 2 - 1) * width, level: 1 / (1 + 3 * distance) };
}

/** A soft bell of a pulse: rises and falls with no corner anywhere (u: 0..1). */
const bell = (u: number) => Math.sin(Math.PI * u) ** 2;

/**
 * One field cricket, chirping on its own steady beat (a whole number of
 * chirps per loop, so the loop never trips a rhythm). Each chirp is a short
 * run of pulses, one per closing of the wings, about forty a second, of a
 * pure tone near 2.3 kHz with a little of its octave: swelling and fading
 * across the chirp, and settling a touch flat within each pulse.
 */
function cricket(out: Stereo, rng: () => number, pitch: number, level: number, pan: number): void {
  const count = Math.round(out.seconds * (1.5 + rng() * 1.5));
  const period = out.seconds / count;
  const pulses = 3 + Math.floor(rng() * 4);
  const gap = 0.022 + rng() * 0.007;
  const phase = rng() * period;
  for (let c = 0; c < count; c++) {
    const t = phase + c * period + (rng() - 0.5) * 0.012;
    for (let p = 0; p < pulses; p++) {
      const swell = Math.sin((Math.PI * (p + 0.5)) / pulses) ** 0.5 * (0.8 + 0.2 * rng());
      addTone(out, t + p * gap, gap * 0.7, pitch * 1.008, pitch * 0.99, 0.5 * level * swell, pan, bell, [[2, 0.3], [3, 0.12]]);
    }
  }
}

/**
 * A field of crickets, after a recording: a few near enough to pick out,
 * over a far chorus of so many more that their chirps blur into one steady
 * shimmer. Crickets in one field sing at nearly one pitch (it follows the
 * warmth of the night), each a little off it.
 */
export function crickets(voices: number): TextureSpec {
  return {
    seconds: 12,
    render: (out, rng) => {
      const pitch = 2200 + rng() * 300;
      for (let v = 0; v < 16; v++) cricket(out, rng, pitch * (0.96 + rng() * 0.08), 0.1 + rng() * 0.08, (rng() * 2 - 1) * 0.9);
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng);
        cricket(out, rng, pitch * (0.95 + rng() * 0.1), level, pan);
      }
    },
  };
}

/**
 * One stroke of a katydid's wings, its file of teeth dragged across the
 * scraper: a fast run of tooth strikes, each a tick of noise ringing at the
 * wing's resonance, swelling through the stroke.
 */
function rasp(out: Stereo, t: number, length: number, freq: number, teeth: number, peak: number, pan: number, rng: () => number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const [gl, gr] = panGains(pan);
  const body = Biquad.make('bandpass', freq, 2.2, sr);
  const air = Biquad.make('bandpass', freq * 2.8, 2.5, sr);
  let phase = rng();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (teeth * (0.85 + 0.3 * u)) / sr;
    const strike = (0.5 + 0.5 * Math.cos(2 * Math.PI * phase)) ** 4;
    const noise = rng() * 2 - 1;
    const v = body.process(noise) * (0.35 + 0.65 * strike) + 0.4 * air.process(noise) * strike;
    out.add(start + i, v * Math.sin(Math.PI * u) ** 0.8 * (0.55 + 0.45 * u) * peak, gl, gr);
  }
}

/**
 * Katydids in the trees, after a recording: each calls about once a second,
 * a dry "ch-chk-chk" of two to four raspy strokes near 5 kHz, and now and
 * then skips a beat.
 */
export function katydids(voices: number): TextureSpec {
  return {
    seconds: 12,
    render: (out, rng) => {
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng, 0.8);
        const count = Math.round(out.seconds / (1.05 + rng() * 0.45));
        const period = out.seconds / count;
        const freq = 4800 + rng() * 900;
        const teeth = 180 + rng() * 120;
        const strokes = 2 + Math.floor(rng() * 3);
        const phase = rng() * period;
        for (let c = 0; c < count; c++) {
          if (rng() < 0.25) continue;
          let t = phase + c * period + (rng() - 0.5) * 0.04;
          for (let k = 0; k < strokes; k++) {
            const length = 0.07 + rng() * 0.04;
            rasp(out, t, length, freq * (0.97 + rng() * 0.06), teeth, 3 * level, pan, rng);
            t += length + 0.02 + rng() * 0.02;
          }
        }
      }
    },
  };
}

/**
 * Tree crickets' endless soft trill: a steady tone, pulsed fifty times a
 * second (both rates fit the loop exactly, so it never breaks step).
 */
export function trill(): TextureSpec {
  return {
    seconds: 10,
    render: (out, rng) => {
      const seconds = out.seconds;
      for (let v = 0; v < 2; v++) {
        const { pan, level } = place(rng, 0.7);
        const carrier = Math.round((2700 + rng() * 400) * seconds) / seconds;
        const rate = Math.round((44 + rng() * 10) * seconds) / seconds;
        const [gl, gr] = panGains(pan);
        for (let i = 0; i < out.length; i++) {
          const t = i / out.sampleRate;
          const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t);
          out.add(i, Math.sin(2 * Math.PI * carrier * t) * am * level, gl, gr);
        }
      }
    },
  };
}

/**
 * A chorus frog's call: a run of short pulses (sixty to eighty a second) of
 * a voice whose second harmonic, near 2.5 kHz, carries it, swelling as the
 * throat sac fills and rising a little in pitch.
 */
function frogTrill(out: Stereo, t: number, length: number, f0: number, rate: number, peak: number, pan: number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const [gl, gr] = panGains(pan);
  const duty = 0.55;
  let phase = 0;
  let beat = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (f0 * (1 + 0.05 * u)) / sr;
    beat += rate / sr;
    const b = beat - Math.floor(beat);
    const pulse = b < duty ? bell(b / duty) : 0;
    const th = 2 * Math.PI * phase;
    const voice = 0.4 * Math.sin(th) + Math.sin(2 * th + 0.4) + 0.25 * Math.sin(3 * th + 1.1);
    out.add(start + i, voice * pulse * (0.3 + 0.7 * u) * Math.min(1, (1 - u) * 12) * peak, gl, gr);
  }
}

/** A frog's harsher "crick": a short buzz of noise, pulsed, as one squabbles with a neighbour. */
function crick(out: Stereo, t: number, length: number, peak: number, pan: number, rng: () => number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const [gl, gr] = panGains(pan);
  const band = Biquad.make('bandpass', 2400 + rng() * 600, 1.2, sr);
  const rate = 90 + rng() * 40;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const b = ((i * rate) / sr) % 1;
    out.add(start + i, band.process(rng() * 2 - 1) * (0.5 + 0.5 * bell(b)) * bell(u) * peak, gl, gr);
  }
}

/**
 * Frogs along the creek at dusk, after a recording: a loose chorus of
 * trilling calls, each frog calling in bouts and then sitting quiet, now
 * and then a harsher crick between them.
 */
export function frogs(voices: number): TextureSpec {
  return {
    seconds: 16,
    render: (out, rng) => {
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng, 0.6);
        const f0 = 1100 + rng() * 180;
        const rate = 60 + rng() * 20;
        let t = rng() * 3;
        while (t < out.seconds) {
          const bout = 3 + Math.floor(rng() * 6);
          for (let b = 0; b < bout && t < out.seconds; b++) {
            if (rng() < 0.1) crick(out, t, 0.08 + rng() * 0.08, 1.4 * level, pan, rng);
            else frogTrill(out, t, 0.3 + rng() * 0.25, f0 * (0.97 + rng() * 0.06), rate, level, pan);
            t += 0.9 + rng() * 0.8;
          }
          t += 2 + rng() * 6;
        }
      }
    },
  };
}

/**
 * A babbling creek: a steady stream of bubbles of every size over the
 * stones, with deeper gurgles where it pours between them.
 */
export function creek(): TextureSpec {
  return {
    seconds: 10,
    render: (out, rng) => {
      for (const t of poissonTimes(out.seconds, 140, rng)) {
        const pan = (rng() * 2 - 1) * 0.7;
        const deep = rng() < 0.12;
        const f = deep ? 180 * (600 / 180) ** rng() : 600 * (2600 / 600) ** rng();
        addBubble(out, t, f, 0.012 + 0.04 * rng() * Math.sqrt(900 / f), (deep ? 0.6 : 0.3) * (0.3 + rng() * 0.7), pan, 1.3 + rng() * 0.6);
      }
    },
  };
}

/** A slow random wander with a spread of about one (one-pole smoothed noise, cutoff `hz`). */
function wander(rng: () => number, hz: number, sampleRate: number): () => number {
  const a = Math.min(1, (2 * Math.PI * hz) / sampleRate);
  const norm = 1 / Math.sqrt(a / (2 - a) / 3);
  let y = 0;
  return () => (y += a * (rng() * 2 - 1 - y)) * norm;
}

/**
 * Foam fizzing as a wave spreads up the sand, after a recording: so many
 * tiny bubbles bursting that they merge into a soft, bright hiss with only
 * a fine grain to it, now and then one bubble a little clearer than the rest.
 */
export function foam(): TextureSpec {
  return {
    seconds: 8,
    render: (out, rng) => {
      const sr = out.sampleRate;
      for (const pan of [-0.75, 0, 0.75]) {
        const low = Biquad.make('highpass', 1400, 0.6, sr);
        const high = Biquad.make('lowpass', 9000, 0.5, sr);
        const grain = wander(rng, 70, sr);
        const surge = wander(rng, 2.5, sr);
        wash(out, pan, () => high.process(low.process(rng() * 2 - 1)) * Math.max(0, 1 + 0.4 * grain() + 0.25 * surge()));
      }
      for (const t of poissonTimes(out.seconds, 40, rng)) {
        const f = 3000 * (7500 / 3000) ** rng();
        addTone(out, t, 0.006 + rng() * 0.01, f, f * 1.3, 0.04 + rng() * 0.05, (rng() * 2 - 1) * 0.9, bell);
      }
    },
  };
}

/**
 * The backwash dragging down through the shingle, after a recording: a dense
 * "shhh-rrr" of countless small stones rolling over one another, rougher than
 * the foam and coming in surges, but never a crackle of single ticks.
 */
export function shingle(): TextureSpec {
  return {
    seconds: 9,
    render: (out, rng) => {
      const sr = out.sampleRate;
      for (const pan of [-0.7, 0, 0.7]) {
        const band = Biquad.make('bandpass', 2000, 0.45, sr);
        const grain = wander(rng, 140, sr);
        const surge = wander(rng, 9, sr);
        wash(out, pan, () => band.process(rng() * 2 - 1) * Math.max(0, 1 + 0.6 * grain() + 0.35 * surge()));
      }
      for (const t of poissonTimes(out.seconds, 900, rng)) {
        addNoiseBurst(out, t, 0.004 + rng() * 0.004, Biquad.make('bandpass', 1500 + rng() * 4500, 1.5, sr), 0.05 + rng() * 0.06, (rng() * 2 - 1) * 0.8, rng);
      }
    },
  };
}

/**
 * Birds far off in every direction: a soft wash of small chirps and
 * whistles, too distant to pick out one singer, that thickens at dawn.
 */
export function distantBirds(): TextureSpec {
  return {
    seconds: 14,
    render: (out, rng) => {
      for (const t0 of poissonTimes(out.seconds, 7, rng)) {
        const { pan, level } = place(rng);
        const notes = 1 + Math.floor(rng() * 4);
        const base = 2200 + rng() * 3800;
        let t = t0;
        for (let n = 0; n < notes; n++) {
          const length = 0.04 + rng() * 0.12;
          addTone(out, t, length, base * (0.85 + rng() * 0.3), base * (0.7 + rng() * 0.6), 0.25 * level, pan, pluck(0.3, 4));
          t += length + 0.03 + rng() * 0.08;
        }
      }
    },
  };
}

/** Vowel formants (F1, F2, F3 in Hz) a crowd's syllables are drawn from. */
const VOWELS: ReadonlyArray<readonly [number, number, number]> = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [440, 1020, 2240],
  [660, 1720, 2410],
  [300, 870, 2240],
  [490, 1350, 1690],
];

/** A sawtooth's step, smoothed so it doesn't alias (polyBLEP): `t` is the phase, `dt` its step. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * One talker in a crowd: phrases of syllables, each an optional consonant
 * (a hiss or a burst of breath) then a voiced vowel gliding into the next,
 * the pitch rising and falling with the sense and sinking at each phrase's
 * end; pauses to listen; now and then a laugh.
 */
function talker(out: Stereo, rng: () => number, pan: number, level: number): void {
  const sr = out.sampleRate;
  const [gl, gr] = panGains(pan);
  const base = rng() < 0.5 ? 100 + rng() * 40 : 180 + rng() * 60;
  const glottis = Biquad.make('lowpass', 2200, 0.5, sr);
  const formants = VOWELS[0].map((f, k) => Biquad.make('bandpass', f, [5, 8, 10][k], sr));
  const hiss = Biquad.make('bandpass', 4000, 1.2, sr);
  let phase = rng();
  let previous = 0;
  let vowel = VOWELS[Math.floor(rng() * VOWELS.length)];
  let t = rng() * 2;
  while (t < out.seconds) {
    const laugh = rng() < 0.07;
    const syllables = laugh ? 3 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 10);
    const lift = laugh ? 1.5 : 1 + rng() * 0.15;
    for (let k = 0; k < syllables; k++) {
      const length = laugh ? 0.16 + rng() * 0.05 : 0.12 + rng() * 0.14;
      const next = laugh ? VOWELS[0] : VOWELS[Math.floor(rng() * VOWELS.length)];
      const consonant = laugh ? 0.05 : rng() < 0.6 ? 0.02 + rng() * 0.05 : 0;
      if (consonant) hiss.tune('bandpass', 2500 + rng() * 3500, 1.2);
      // The phrase's tune: a lift at the start, a fall towards its end.
      const contour = lift * (1.08 - (0.18 * k) / syllables) * (0.94 + rng() * 0.12);
      const loud = (0.5 + rng() * 0.5) * level;
      const start = Math.round(t * sr);
      const n = Math.round(length * sr);
      const c = Math.round(consonant * sr);
      for (let i = 0; i < n; i++) {
        const u = i / n;
        if (i % 128 === 0) for (let f = 0; f < 3; f++) formants[f].tune('bandpass', vowel[f] + (next[f] - vowel[f]) * u, [5, 8, 10][f]);
        const f0 = base * contour * (1 + 0.04 * Math.sin(Math.PI * u));
        const dt = f0 / sr;
        phase += dt;
        if (phase >= 1) phase -= 1;
        const source = glottis.process(2 * phase - 1 - blep(phase, dt));
        const voiced = i < c ? 0 : Math.sin((Math.PI * (i - c)) / (n - c));
        const vocal = formants[0].process(source) + 0.8 * formants[1].process(source) + 0.5 * formants[2].process(source) + 0.15 * source;
        // The mouth radiates the higher partials more strongly (a gentle rise with frequency).
        let v = (vocal - 0.85 * previous) * voiced * 6;
        previous = vocal;
        const breath = laugh ? 0.5 * voiced : i < c ? Math.sin((Math.PI * i) / c) : 0;
        if (breath > 0) v += hiss.process(rng() * 2 - 1) * breath * 0.45;
        out.add(start + i, v * loud, gl, gr);
      }
      vowel = next;
      t += length;
    }
    // A pause to listen.
    t += 0.3 + rng() * 1.6;
  }
}

/**
 * A crowd heard from up high, after a recording: many people talking at
 * once, near and far, blurred together by distance into a murmur with no
 * words in it, only the rise and fall of voices and the odd laugh.
 */
export function murmur(): TextureSpec {
  return {
    seconds: 13,
    render: (out, rng) => {
      for (let v = 0; v < 14; v++) {
        const { pan, level } = place(rng, 0.85);
        talker(out, rng, pan, level);
      }
    },
  };
}

/** Grasshoppers in the warm grass: short, dry ratchets of clicks. */
export function grasshoppers(): TextureSpec {
  return {
    seconds: 14,
    render: (out, rng) => {
      for (const t of poissonTimes(out.seconds, 0.7, rng)) {
        const { pan, level } = place(rng);
        const clicks = 8 + Math.floor(rng() * 14);
        const rate = 18 + rng() * 14;
        const freq = 5500 + rng() * 4000;
        for (let c = 0; c < clicks; c++) burst(out, t + c / rate, pan, rng, 'bandpass', freq, 3, level, 0.008);
      }
    },
  };
}
