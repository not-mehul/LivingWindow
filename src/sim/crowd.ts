import { wrapHours } from '../state/timeOfDay';
import type { WeatherSnapshot } from '../state/Weather';

/**
 * How full the city sidewalks are through the day: the morning rush,
 * a steady day, a crowded 6 PM, a lively night market and an almost
 * empty 2–4 AM.
 */
const CROWD: ReadonlyArray<[hour: number, level: number]> = [
  [0, 0.32],
  [1.5, 0.12],
  [2.5, 0.02],
  [4.5, 0.02],
  [6, 0.12],
  [7.5, 0.6],
  [8.75, 0.8],
  [10, 0.45],
  [12.5, 0.6],
  [15, 0.45],
  [17, 0.75],
  [18, 1],
  [19.5, 0.85],
  [22, 0.6],
  [24, 0.32],
];

export function crowdLevel(hours: number): number {
  const h = wrapHours(hours);
  for (let i = 0; i < CROWD.length - 1; i++) {
    const [h0, v0] = CROWD[i];
    const [h1, v1] = CROWD[i + 1];
    if (h >= h0 && h < h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return CROWD[0][1];
}

/** Rain and snow thin the crowd. */
export function weatherCrowdFactor(weather: Pick<WeatherSnapshot, 'kind' | 'precipitation'>): number {
  if (weather.kind === 'rain') return 1 - 0.7 * Math.min(1, weather.precipitation * 1.4);
  if (weather.kind === 'snow') return 1 - 0.45 * weather.precipitation;
  return 1;
}

export const MAX_PEDESTRIANS = 30;

export function pedestrianTarget(hours: number, weather: Pick<WeatherSnapshot, 'kind' | 'precipitation'>): number {
  return Math.round(MAX_PEDESTRIANS * crowdLevel(hours) * weatherCrowdFactor(weather));
}

/** Precipitation above which people reach for umbrellas or run for cover. */
export const RAIN_THRESHOLD = 0.12;
