import { describe, expect, it } from 'vitest';
import {
  blimpOut,
  buskerOut,
  chickensOut,
  cowsResting,
  deerActivity,
  deliveryRiders,
  fireflyLevel,
  fireworksNight,
  fireworksTime,
  foodCartOut,
  gardenerOut,
  owlActivity,
  pigeonFeederOut,
  rabbitActivity,
  sillVisitInterval,
  squirrelActivity,
  sweeperOut,
  taxiHours,
  windowCleanersOut,
} from './wildlife';

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

describe('city rhythm', () => {
  it('sends delivery riders out by day, most at mealtimes and in the rain', () => {
    expect(deliveryRiders(3, false)).toBe(0);
    expect(deliveryRiders(12.5, false)).toBeGreaterThan(deliveryRiders(9, false));
    expect(deliveryRiders(12.5, true)).toBeGreaterThan(deliveryRiders(12.5, false));
  });

  it('keeps the sweeper to dawn, the food cart and taxis to the small hours', () => {
    expect(sweeperOut(6)).toBe(true);
    expect(sweeperOut(12)).toBe(false);
    expect(foodCartOut(0.5)).toBe(true);
    expect(foodCartOut(23.8)).toBe(true);
    expect(foodCartOut(20)).toBe(false);
    expect(taxiHours(3)).toBe(true);
    expect(taxiHours(12)).toBe(false);
  });

  it('has the busker play in the evening, but not in the rain', () => {
    expect(buskerOut(20, false)).toBe(true);
    expect(buskerOut(20, true)).toBe(false);
    expect(buskerOut(14, false)).toBe(false);
  });

  it('works the rooftops in daylight', () => {
    expect(windowCleanersOut(11, false)).toBe(true);
    expect(windowCleanersOut(20, false)).toBe(false);
    expect(gardenerOut(8, false)).toBe(true);
    expect(gardenerOut(19, false)).toBe(true);
    expect(gardenerOut(13, false)).toBe(false);
    expect(pigeonFeederOut(10, false)).toBe(true);
    expect(pigeonFeederOut(10, true)).toBe(false);
    expect(blimpOut(12, true)).toBe(true);
    expect(blimpOut(12, false)).toBe(false);
  });

  it('sets off fireworks on about one night in five, at nine', () => {
    let nights = 0;
    for (let i = 0; i < 1000; i++) if (fireworksNight(`2026-10-${i}`)) nights++;
    expect(nights).toBeGreaterThan(140);
    expect(nights).toBeLessThan(260);
    expect(fireworksNight('2026-10-17#3')).toBe(fireworksNight('2026-10-17#3'));
    expect(fireworksTime(21.5)).toBe(true);
    expect(fireworksTime(23)).toBe(false);
  });
});
