import { addBubble, addTone, Biquad, panGains, pluck, poissonTimes, type Stereo } from '../synth';
import { burst, scattered, type TextureSpec } from '../textures';

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

/**
 * A field of crickets: each one chirps on its own steady beat (a whole
 * number of chirps per loop, so the loop never trips a rhythm), every chirp
 * a short train of pulses of a pure, high tone.
 */
export function crickets(voices: number): TextureSpec {
  return {
    seconds: 12,
    render: (out, rng) => {
      const seconds = out.seconds;
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng);
        const pitch = 3900 + rng() * 1300;
        const count = Math.round(seconds * (1.1 + rng() * 1.6));
        const period = seconds / count;
        const pulses = 3 + Math.floor(rng() * 2);
        const phase = rng() * period;
        const pulse = (u: number) => Math.min(1, u * 5, (1 - u) * 3);
        for (let c = 0; c < count; c++) {
          const t = phase + c * period + (rng() - 0.5) * 0.02;
          for (let p = 0; p < pulses; p++) {
            addTone(out, t + p * 0.031, 0.018, pitch, pitch * 0.995, 0.5 * level, pan, pulse, [[2, 0.08]]);
          }
        }
      }
    },
  };
}

/** Katydids in the trees: dry, rasping "ch-chk-chk" calls, high and buzzy. */
export function katydids(voices: number): TextureSpec {
  return {
    seconds: 12,
    render: (out, rng) => {
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng, 0.8);
        const count = Math.round(out.seconds * (0.6 + rng() * 0.4));
        const period = out.seconds / count;
        const freq = 6500 + rng() * 3500;
        const rasps = 2 + Math.floor(rng() * 2);
        const phase = rng() * period;
        for (let c = 0; c < count; c++) {
          let t = phase + c * period;
          for (let r = 0; r < rasps; r++) {
            burst(out, t, pan, rng, 'bandpass', freq, 2.5, 2 * level, 0.045 + rng() * 0.02);
            t += 0.09 + rng() * 0.03;
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

/** A buzzy source (a few harmonics of `f0` Hz) through a formant, enveloped: one throaty pulse. */
function voiced(out: Stereo, t: number, length: number, f0: number, glide: number, formant: number, q: number, peak: number, pan: number): void {
  const sr = out.sampleRate;
  const start = Math.round(t * sr);
  const n = Math.round(length * sr);
  const filter = Biquad.make('bandpass', formant, q, sr);
  const [gl, gr] = panGains(pan);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (f0 * (1 + glide * u)) / sr;
    // A band-limited-ish sawtooth: the first eight harmonics.
    let saw = 0;
    for (let h = 1; h <= 8; h++) saw += Math.sin(2 * Math.PI * h * phase) / h;
    const env = Math.min(1, u * 8) * (1 - u) ** 1.5;
    out.add(start + i, filter.process(saw) * env * peak, gl, gr);
  }
}

/** Frogs along the creek at dusk: a loose, conversational chorus of two- and three-pulse croaks. */
export function frogs(voices: number): TextureSpec {
  return {
    seconds: 16,
    render: (out, rng) => {
      for (let v = 0; v < voices; v++) {
        const { pan, level } = place(rng, 0.6);
        const pitch = 150 + rng() * 200;
        // Each frog calls in short bouts, then sits quiet.
        let t = rng() * 3;
        while (t < out.seconds) {
          const bout = 2 + Math.floor(rng() * 4);
          for (let b = 0; b < bout && t < out.seconds; b++) {
            const pulses = 2 + Math.floor(rng() * 2);
            for (let p = 0; p < pulses; p++) voiced(out, t + p * (0.085 + rng() * 0.02), 0.07, pitch * 0.94, 0.12, pitch * 3.2, 3, level, pan);
            t += 0.5 + rng() * 0.5;
          }
          t += 2 + rng() * 5;
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

/** Foam fizzing as a wave spreads up the sand: countless tiny, bright bubbles. */
export function foam(): TextureSpec {
  return {
    seconds: 8,
    render: (out, rng) => {
      for (const t of poissonTimes(out.seconds, 420, rng)) {
        const pan = (rng() * 2 - 1) * 0.9;
        if (rng() < 0.7) addBubble(out, t, 2200 * (7000 / 2200) ** rng(), 0.004 + rng() * 0.01, 0.25 * (0.3 + rng() * 0.7), pan, 1.4);
        else burst(out, t, pan, rng, 'highpass', 5000, 0.7, 0.3, 0.004);
      }
    },
  };
}

/** Backwash dragging through sand and shingle: a fine rattle of tiny stones. */
export function shingle(): TextureSpec {
  return scattered(260, (out, t, pan, rng) => burst(out, t, pan, rng, 'bandpass', 2500 + rng() * 4500, 2, 0.4 + rng() * 0.8, 0.006));
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

/** Vowel formant pairs (F1, F2) a crowd's syllables are drawn from. */
const VOWELS: ReadonlyArray<readonly [number, number]> = [
  [730, 1090],
  [530, 1840],
  [270, 2290],
  [570, 840],
  [440, 1020],
  [660, 1720],
];

/**
 * A crowd heard from up high: many voices talking at once, each a stream of
 * voiced syllables through shifting vowel formants, blurred together by
 * distance into a soft murmur with no words in it.
 */
export function murmur(): TextureSpec {
  return {
    seconds: 13,
    render: (out, rng) => {
      const sr = out.sampleRate;
      for (let v = 0; v < 8; v++) {
        const { pan, level } = place(rng, 0.85);
        const [gl, gr] = panGains(pan);
        const f0 = rng() < 0.5 ? 95 + rng() * 40 : 170 + rng() * 60;
        const air = Biquad.make('lowpass', 1800, 0.7, sr);
        let phase = 0;
        let t = rng() * 2;
        while (t < out.seconds) {
          const syllables = 3 + Math.floor(rng() * 9);
          for (let s = 0; s < syllables; s++) {
            const length = 0.09 + rng() * 0.16;
            const [a, b] = VOWELS[Math.floor(rng() * VOWELS.length)];
            const f1 = Biquad.make('bandpass', a, 5, sr);
            const f2 = Biquad.make('bandpass', b, 7, sr);
            const pitch = f0 * (0.9 + rng() * 0.25);
            const loud = (0.3 + rng() * 0.3) * level;
            const start = Math.round(t * sr);
            const n = Math.round(length * sr);
            for (let i = 0; i < n; i++) {
              phase += pitch / sr;
              const saw = 2 * (phase - Math.floor(phase)) - 1;
              const env = Math.sin((Math.PI * i) / n) ** 0.6;
              out.add(start + i, air.process(f1.process(saw) + 0.6 * f2.process(saw)) * env * loud, gl, gr);
            }
            t += length;
          }
          // A pause to listen.
          t += 0.4 + rng() * 2;
        }
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
