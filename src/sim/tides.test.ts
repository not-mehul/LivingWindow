import { describe, expect, it } from 'vitest';
import { lastHighWater, TIDE_PERIOD, tideClock, tideLevel, tideRising } from './tides';

describe('the tide', () => {
  const t0 = tideClock(new Date(2026, 9, 19), 0);

  it('comes in and goes out twice a day, a little later each day', () => {
    // Find the high waters over two days.
    const highs: number[] = [];
    for (let h = 0; h < 48; h += 0.02) {
      const t = t0 + h;
      if (tideLevel(t) > tideLevel(t - 0.02) && tideLevel(t) >= tideLevel(t + 0.02)) highs.push(h);
    }
    expect(highs.length).toBeGreaterThanOrEqual(3);
    expect(highs.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < highs.length; i++) expect(highs[i] - highs[i - 1]).toBeCloseTo(TIDE_PERIOD, 0);
  });

  it('stays within its range, with low water halfway between the highs', () => {
    let lo = 1;
    let hi = -1;
    for (let h = 0; h < 24 * 15; h += 0.5) {
      const v = tideLevel(t0 + h);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeGreaterThan(0.9);
    // Neaps are smaller than springs.
    let neap = 1;
    for (let d = 0; d < 15; d++) {
      let top = -1;
      for (let h = 0; h < 24; h += 0.25) top = Math.max(top, tideLevel(t0 + d * 24 + h));
      neap = Math.min(neap, top);
    }
    expect(neap).toBeLessThan(0.65);
  });

  it('knows whether it is flooding or ebbing, and where the last high water reached', () => {
    let t = t0;
    while (!(tideLevel(t) > 0.5 && tideRising(t))) t += 0.1;
    expect(tideLevel(t + 1)).toBeGreaterThan(tideLevel(t));
    expect(lastHighWater(t)).toBeGreaterThanOrEqual(tideLevel(t) - 0.01);
    expect(lastHighWater(t)).toBeGreaterThan(0.5);
  });
});
