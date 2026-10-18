import { describe, expect, it } from 'vitest';
import { gustLevel } from './Breeze';
import { chimneySmoking, farmhouseLit } from './Farmstead';

describe('life on the farm', () => {
  it('lights the farmhouse in the evening and on dark mornings, not by day', () => {
    expect(farmhouseLit(20, true)).toBe(true);
    expect(farmhouseLit(13, false)).toBe(false);
    expect(farmhouseLit(6.5, true)).toBe(true);
    expect(farmhouseLit(6.5, false)).toBe(false);
    expect(farmhouseLit(2, true)).toBe(false);
  });

  it('smokes at breakfast and teatime, and all day in the snow', () => {
    expect(chimneySmoking(7.5, false)).toBe(true);
    expect(chimneySmoking(13, false)).toBe(false);
    expect(chimneySmoking(13, true)).toBe(true);
    expect(chimneySmoking(19, false)).toBe(true);
  });

  it('rolls gusts across the grass downwind', () => {
    // Find a crest, then look for it a moment later: it has moved with the wind.
    const crestAt = (time: number, wind: number) => {
      let best = 0;
      let at = 0;
      for (let a = 0; a < 400; a += 1) {
        const v = gustLevel(a, 1400, time, wind);
        if (v > best) {
          best = v;
          at = a;
        }
      }
      return at;
    };
    const a = crestAt(0, 0.6);
    const b = crestAt(0.2, 0.6);
    expect(b).toBeGreaterThan(a);
    expect(crestAt(0.2, -0.6)).toBeLessThan(crestAt(0, -0.6) + 1);
    for (let t = 0; t < 5; t += 0.5) {
      const v = gustLevel(100, 1400, t, 0.4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
