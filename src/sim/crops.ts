import { clamp01 } from '../core/math';

/**
 * The farm's year: what each field looks like on a given date, following a
 * northern farming calendar. Winter wheat is sown in the autumn, greens up in
 * spring, turns gold through early summer and is cut in August, leaving
 * stubble and bales; maize goes in in May, stands taller than a person by
 * August (when a maze is cut through it) and is harvested late in October.
 */

export type CropKind = 'wheat' | 'maize' | 'cabbage';
export type CropStage = 'ploughed' | 'sown' | 'growing' | 'ripe' | 'stubble';

export interface CropState {
  stage: CropStage;
  /** How tall it stands, 0 (bare) to 1 (full grown). */
  height: number;
  /** From fresh green (0) to ripe gold or dry tan (1). */
  ripeness: number;
}

/** [first day of the year, stage, height at the start, at the end, ripeness at the start, at the end]. */
type Segment = readonly [day: number, stage: CropStage, h0: number, h1: number, r0: number, r1: number];

const CALENDAR: Record<CropKind, readonly Segment[]> = {
  wheat: [
    [0, 'sown', 0.06, 0.1, 0, 0],
    [60, 'growing', 0.1, 0.85, 0, 0],
    [152, 'growing', 0.85, 1, 0, 0.7],
    [191, 'ripe', 1, 1, 0.7, 1],
    [222, 'stubble', 0.08, 0.08, 1, 1],
    [258, 'ploughed', 0, 0, 1, 1],
    [283, 'sown', 0, 0.06, 0, 0],
  ],
  maize: [
    [0, 'stubble', 0.08, 0.06, 1, 1],
    [32, 'ploughed', 0, 0, 1, 1],
    [121, 'sown', 0, 0.05, 0, 0],
    [152, 'growing', 0.05, 0.6, 0, 0],
    [182, 'growing', 0.6, 1, 0, 0.1],
    [213, 'ripe', 1, 1, 0.1, 0.55],
    [258, 'ripe', 1, 0.95, 0.55, 1],
    [298, 'stubble', 0.1, 0.08, 1, 1],
  ],
  cabbage: [
    [0, 'growing', 0.7, 0.6, 0.2, 0.3],
    [45, 'ploughed', 0, 0, 0, 0],
    [75, 'sown', 0.05, 0.2, 0, 0],
    [121, 'growing', 0.2, 1, 0, 0],
    [244, 'ripe', 1, 0.8, 0, 0.2],
  ],
};

export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((now - start) / 86_400_000);
}

export function cropState(kind: CropKind, date: Date): CropState {
  const day = dayOfYear(date);
  const segs = CALENDAR[kind];
  let i = segs.length - 1;
  while (i > 0 && segs[i][0] > day) i--;
  const [d0, stage, h0, h1, r0, r1] = segs[i];
  const d1 = i + 1 < segs.length ? segs[i + 1][0] : 366;
  const t = clamp01((day - d0) / Math.max(1, d1 - d0));
  return { stage, height: h0 + (h1 - h0) * t, ripeness: r0 + (r1 - r0) * t };
}

/** Whether the maize maze is open (the field stands tall enough to walk lost in). */
export function mazeOpen(date: Date): boolean {
  const s = cropState('maize', date);
  return (s.stage === 'ripe' || s.stage === 'growing') && s.height > 0.7;
}
