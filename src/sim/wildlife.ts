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

/** Cows graze by day; after dark most lie down (and a few wander off). */
export function cowsResting(hours: number): boolean {
  const h = ((hours % 24) + 24) % 24;
  return h >= 20.5 || h < 5.5;
}

/** Chickens are out from first light until dusk. */
export function chickensOut(hours: number): boolean {
  const h = ((hours % 24) + 24) % 24;
  return h >= 6 && h < 19.5;
}

/** Rabbits come out to feed around dawn and dusk. */
export function rabbitActivity(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  const near = (c: number, w: number) => Math.max(0, 1 - Math.abs(h - c) / w);
  return Math.max(0.2, near(6.5, 2.5), near(19, 2.5));
}

/** Fireflies glow on warm, dry evenings and into the night. */
export function fireflyLevel(hours: number, darkness: number, raining: boolean): number {
  if (raining || darkness < 0.5) return 0;
  const h = ((hours % 24) + 24) % 24;
  return h >= 19 || h < 2 ? Math.min(1, (darkness - 0.5) * 2.5) : 0.3;
}
