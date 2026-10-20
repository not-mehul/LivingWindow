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

/** Smooth 0..1 ramp between `a` and `b`. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The far-off chorus of unseen birds (0..1): a big swell at first light, a little again at dusk. */
export function dawnChorus(hours: number): number {
  const h = wrapHours(hours);
  const dawn = smoothstep(4.6, 5.8, h) * (1 - smoothstep(7, 9.5, h));
  const dusk = 0.35 * smoothstep(17.5, 18.5, h) * (1 - smoothstep(19.5, 20.5, h));
  return Math.max(dawn, dusk, h > 5.8 && h < 19 ? 0.15 : 0);
}

/** Insects singing at night (0..1), rising smoothly with the dark rather than switching on. */
export function nightInsects(darkness: number): number {
  return smoothstep(0.35, 0.8, darkness);
}

/** Frogs by the water: from dusk into the small hours (0..1). */
export function frogChorus(hours: number): number {
  const h = wrapHours(hours);
  return Math.max(smoothstep(18.5, 20, h), 1 - smoothstep(0.5, 2.5, h)) * (h > 12 || h < 3 ? 1 : 0);
}

/** Daytime insects in the grass (0..1): the warm middle of the day. */
export function dayInsects(hours: number): number {
  const h = wrapHours(hours);
  return smoothstep(9, 11.5, h) * (1 - smoothstep(17, 19, h));
}
