/** Named stretches of the simulated day. */
export type DayPhase =
  | 'late-night'
  | 'night'
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'golden-hour'
  | 'dusk';

/** Start hour of each phase, in order through the day. */
const PHASE_STARTS: ReadonlyArray<[hour: number, phase: DayPhase]> = [
  [0, 'night'],
  [2, 'late-night'],
  [4, 'night'],
  [5.5, 'dawn'],
  [7, 'morning'],
  [11, 'midday'],
  [16, 'golden-hour'],
  [18.5, 'dusk'],
  [20, 'night'],
];

export const PHASE_LABELS: Record<DayPhase, string> = {
  'late-night': 'Late Night',
  night: 'Night',
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  'golden-hour': 'Golden Hour',
  dusk: 'Dusk',
};

/** Representative times the UI can jump to, in display order. */
export const PHASE_PRESETS: ReadonlyArray<{ phase: DayPhase; hours: number }> = [
  { phase: 'dawn', hours: 6 },
  { phase: 'morning', hours: 9 },
  { phase: 'midday', hours: 13 },
  { phase: 'golden-hour', hours: 17.5 },
  { phase: 'dusk', hours: 19.25 },
  { phase: 'night', hours: 22 },
  { phase: 'late-night', hours: 3 },
];

export function wrapHours(hours: number): number {
  return ((hours % 24) + 24) % 24;
}

export function phaseAt(hours: number): DayPhase {
  const h = wrapHours(hours);
  let phase: DayPhase = 'night';
  for (const [start, name] of PHASE_STARTS) {
    if (h >= start) phase = name;
  }
  return phase;
}

/** "HH:MM" on a 24-hour clock. */
export function formatClock(hours: number): string {
  const totalMinutes = Math.floor(wrapHours(hours) * 60 + 1e-6) % 1440;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
