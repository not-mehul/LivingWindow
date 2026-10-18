import { describe, expect, it } from 'vitest';
import { birdActivity, cityBusyness } from './schedules';

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
});
