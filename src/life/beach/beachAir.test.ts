import { describe, expect, it } from 'vitest';
import { drawCoconut, heatShimmer, sandDrift, sprayHaze } from './BeachAir';

describe('the beach air', () => {
  it('blows sand only in a real wind, and not once the rain has wet it', () => {
    expect(sandDrift(0.1, 0)).toBe(0);
    expect(sandDrift(0.7, 0)).toBeGreaterThan(0.9);
    expect(sandDrift(-0.7, 0)).toBeGreaterThan(0.9);
    expect(sandDrift(0.7, 0.4)).toBe(0);
  });

  it('hangs more spray over a big sea', () => {
    expect(sprayHaze(1, 0.5)).toBeGreaterThan(sprayHaze(0.1, 0.1));
    expect(sprayHaze(1, 1)).toBeLessThanOrEqual(1);
  });

  it('shimmers only in the heat of a clear, still afternoon', () => {
    expect(heatShimmer(13.5, 0.1, 0, 0.1)).toBeGreaterThan(0.6);
    expect(heatShimmer(8, 0.1, 0, 0.1)).toBe(0);
    expect(heatShimmer(13.5, 0.9, 0, 0.1)).toBe(0);
    expect(heatShimmer(13.5, 0.1, 0.5, 0.1)).toBe(0);
  });

  it('draws a round coconut, lit on top', () => {
    const nut = drawCoconut(5);
    expect(nut.isSet(3, 3)).toBe(true);
    const top = nut.get(3, 2);
    const bottom = nut.get(3, 5);
    expect(top).not.toBe(bottom);
  });
});
