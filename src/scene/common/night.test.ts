import { describe, expect, it } from 'vitest';
import { luminance } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { gradeColor, nightVariant } from './night';

describe('night grading', () => {
  const sand = { desaturate: 0.85, tint: [0.52, 0.52, 0.6], lift: [12, 12, 24] } as const;

  it('drains colour, casts it cool, and keeps it readable', () => {
    const night = gradeColor(0xe6d09e, sand);
    const r = night >> 16;
    const b = night & 255;
    expect(b).toBeGreaterThan(r);
    expect(luminance(night)).toBeGreaterThan(0.35);
    expect(luminance(night)).toBeLessThan(luminance(0xe6d09e));
  });

  it('keeps the shape of a layer, grading only its drawn pixels', () => {
    const art = new PixelBuffer(3, 1);
    art.set(0, 0, 0x80a040);
    art.set(2, 0, 0x80a040);
    const night = nightVariant(art, sand);
    expect(night.isSet(1, 0)).toBe(false);
    expect(night.get(0, 0)).toBe(gradeColor(0x80a040, sand));
    expect(night.get(2, 0)).toBe(night.get(0, 0));
  });
});
