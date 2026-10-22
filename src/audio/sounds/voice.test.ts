import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/random';
import { Stereo } from '../synth';
import { CALL_VOICES, type CallId } from './calls';
import { breathe, smooth, trackAt, vocalise } from './voice';

const SR = 22050;

function render(id: CallId, seed: number): Float32Array {
  const out = new Stereo(SR * 7, SR);
  const length = CALL_VOICES[id][0](out, createRng(seed));
  return out.left.slice(0, Math.ceil((length + 0.1) * SR));
}

/**
 * The worst leap of loudness out of near-silence within one millisecond: a
 * click or pop, as the ear hears one (a quick attack still takes a few ms).
 */
function worstPop(data: Float32Array): number {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return 0;
  const w = Math.round(SR * 0.001);
  let previous = 0;
  let worst = 0;
  for (let i = 0; i + w <= data.length; i += w) {
    let m = 0;
    for (let k = i; k < i + w; k++) m = Math.max(m, Math.abs(data[k]));
    const level = m / peak;
    if (previous < 0.01) worst = Math.max(worst, level);
    previous = level;
  }
  return worst;
}

describe('voice', () => {
  it('reads tracks smoothly, in log or linear steps', () => {
    expect(trackAt([[0, 100], [1, 400]], 0.5)).toBeCloseTo(200, 0);
    expect(trackAt([[0, 0], [1, 1]], 0.5, false)).toBeCloseTo(0.5, 5);
    expect(trackAt([[0.2, 3], [0.8, 5]], 0)).toBe(3);
    expect(smooth(0.1, 0.1)(0)).toBe(0);
    expect(smooth(0.1, 0.1)(0.5)).toBe(1);
  });

  it('voices and breathes finitely, the same for the same seed', () => {
    const take = (seed: number) => {
      const out = new Stereo(SR, SR);
      const rng = createRng(seed);
      vocalise(out, 0.05, { length: 0.6, pitch: [[0, 300], [1, 450]], envelope: smooth(0.1, 0.3), sub: 0.5, breath: 0.3, jitter: 0.03, formants: [[0, [{ f: 800, q: 3, gain: 1 }]], [1, [{ f: 1200, q: 3, gain: 1 }]]] }, 1, rng);
      breathe(out, 0.7, { length: 0.2, envelope: smooth(0.2, 0.5), bands: [{ type: 'bandpass', f: [[0, 600], [1, 900]], q: 1 }], body: [120, 0.5] }, 1, rng);
      return out.left;
    };
    const a = take(1);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(a.some((v) => Math.abs(v) > 0.01)).toBe(true);
    expect(take(1)).toEqual(a);
    expect(take(2)).not.toEqual(a);
  });
});

describe('calls', () => {
  const ids = Object.keys(CALL_VOICES) as CallId[];
  const SMOOTH: CallId[] = [
    'raven-croak', 'jay-call', 'gull-cry', 'eagle-cry', 'nightjar-churr', 'wing-flap', 'wolf-howl',
    'cat-meow', 'dog-boof', 'dog-howl', 'elk-bugle', 'fox-bark', 'sheep-baa', 'horse-whinny', 'squirrel-chatter', 'chicken-cluck', 'deer-snort', 'bear-huff',
  ];

  it('never pops out of silence', () => {
    // Sharp chips (a chickadee's, a sandpiper's) and a purr's pulses rise fast by nature; a pop rises faster still.
    for (const id of ids) for (const seed of [1, 2]) expect(worstPop(render(id, seed)), `${id} seed ${seed}`).toBeLessThan(0.6);
    // The calls that were heard to click, rebuilt, ease in.
    for (const id of SMOOTH) for (const seed of [1, 2, 3]) expect(worstPop(render(id, seed)), `${id} seed ${seed}`).toBeLessThan(0.2);
  });

  it('differs from take to take', () => {
    for (const id of ids) {
      const a = render(id, 11);
      const b = render(id, 12);
      const same = a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
      expect(same, id).toBe(false);
    }
  });
});
