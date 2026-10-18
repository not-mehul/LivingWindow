import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../core/random';
import {
  sampleTransition,
  Weather,
  WEATHER_PROFILES,
  WEATHER_TRANSITIONS,
  WEATHER_TYPES,
  type WeatherType,
} from './Weather';

/** Step the weather in fixed real-time increments. */
function run(weather: Weather, seconds: number, simHoursPerSecond = 0, step = 0.05) {
  for (let t = 0; t < seconds; t += step) weather.update(step, simHoursPerSecond * step);
}

describe('Markov transitions', () => {
  it('has a probability distribution for every state', () => {
    for (const type of WEATHER_TYPES) {
      const total = Object.values(WEATHER_TRANSITIONS[type]).reduce((a, b) => a + (b ?? 0), 0);
      expect(total).toBeCloseTo(1);
    }
  });

  it('samples transitions in proportion to their weights', () => {
    const rng = createRng(1);
    const counts: Partial<Record<WeatherType, number>> = {};
    for (let i = 0; i < 20_000; i++) {
      const next = sampleTransition('thunderstorm', rng);
      counts[next] = (counts[next] ?? 0) + 1;
    }
    expect((counts['light-rain'] ?? 0) / 20_000).toBeCloseTo(0.6, 1);
    expect((counts.overcast ?? 0) / 20_000).toBeCloseTo(0.4, 1);
    expect(counts.snow).toBeUndefined();
  });

  it('changes state on its own as simulated time passes', () => {
    const weather = new Weather({ initial: 'clear', rng: createRng(7) });
    const changes = vi.fn();
    weather.on('change', changes);
    // 48 simulated hours: well past several dwell periods.
    run(weather, 48, 1);
    expect(changes).toHaveBeenCalled();
    expect(changes.mock.calls.every(([e]) => e.manual === false)).toBe(true);
  });

  it('holds still while the clock is frozen', () => {
    const weather = new Weather({ initial: 'clear', rng: createRng(7) });
    const changes = vi.fn();
    weather.on('change', changes);
    run(weather, 60, 0);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('manual override', () => {
  it('locks a chosen state until unlocked', () => {
    const weather = new Weather({ initial: 'clear', rng: createRng(3) });
    weather.setWeather('snow');
    expect(weather.type).toBe('snow');
    expect(weather.locked).toBe(true);
    run(weather, 48, 1);
    expect(weather.type).toBe('snow');

    weather.unlock();
    expect(weather.locked).toBe(false);
    run(weather, 72, 1);
    expect(weather.snapshot.locked).toBe(false);
  });

  it('can switch without locking', () => {
    const weather = new Weather({ rng: createRng(3) });
    weather.setWeather('overcast', false);
    expect(weather.locked).toBe(false);
    expect(weather.type).toBe('overcast');
  });

  it('blends smoothly towards the new state', () => {
    const weather = new Weather({ initial: 'clear', rng: createRng(5) });
    weather.setWeather('thunderstorm');
    run(weather, 1);
    const early = weather.snapshot.cloudCover;
    expect(early).toBeGreaterThan(WEATHER_PROFILES.clear.cloudCover);
    expect(early).toBeLessThan(0.9);
    run(weather, 10);
    expect(weather.snapshot.cloudCover).toBeGreaterThan(0.9);
    expect(weather.snapshot.kind).toBe('rain');
    expect(weather.snapshot.precipitation).toBeGreaterThan(0.6);
  });
});

describe('precipitation', () => {
  it('lets rain stop before snow begins', () => {
    const weather = new Weather({ initial: 'light-rain', rng: createRng(11) });
    weather.setWeather('snow');
    let sawGap = false;
    let rainBeforeSnow = true;
    for (let t = 0; t < 30; t += 0.05) {
      weather.update(0.05, 0);
      const { kind, precipitation } = weather.snapshot;
      if (kind === 'rain' && precipitation < 0.03) sawGap = true;
      if (kind === 'snow' && !sawGap) rainBeforeSnow = false;
    }
    expect(rainBeforeSnow).toBe(true);
    expect(weather.snapshot.kind).toBe('snow');
    expect(weather.snapshot.precipitation).toBeGreaterThan(0.3);
  });

  it('dries up when clearing', () => {
    const weather = new Weather({ initial: 'light-rain', rng: createRng(11) });
    weather.setWeather('clear');
    run(weather, 30);
    expect(weather.snapshot.kind).toBe('none');
    expect(weather.snapshot.precipitation).toBe(0);
  });

  it('keeps every value in range with noise applied', () => {
    const weather = new Weather({ initial: 'thunderstorm', rng: createRng(2) });
    for (let t = 0; t < 600; t += 0.5) {
      weather.update(0.5, 0);
      const s = weather.snapshot;
      expect(s.cloudCover).toBeGreaterThanOrEqual(0);
      expect(s.cloudCover).toBeLessThanOrEqual(1);
      expect(s.precipitation).toBeGreaterThanOrEqual(0);
      expect(s.precipitation).toBeLessThanOrEqual(1);
      expect(Math.abs(s.wind)).toBeLessThanOrEqual(1);
    }
  });
});

describe('lightning', () => {
  it('strikes during storms, never in clear skies', () => {
    const storm = new Weather({ initial: 'thunderstorm', rng: createRng(9) });
    const clear = new Weather({ initial: 'clear', rng: createRng(9) });
    const strikes = vi.fn();
    const none = vi.fn();
    storm.on('lightning', strikes);
    clear.on('lightning', none);
    run(storm, 120);
    run(clear, 120);
    // ~0.14 strikes/s with bursts: expect a handful over two minutes.
    expect(strikes.mock.calls.length).toBeGreaterThan(3);
    expect(strikes.mock.calls.length).toBeLessThan(60);
    for (const [{ intensity, distance }] of strikes.mock.calls) {
      expect(intensity).toBeGreaterThanOrEqual(0.5);
      expect(intensity).toBeLessThanOrEqual(1);
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThan(1);
    }
    expect(none).not.toHaveBeenCalled();
  });
});
