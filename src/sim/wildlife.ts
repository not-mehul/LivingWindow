import { wrapHours } from '../state/timeOfDay';

/**
 * Deer are crepuscular: most active around dawn and dusk, sometimes seen by
 * day, rarely at night.
 */
export function deerActivity(hours: number): number {
  const h = wrapHours(hours);
  const near = (center: number, width: number) => Math.max(0, 1 - Math.abs(h - center) / width);
  return Math.max(0.12, near(6.8, 2.2), near(18.8, 2.4), h > 8 && h < 17 ? 0.35 : 0);
}

/** Owls hunt from late evening until just before dawn. */
export function owlActivity(hours: number): number {
  const h = wrapHours(hours);
  return h >= 20.5 || h < 5 ? 0.35 : 0;
}

/** Squirrels keep office hours. */
export function squirrelActivity(hours: number): number {
  const h = wrapHours(hours);
  if (h < 6.5 || h > 19.5) return 0;
  return h < 8 || h > 18 ? 0.5 : 1;
}

/** Seconds until the next sill visit by a seed-loving creature. */
export function sillVisitInterval(seedOut: boolean, rng: () => number = Math.random): number {
  return seedOut ? 90 + rng() * 150 : 300 + rng() * 300;
}
