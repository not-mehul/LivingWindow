import { describe, expect, it } from 'vitest';
import type { Stereo } from '../synth';
import { bass, bell, crackle, guitar, hat, kick, pad, rhodes, rim, shaker, snare } from './instruments';
import { midiToFrequency } from './music';

const RATE = 22050;
const peak = (s: Stereo) => {
  let p = 0;
  for (let i = 0; i < s.length; i++) p = Math.max(p, Math.abs(s.left[i]), Math.abs(s.right[i]));
  return p;
};

/** Fundamental by autocorrelation: the lag (within 40–1000 Hz) where the signal best matches itself. */
function pitchOf(data: Float32Array, from: number, to: number, rate: number): number {
  let best = 0;
  let bestLag = 1;
  for (let lag = Math.floor(rate / 1000); lag < rate / 40; lag++) {
    let sum = 0;
    for (let i = from; i < to - lag; i++) sum += data[i] * data[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  // Refine between samples with a parabola through the peak.
  const at = (lag: number) => {
    let sum = 0;
    for (let i = from; i < to - lag; i++) sum += data[i] * data[i + lag];
    return sum;
  };
  const [a, b, c] = [at(bestLag - 1), at(bestLag), at(bestLag + 1)];
  const shift = (a - c) / (2 * (a - 2 * b + c));
  return rate / (bestLag + (Number.isFinite(shift) ? shift : 0));
}

describe('lofi instruments', () => {
  it('renders every instrument audibly and without clipping', () => {
    const all: Record<string, Stereo> = {
      rhodes: rhodes(60, 1, RATE),
      bass: bass(40, RATE),
      kick: kick(RATE),
      snare: snare(RATE),
      rim: rim(RATE),
      hat: hat(RATE, false),
      openHat: hat(RATE, true),
      shaker: shaker(RATE),
      guitar: guitar(69, RATE),
      bell: bell(72, RATE),
      pad: pad([57, 60, 64, 67], 2, RATE),
      crackle: crackle(3, RATE, 1),
    };
    for (const [name, s] of Object.entries(all)) {
      const p = peak(s);
      expect(p, name).toBeGreaterThan(0.01);
      expect(p, name).toBeLessThan(0.9);
    }
  });

  it('plays harder notes louder and brighter', () => {
    expect(peak(rhodes(60, 1, RATE))).toBeGreaterThan(peak(rhodes(60, 0.3, RATE)));
  });

  it('tunes the plucked guitar to its note', () => {
    for (const midi of [64, 69, 76]) {
      const s = guitar(midi, RATE);
      const f = pitchOf(s.left, RATE * 0.2, RATE * 0.5, RATE);
      expect(Math.abs(1200 * Math.log2(f / midiToFrequency(midi)))).toBeLessThan(15);
    }
  });

  it('tunes the bass to its note', () => {
    const s = bass(45, RATE);
    const f = pitchOf(s.left, RATE * 0.2, RATE * 0.5, RATE);
    expect(Math.abs(1200 * Math.log2(f / midiToFrequency(45)))).toBeLessThan(25);
  });

  it('gives every record its own crackle', () => {
    expect(crackle(1, RATE, 1).left).not.toEqual(crackle(1, RATE, 2).left);
  });
});
