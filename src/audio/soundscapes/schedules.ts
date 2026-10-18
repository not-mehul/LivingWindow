import { wrapHours } from '../../state/timeOfDay';

/** How busy the city streets are through the day (0..1), for traffic and hum. */
const CITY_BUSYNESS: ReadonlyArray<[hour: number, level: number]> = [
  [0, 0.35],
  [2, 0.12],
  [4.5, 0.08],
  [6.5, 0.5],
  [8.5, 1],
  [12, 0.8],
  [17.5, 1],
  [20, 0.75],
  [23, 0.5],
  [24, 0.35],
];

export function cityBusyness(hours: number): number {
  const h = wrapHours(hours);
  for (let i = 0; i < CITY_BUSYNESS.length - 1; i++) {
    const [h0, v0] = CITY_BUSYNESS[i];
    const [h1, v1] = CITY_BUSYNESS[i + 1];
    if (h >= h0 && h < h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return CITY_BUSYNESS[0][1];
}

/** How much daytime birdsong there is (0..1): a dawn chorus, quiet by night. */
export function birdActivity(hours: number): number {
  const h = wrapHours(hours);
  if (h < 5 || h >= 20.5) return 0;
  if (h < 7) return (h - 5) / 2; // dawn chorus builds
  if (h < 9) return 1;
  if (h < 17) return 0.55;
  if (h < 19) return 0.75; // evening flurry
  return 0.75 * (1 - (h - 19) / 1.5);
}
