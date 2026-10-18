import { wrapHours } from '../state/timeOfDay';

export type MarketShift = 'day' | 'night';

/** [setup start, open, pack start, gone] in hours for each shift. */
export const SHIFT_HOURS: Record<MarketShift, readonly [number, number, number, number]> = {
  day: [7, 7.6, 17.9, 18.4],
  night: [18.3, 18.9, 23.4, 23.9],
};

/**
 * How set up a stall is, 0 (absent) .. 1 (fully open), for its shift and a
 * per-stall offset (hours) so they don't all appear in the same instant.
 */
export function stallProgress(shift: MarketShift, hours: number, offset = 0): number {
  const [setup, open, pack, gone] = SHIFT_HOURS[shift];
  const h = wrapHours(hours - offset);
  if (h < setup || h >= gone) return 0;
  if (h < open) return (h - setup) / (open - setup);
  if (h < pack) return 1;
  return 1 - (h - pack) / (gone - pack);
}
