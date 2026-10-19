import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { alarmAt, alarmBetween, chance, Cooldown, FLIGHT_DISTANCE, hourWindow } from './interplay';

describe('interplay helpers', () => {
  it('bolts inside the flight distance, watches just beyond it, ignores what is far off', () => {
    expect(alarmAt('rabbit', 20)).toBe('bolt');
    expect(alarmAt('rabbit', FLIGHT_DISTANCE.rabbit * 1.5)).toBe('watch');
    expect(alarmAt('rabbit', 500)).toBe('none');
    // A bigger threat is fled from further off.
    expect(alarmAt('deer', 150)).toBe('watch');
    expect(alarmAt('deer', 150, 1.5)).toBe('bolt');
    expect(alarmBetween('hen', { gx: 0, depth: 2 }, { gx: 30, depth: 2 })).toBe('bolt');
    expect(alarmBetween('hen', { gx: 0, depth: 2 }, { gx: 0, depth: 3 })).toBe('none');
  });

  it('keeps per-minute odds the same at any frame rate', () => {
    // About six a minute, over an hour, at 30 or 120 steps a second.
    const count = (dt: number) => {
      const rng = createRng(1);
      let n = 0;
      for (let t = 0; t < 3600; t += dt) if (chance(6, dt, rng)) n++;
      return n;
    };
    for (const dt of [1 / 30, 1 / 120]) {
      expect(count(dt)).toBeGreaterThan(300);
      expect(count(dt)).toBeLessThan(420);
    }
  });

  it('rests after use and only comes round again after its cooldown', () => {
    const rng = createRng(2);
    const c = new Cooldown(10, 20);
    expect(c.use(rng)).toBe(true);
    expect(c.use(rng)).toBe(false);
    for (let t = 0; t < 9; t += 0.5) c.tick(0.5);
    expect(c.ready).toBe(false);
    for (let t = 0; t < 12; t += 0.5) c.tick(0.5);
    expect(c.ready).toBe(true);
    // `maybe` only spends it when the odds come up.
    expect(new Cooldown(5, 5).maybe(0, rng)).toBe(false);
    expect(new Cooldown(5, 5).maybe(1, rng)).toBe(true);
  });

  it('opens and closes hour windows smoothly, across midnight too', () => {
    expect(hourWindow(12, 10, 14)).toBe(1);
    expect(hourWindow(10.25, 10, 14)).toBeCloseTo(0.5);
    expect(hourWindow(9, 10, 14)).toBe(0);
    expect(hourWindow(23.5, 22, 2)).toBe(1);
    expect(hourWindow(1.75, 22, 2)).toBeCloseTo(0.5);
    expect(hourWindow(3, 22, 2)).toBe(0);
  });
});

describe('weather lore', () => {
  it('has cows lie down as the cloud gathers, more the heavier it is', async () => {
    const { lieBeforeRain } = await import('./interplay');
    expect(lieBeforeRain(0.3, 0)).toBe(0);
    expect(lieBeforeRain(0.75, 0)).toBeGreaterThan(0.2);
    expect(lieBeforeRain(0.95, 0)).toBeGreaterThan(lieBeforeRain(0.75, 0));
  });

  it('brings the flies out on warm, still, dry afternoons only', async () => {
    const { fliesOut, goldenHour } = await import('./interplay');
    expect(fliesOut(14, 0.05, 0.1, 0)).toBeGreaterThan(0.6);
    expect(fliesOut(14, 0.6, 0.1, 0)).toBe(0);
    expect(fliesOut(14, 0.05, 0.1, 0.4)).toBe(0);
    expect(fliesOut(8, 0.05, 0.1, 0)).toBe(0);
    expect(goldenHour(19)).toBe(1);
    expect(goldenHour(13)).toBe(0);
  });
});

describe("birds' day", () => {
  it('roosts at dusk and wakes at first light', async () => {
    const { roostTime, wakeTime } = await import('./interplay');
    expect(roostTime(20)).toBe(true);
    expect(roostTime(15)).toBe(false);
    expect(roostTime(3)).toBe(false);
    expect(wakeTime(6.5)).toBe(true);
    expect(wakeTime(23)).toBe(false);
  });
});
