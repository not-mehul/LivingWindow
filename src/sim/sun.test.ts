import { describe, expect, it } from 'vitest';
import { guessLocation, moonAge, moonIllumination, moonTimes, solarHours, sunTimes, winterness } from './sun';

const LONDON = { latitude: 51.5, longitude: -0.1 };
const minutes = (h: number) => Math.round(h * 60);

describe('the sun and moon', () => {
  it('rises and sets at the real times for a place and date', () => {
    const june = sunTimes(new Date(2026, 5, 21, 12), LONDON, 1);
    // 04:43 and 21:21 BST.
    expect(Math.abs(minutes(june.sunrise) - (4 * 60 + 43))).toBeLessThan(6);
    expect(Math.abs(minutes(june.sunset) - (21 * 60 + 21))).toBeLessThan(6);
    const december = sunTimes(new Date(2026, 11, 21, 12), LONDON, 0);
    // 08:04 and 15:54 GMT.
    expect(Math.abs(minutes(december.sunrise) - (8 * 60 + 4))).toBeLessThan(6);
    expect(Math.abs(minutes(december.sunset) - (15 * 60 + 54))).toBeLessThan(6);
  });

  it('still gives the far north a dawn and a dusk', () => {
    const tromso = { latitude: 69.6, longitude: 19 };
    const winter = sunTimes(new Date(2026, 11, 21, 12), tromso, 1);
    const day = (winter.sunset - winter.sunrise + 24) % 24;
    expect(day).toBeGreaterThanOrEqual(4 - 1e-9);
    const summer = sunTimes(new Date(2026, 5, 21, 12), tromso, 2);
    expect((summer.sunset - summer.sunrise + 24) % 24).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('maps the real day onto the authored sunrise and sunset', () => {
    const sun = { sunrise: 4.75, sunset: 21.35 };
    expect(solarHours(4.75, sun)).toBeCloseTo(6);
    expect(solarHours(21.35, sun)).toBeCloseTo(19);
    expect(solarHours((4.75 + 21.35) / 2, sun)).toBeCloseTo(12.5);
    // Monotonic through a whole day.
    let last = solarHours(4.75, sun);
    for (let h = 4.8; h < 4.75 + 24; h += 0.25) {
      const s = solarHours(h % 24, sun);
      const step = (s - last + 24) % 24;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(1);
      last = s;
    }
  });

  it('follows the moon through its phases', () => {
    // Full moon on 5 November 2025, new moon on 20 November 2025.
    expect(moonIllumination(moonAge(new Date(Date.UTC(2025, 10, 5, 13))))).toBeGreaterThan(0.97);
    expect(moonIllumination(moonAge(new Date(Date.UTC(2025, 10, 20, 6))))).toBeLessThan(0.03);
    // A full moon rises as the sun sets.
    expect(moonTimes(0.5).rise).toBeCloseTo(18);
  });

  it('guesses a location from the time zone', () => {
    expect(guessLocation('Europe/London', 0).latitude).toBeCloseTo(51.5);
    const somewhere = guessLocation('Europe/Nowhere', 1);
    expect(somewhere.latitude).toBe(50);
    expect(somewhere.longitude).toBe(15);
  });

  it('knows winter from summer, in either hemisphere', () => {
    expect(winterness(new Date(2026, 0, 20), 51)).toBeGreaterThan(0.95);
    expect(winterness(new Date(2026, 6, 20), 51)).toBeLessThan(0.05);
    expect(winterness(new Date(2026, 6, 20), -40)).toBeGreaterThan(0.6);
    expect(winterness(new Date(2026, 0, 20), 5)).toBe(0);
  });
});
