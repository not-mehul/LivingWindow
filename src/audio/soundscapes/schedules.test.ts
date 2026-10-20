import { describe, expect, it } from 'vitest';
import { birdActivity, cityBusyness, dawnChorus, dayInsects, frogChorus, nightInsects } from './schedules';

describe('soundscape schedules', () => {
  it('fills the streets at rush hour and empties them late at night', () => {
    expect(cityBusyness(8.5)).toBe(1);
    expect(cityBusyness(17.5)).toBe(1);
    expect(cityBusyness(3)).toBeLessThan(0.15);
    expect(cityBusyness(24)).toBeCloseTo(cityBusyness(0));
  });

  it('has a dawn chorus and silent nights', () => {
    expect(birdActivity(1)).toBe(0);
    expect(birdActivity(23)).toBe(0);
    expect(birdActivity(7.5)).toBe(1);
    expect(birdActivity(6)).toBeGreaterThan(0);
    expect(birdActivity(13)).toBeLessThan(birdActivity(7.5));
  });

  it('swells the far-off chorus at first light', () => {
    expect(dawnChorus(6.5)).toBe(1);
    expect(dawnChorus(2)).toBe(0);
    expect(dawnChorus(13)).toBeLessThan(0.3);
    expect(dawnChorus(18.9)).toBeGreaterThan(dawnChorus(13));
  });

  it('brings the night insects in gradually with the dark', () => {
    expect(nightInsects(0)).toBe(0);
    expect(nightInsects(1)).toBe(1);
    const steps = [0.4, 0.5, 0.6, 0.7].map(nightInsects);
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeLessThan(0.4);
  });

  it('keeps frogs to the evening and grasshoppers to the day', () => {
    expect(frogChorus(21)).toBe(1);
    expect(frogChorus(12)).toBe(0);
    expect(frogChorus(5)).toBe(0);
    expect(dayInsects(13)).toBe(1);
    expect(dayInsects(22)).toBe(0);
  });
});
