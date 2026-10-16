import { describe, expect, it } from 'vitest';
import { luminance } from '../core/color';
import { computeLighting, windowsLitAt } from './lighting';

const clear = { cloudCover: 0, lightning: 0, precipitation: 0 };
const overcast = { cloudCover: 1, lightning: 0, precipitation: 0 };
const storm = { cloudCover: 1, lightning: 1, precipitation: 1 };

describe('computeLighting', () => {
  it('is bright at midday and dark at midnight', () => {
    const noon = computeLighting(13, clear);
    const midnight = computeLighting(0, clear);
    expect(noon.ambient).toBe(0xffffff);
    expect(noon.darkness).toBe(0);
    expect(midnight.darkness).toBeGreaterThan(0.9);
    expect(midnight.nightness).toBeGreaterThan(0.9);
    expect(noon.nightness).toBe(0);
    expect(noon.twilight).toBe(0);
    expect(midnight.twilight).toBeLessThan(0.1);
    expect(computeLighting(18.8, clear).twilight).toBeGreaterThan(0.6);
    expect(computeLighting(5.9, clear).twilight).toBeGreaterThan(0.6);
    // Moonlit, not murky: the night lifts towards a readable blue.
    expect(luminance(midnight.ambient)).toBeGreaterThan(0.3);
    expect(luminance(midnight.skyTop)).toBeLessThan(0.1);
    expect(noon.stars).toBe(0);
    expect(midnight.stars).toBe(1);
  });

  it('changes continuously through the day, including across midnight', () => {
    let previous = computeLighting(0, clear);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const next = computeLighting(h, clear);
      expect(Math.abs(luminance(next.ambient) - luminance(previous.ambient))).toBeLessThan(0.05);
      previous = next;
    }
  });

  it('warms the light at golden hour', () => {
    const golden = computeLighting(17.5, clear);
    const r = (golden.skyHorizon >> 16) & 255;
    const b = golden.skyHorizon & 255;
    expect(r).toBeGreaterThan(b + 80);
  });

  it('puts the sun up by day and the moon up by night', () => {
    const noon = computeLighting(12.5, clear);
    expect(noon.sun.visible).toBe(true);
    expect(noon.sun.elevation).toBeGreaterThan(0.95);
    expect(noon.moon.visible).toBe(false);
    const night = computeLighting(1, clear);
    expect(night.sun.visible).toBe(false);
    expect(night.moon.visible).toBe(true);
    expect(computeLighting(6.2, clear).sun.progress).toBeLessThan(0.05);
  });

  it('greys out and darkens under clouds, more so in storms', () => {
    const sunny = computeLighting(13, clear);
    const grey = computeLighting(13, overcast);
    const stormy = computeLighting(13, storm);
    expect(luminance(grey.ambient)).toBeLessThan(luminance(sunny.ambient));
    expect(luminance(stormy.ambient)).toBeLessThan(luminance(grey.ambient));
    expect(grey.sun.glow).toBeLessThan(sunny.sun.glow);
    expect(computeLighting(0, overcast).stars).toBe(0);
  });

  it('lights more windows in a daytime storm', () => {
    expect(computeLighting(13, storm).windowsLit).toBeGreaterThan(computeLighting(13, clear).windowsLit);
  });
});

describe('city window schedule', () => {
  it('peaks in the evening and empties out between 2 and 4 AM', () => {
    expect(windowsLitAt(20.5)).toBeGreaterThan(0.18);
    expect(windowsLitAt(3)).toBeLessThan(0.1);
    expect(windowsLitAt(13)).toBeLessThan(0.1);
    expect(windowsLitAt(18)).toBeGreaterThan(windowsLitAt(13));
  });
});
