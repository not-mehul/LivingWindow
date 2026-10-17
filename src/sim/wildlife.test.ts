import { describe, expect, it } from 'vitest';
import {
  bioluminescenceLevel,
  bioluminescenceNight,
  crabActivity,
  hatchlingNight,
  hatchlingTime,
  hermitActivity,
  pelicanActivity,
  batActivity,
  bearActivity,
  butterflyActivity,
  elkOut,
  foxActivity,
  mushroomLevel,
  nightEyesLevel,
  woodpeckerActivity,
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

describe('woods and fields', () => {
  it('has foxes about at dusk, dawn and night more than by day', () => {
    expect(foxActivity(19.8)).toBeGreaterThan(0.9);
    expect(foxActivity(6)).toBeGreaterThan(0.9);
    expect(foxActivity(1)).toBeGreaterThan(foxActivity(13));
  });

  it('flies bats at dusk but not by day or in the rain', () => {
    expect(batActivity(20, false)).toBe(1);
    expect(batActivity(20, true)).toBe(0);
    expect(batActivity(13, false)).toBe(0);
  });

  it('flies butterflies in sunshine only', () => {
    expect(butterflyActivity(13, 0, false)).toBeGreaterThan(0.9);
    expect(butterflyActivity(13, 1, false)).toBeLessThan(0.2);
    expect(butterflyActivity(13, 0, true)).toBe(0);
    expect(butterflyActivity(21, 0, false)).toBe(0);
  });

  it('keeps woodpeckers, bears and elk to their hours, and eyes to the dark', () => {
    expect(woodpeckerActivity(9)).toBe(1);
    expect(woodpeckerActivity(22)).toBe(0);
    expect(bearActivity(7)).toBe(1);
    expect(bearActivity(2)).toBe(0);
    expect(elkOut(6)).toBe(true);
    expect(elkOut(12)).toBe(false);
    expect(nightEyesLevel(0.2)).toBe(0);
    expect(nightEyesLevel(1)).toBe(1);
  });

  it('brings mushrooms up after rain and lets them go over', () => {
    expect(mushroomLevel(Infinity)).toBe(0);
    expect(mushroomLevel(0.5)).toBeGreaterThan(0);
    expect(mushroomLevel(6)).toBe(1);
    expect(mushroomLevel(30)).toBe(0);
  });
});

describe('the shore', () => {
  it('brings crabs out at dusk and night, hermit crabs on dull days', () => {
    expect(crabActivity(20)).toBeGreaterThan(crabActivity(13));
    expect(hermitActivity(13, 1)).toBeGreaterThan(hermitActivity(13, 0));
    expect(pelicanActivity(8)).toBe(1);
    expect(pelicanActivity(22)).toBe(0);
  });

  it('lights the surf on some nights, only in the dark', () => {
    let nights = 0;
    for (let i = 0; i < 1000; i++) if (bioluminescenceNight(`d${i}`)) nights++;
    expect(nights).toBeGreaterThan(180);
    expect(nights).toBeLessThan(320);
    expect(bioluminescenceLevel(0.2, 0)).toBe(0);
    expect(bioluminescenceLevel(1, 0)).toBeGreaterThan(bioluminescenceLevel(1, 1));
  });

  it('hatches a nest on a few nights, late in the evening', () => {
    let nights = 0;
    for (let i = 0; i < 1000; i++) if (hatchlingNight(`d${i}`)) nights++;
    expect(nights).toBeGreaterThan(110);
    expect(nights).toBeLessThan(230);
    expect(hatchlingTime(23)).toBe(true);
    expect(hatchlingTime(12)).toBe(false);
  });
});
