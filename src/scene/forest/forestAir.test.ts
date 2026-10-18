import { describe, expect, it } from 'vitest';
import { PixelBuffer } from '../../core/pixelBuffer';
import { mistDensity } from './ForestAtmosphere';
import { canopyGaps, generateForest } from './forestGenerator';

describe('the forest air', () => {
  it('lies thickest at dawn, burns off by midday and comes back at night, thicker in the damp', () => {
    expect(mistDensity(6.5, 0)).toBeGreaterThan(mistDensity(13, 0) * 2.5);
    expect(mistDensity(23, 0)).toBeGreaterThan(mistDensity(13, 0));
    expect(mistDensity(13, 1)).toBeGreaterThan(mistDensity(13, 0));
    for (let h = 0; h < 24; h += 0.5) {
      expect(mistDensity(h, 0)).toBeGreaterThanOrEqual(0);
      expect(mistDensity(h, 1)).toBeLessThanOrEqual(1);
    }
  });

  it('lets light down where the canopy is thinnest', () => {
    const full = (x: number, w: number) => {
      const art = new PixelBuffer(w, 80);
      art.rect(0, 0, w, 80, 0x336633);
      return { art, x, y: 0 };
    };
    // Leaves everywhere except a gap at 400..430.
    const gaps = canopyGaps([full(0, 400), full(430, 410)], 20, 56, 3);
    expect(gaps.some((g) => g >= 400 && g <= 430)).toBe(true);
  });

  it('has light shafts, dense trunks and a canopy in the generated wood', () => {
    const wood = generateForest(3141, new Date(2026, 5, 1));
    expect(wood.gaps.length).toBeGreaterThan(3);
    expect(wood.midTrees.filter((t) => t.still).length).toBeGreaterThan(20);
    expect(wood.canopy.length).toBeGreaterThan(30);
    expect(wood.trunks.length).toBeGreaterThan(20);
  });
});
