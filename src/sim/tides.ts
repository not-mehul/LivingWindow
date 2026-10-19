/**
 * The tide: twice a day the sea comes up the beach and goes back, a little
 * under an hour later each day (the moon's half-day of 12 h 25 min), with
 * bigger springs and smaller neaps through the fortnight as the sun and moon
 * pull together or across each other.
 */

/** Hours from one high water to the next. */
export const TIDE_PERIOD = 12.42;
/** Days from spring tide to spring tide. */
const SPRING_NEAP = 14.77;
/** A high water to count from (hours since the Unix epoch). */
const HIGH_WATER_EPOCH = 6.3;
/** How far up the beach the highest springs bring the still waterline (ground px across the shore). */
export const TIDE_RANGE = 26;

/** Hours since the epoch at an hour of the clock on the day of `date`. */
export function tideClock(date: Date, hours: number): number {
  const midnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return midnight / 3_600_000 + hours;
}

/** How high the tide is (-1 lowest springs .. 1 highest springs) at `t` hours since the epoch. */
export function tideLevel(t: number): number {
  const phase = ((t - HIGH_WATER_EPOCH) / TIDE_PERIOD) * Math.PI * 2;
  const spring = 0.78 + 0.22 * Math.cos((t / 24 / SPRING_NEAP) * Math.PI * 2);
  return Math.cos(phase) * spring;
}

/** Is it rising (flood) or falling (ebb)? */
export function tideRising(t: number): boolean {
  return tideLevel(t + 0.05) > tideLevel(t);
}

/** The highest the tide came over the last half-day before `t` (where it left its line of wrack). */
export function lastHighWater(t: number): number {
  let best = -1;
  for (let h = 0; h <= TIDE_PERIOD; h += 0.25) best = Math.max(best, tideLevel(t - h));
  return best;
}
