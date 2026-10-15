import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { GAIN_VARIATION, PITCH_VARIATION, spatialParams, thunderParams } from './spatial';

describe('spatialParams', () => {
  it('pans to the source position and clamps it', () => {
    expect(spatialParams(-1, 0).pan).toBe(-1);
    expect(spatialParams(0.4, 0).pan).toBe(0.4);
    expect(spatialParams(3, 0).pan).toBe(1);
  });

  it('keeps random pitch within ±8% and gain within ±15%', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const { playbackRate, gain } = spatialParams(0, 0, rng);
      expect(Math.abs(playbackRate - 1)).toBeLessThanOrEqual(PITCH_VARIATION);
      expect(Math.abs(gain - 1)).toBeLessThanOrEqual(GAIN_VARIATION);
    }
  });

  it('varies from play to play', () => {
    const rng = createRng(4);
    const rates = new Set(Array.from({ length: 20 }, () => spatialParams(0, 0, rng).playbackRate));
    expect(rates.size).toBeGreaterThan(15);
  });

  it('makes distant sounds quieter and duller', () => {
    const fixed = () => 0.5; // no random variation
    const near = spatialParams(0, 0, fixed);
    const mid = spatialParams(0, 0.5, fixed);
    const far = spatialParams(0, 1, fixed);
    expect(mid.gain).toBeLessThan(near.gain);
    expect(far.gain).toBeLessThan(mid.gain);
    expect(far.cutoff).toBeLessThan(mid.cutoff);
    expect(mid.cutoff).toBeLessThan(near.cutoff);
    expect(near.cutoff).toBeCloseTo(18000);
  });
});

describe('thunderParams', () => {
  it('delays and softens distant thunder', () => {
    const close = thunderParams(1, 0);
    const far = thunderParams(1, 1);
    expect(close.delay).toBeLessThan(0.5);
    expect(far.delay).toBeGreaterThan(5);
    expect(far.gain).toBeLessThan(close.gain);
    expect(far.cutoff).toBeLessThan(close.cutoff);
    expect(far.duration).toBeGreaterThan(close.duration);
  });
});
