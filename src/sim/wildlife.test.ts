import { describe, expect, it } from 'vitest';
import { chickensOut, cowsResting, deerActivity, fireflyLevel, owlActivity, rabbitActivity, sillVisitInterval, squirrelActivity } from './wildlife';

describe('wildlife schedules', () => {
  it('has deer about most at dawn and dusk', () => {
    expect(deerActivity(6.8)).toBeGreaterThan(0.9);
    expect(deerActivity(18.8)).toBeGreaterThan(0.9);
    expect(deerActivity(13)).toBeLessThan(0.5);
    expect(deerActivity(2)).toBeGreaterThan(0);
  });

  it('keeps owls to the night and squirrels to the day', () => {
    expect(owlActivity(23)).toBeGreaterThan(0);
    expect(owlActivity(13)).toBe(0);
    expect(squirrelActivity(13)).toBe(1);
    expect(squirrelActivity(23)).toBe(0);
  });

  it('beds the cows down at night and the hens in their coop', () => {
    expect(cowsResting(23)).toBe(true);
    expect(cowsResting(10)).toBe(false);
    expect(chickensOut(10)).toBe(true);
    expect(chickensOut(21)).toBe(false);
  });

  it('brings rabbits out at twilight', () => {
    expect(rabbitActivity(6.5)).toBeGreaterThan(rabbitActivity(13));
  });

  it('lights fireflies only on dry, dark evenings', () => {
    expect(fireflyLevel(21, 0.9, false)).toBeGreaterThan(0.5);
    expect(fireflyLevel(21, 0.9, true)).toBe(0);
    expect(fireflyLevel(13, 0, false)).toBe(0);
  });

  it('sends sill raiders sooner when seed is out', () => {
    expect(sillVisitInterval(true, () => 1)).toBeLessThan(sillVisitInterval(false, () => 0));
  });
});
