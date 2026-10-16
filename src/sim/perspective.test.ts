import { describe, expect, it } from 'vitest';
import { depthForScale, MIN_SCALE, perspectiveScale, spriteSizeAt } from './perspective';

describe('perspective', () => {
  it('follows S(z) = Smin + (1 − Smin)(1 − z)²', () => {
    expect(perspectiveScale(0)).toBe(1);
    expect(perspectiveScale(1)).toBe(MIN_SCALE);
    expect(perspectiveScale(0.5)).toBeCloseTo(MIN_SCALE + (1 - MIN_SCALE) * 0.25);
  });

  it('gives the design document LOD sizes: 48 px on the sill, ~16 px mid, 6 px far', () => {
    expect(spriteSizeAt(0)).toBe(48);
    expect(spriteSizeAt(0.4)).toBeGreaterThanOrEqual(16);
    expect(spriteSizeAt(0.4)).toBeLessThanOrEqual(24);
    expect(spriteSizeAt(1)).toBe(6);
  });

  it('shrinks monotonically with depth and never below 4 px', () => {
    let previous = Infinity;
    for (let z = 0; z <= 1; z += 0.05) {
      const size = spriteSizeAt(z, 0.6);
      expect(size).toBeLessThanOrEqual(previous);
      expect(size).toBeGreaterThanOrEqual(4);
      previous = size;
    }
  });
});

describe('depthForScale', () => {
  it('inverts perspectiveScale', () => {
    for (const z of [0, 0.2, 0.5, 0.8, 1]) expect(depthForScale(perspectiveScale(z))).toBeCloseTo(z);
    expect(depthForScale(5)).toBe(0);
    expect(depthForScale(0)).toBe(1);
  });
});
