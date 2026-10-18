import { describe, expect, it } from 'vitest';
import { swayOffsets } from './SwayMesh';

describe('sway offsets', () => {
  const rows = 12;
  const sample = (time: number, wind = 0.8, x = 300) => Array.from(swayOffsets(new Float32Array(rows), time, wind, x, 4, 1.1, 0.7, 'bottom'));

  it('keep the root still and move the free end most', () => {
    const o = sample(3.2);
    expect(o[rows - 1]).toBeCloseTo(0, 6);
    expect(Math.abs(o[0])).toBeGreaterThan(Math.abs(o[rows - 2]));
  });

  it('change smoothly frame to frame, never in whole-pixel snaps', () => {
    let prev = sample(0);
    let fractional = 0;
    for (let f = 1; f < 60 * 10; f++) {
      const o = sample(f / 60);
      for (let j = 0; j < rows; j++) {
        expect(Math.abs(o[j] - prev[j])).toBeLessThan(0.5);
        if (Math.abs(o[j] - Math.round(o[j])) > 0.05) fractional++;
      }
      prev = o;
    }
    expect(fractional).toBeGreaterThan(rows * 300);
  });

  it('sway neighbouring plants in turn as a gust rolls across', () => {
    const a = sample(10, 0.8, 100)[0];
    const b = sample(10, 0.8, 600)[0];
    expect(a).not.toBeCloseTo(b, 2);
  });
});
