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

// --- The city's rhythm ---------------------------------------------------

const wrap = (hours: number) => ((hours % 24) + 24) % 24;

/** How many delivery riders are out on the street: busy at lunch and dinner, busier still in the rain. */
export function deliveryRiders(hours: number, raining: boolean): number {
  const h = wrap(hours);
  if (h < 7 || h >= 23) return 0;
  const near = (c: number, w: number) => Math.max(0, 1 - Math.abs(h - c) / w);
  const base = 1 + 2 * Math.max(near(12.5, 1.5), near(19.5, 2));
  return Math.round(base + (raining ? 1 : 0));
}

/** The street sweeper does its rounds at first light. */
export function sweeperOut(hours: number): boolean {
  const h = wrap(hours);
  return h >= 5.5 && h < 8;
}

/** A late-night food cart is pushed along after the market closes. */
export function foodCartOut(hours: number): boolean {
  const h = wrap(hours);
  return h >= 23.5 || h < 2;
}

/** Taxis creep up the empty street in the small hours. */
export function taxiHours(hours: number): boolean {
  const h = wrap(hours);
  return h >= 1 && h < 5;
}

/** A busker plays under a street lamp through the evening, unless it's raining. */
export function buskerOut(hours: number, raining: boolean): boolean {
  const h = wrap(hours);
  return !raining && h >= 19 && h < 23;
}

/** Window cleaners work the glass tower through the working day. */
export function windowCleanersOut(hours: number, raining: boolean): boolean {
  const h = wrap(hours);
  return !raining && h >= 9 && h < 16;
}

/** The rooftop gardener waters in the cool of the morning and the evening. */
export function gardenerOut(hours: number, raining: boolean): boolean {
  const h = wrap(hours);
  return !raining && ((h >= 7 && h < 9) || (h >= 18 && h < 20));
}

/** Someone feeds the pigeons on the terrace mid-morning and mid-afternoon. */
export function pigeonFeederOut(hours: number, raining: boolean): boolean {
  const h = wrap(hours);
  return !raining && ((h >= 9.5 && h < 10.5) || (h >= 15 && h < 16));
}

/** The advertising blimp only goes up on fair days. */
export function blimpOut(hours: number, clear: boolean): boolean {
  const h = wrap(hours);
  return clear && h >= 10 && h < 17;
}

/** How bright the city's holograms over the skyline are (0..1): on from dusk, blazing through the evening, fading before dawn. */
export function hologramLevel(hours: number): number {
  const h = wrap(hours);
  const ease = (t: number) => t * t * (3 - 2 * t);
  if (h >= 19 && h < 20) return ease(h - 19);
  if (h >= 20 || h < 3) return 1;
  if (h >= 3 && h < 5) return ease(1 - (h - 3) / 2);
  return 0;
}

/** Ad drones work the evening crowds: from five in the afternoon until two. */
export function adDronesOut(hours: number): boolean {
  const h = wrap(hours);
  return h >= 17 || h < 2;
}

/** A stable hash of a string to 0..1. */
function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Whether a given night (named by `key`, e.g. the date and the evening's number) has fireworks: about one night in five. */
export function fireworksNight(key: string): boolean {
  return hash01(`fireworks:${key}`) < 0.2;
}

/** Fireworks go up over the skyline for an hour from nine. */
export function fireworksTime(hours: number): boolean {
  const h = wrap(hours);
  return h >= 21 && h < 22;
}

// --- The woods and fields after dark, and their small life ------------------

/** Foxes hunt at dusk, through the night and at dawn, and are rarely seen by day. */
export function foxActivity(hours: number): number {
  const h = wrap(hours);
  const near = (c: number, w: number) => Math.max(0, 1 - Math.abs(h - c) / w);
  return Math.max(h >= 21 || h < 5 ? 0.45 : 0.06, near(6, 1.6), near(19.8, 1.8));
}

/** Bats hunt insects at dusk and into the night, and again before dawn; never in rain. */
export function batActivity(hours: number, raining: boolean): number {
  if (raining) return 0;
  const h = wrap(hours);
  if (h >= 19.3 && h < 22) return 1;
  if (h >= 22 || h < 3) return 0.4;
  if (h >= 4 && h < 5.4) return 0.6;
  return 0;
}

/** Butterflies fly in warm sunshine. */
export function butterflyActivity(hours: number, cloudCover: number, raining: boolean): number {
  const h = wrap(hours);
  if (raining || h < 8.5 || h >= 18) return 0;
  const ramp = Math.min(1, (h - 8.5) / 1.5, (18 - h) / 1.5);
  return Math.max(0, ramp * (1 - cloudCover * 0.85));
}

/** Woodpeckers drum through the morning, less into the afternoon. */
export function woodpeckerActivity(hours: number): number {
  const h = wrap(hours);
  if (h >= 6.5 && h < 13) return 1;
  if (h >= 13 && h < 18) return 0.4;
  return 0;
}

/** Eyes shine in the undergrowth only when it's properly dark. */
export function nightEyesLevel(darkness: number): number {
  return Math.max(0, Math.min(1, (darkness - 0.72) * 4));
}

/** A black bear wanders through the valley now and then, mostly in the morning and evening. */
export function bearActivity(hours: number): number {
  const h = wrap(hours);
  if ((h >= 6 && h < 9) || (h >= 17 && h < 20)) return 1;
  if (h >= 9 && h < 17) return 0.3;
  return 0;
}

/** Elk graze the far slopes in the early light. */
export function elkOut(hours: number): boolean {
  const h = wrap(hours);
  return h >= 5 && h < 7.8;
}

/** How many mushrooms are up (0..1), given the hours since a good rain: they push up, stand a day, and go over. */
export function mushroomLevel(hoursSinceRain: number): number {
  if (!Number.isFinite(hoursSinceRain) || hoursSinceRain < 0) return 0;
  if (hoursSinceRain < 1.5) return hoursSinceRain / 1.5;
  if (hoursSinceRain < 12) return 1;
  return Math.max(0, 1 - (hoursSinceRain - 12) / 8);
}

// --- The shore ------------------------------------------------------------

/** Ghost crabs come out of their burrows at dusk and through the night; a few by day. */
export function crabActivity(hours: number): number {
  const h = wrap(hours);
  if ((h >= 18 && h < 23) || (h >= 4 && h < 7.5)) return 1;
  if (h >= 23 || h < 4) return 0.7;
  return 0.25;
}

/** Hermit crabs trundle over the dry sand at either end of the day, and on dull days. */
export function hermitActivity(hours: number, cloudCover: number): number {
  const h = wrap(hours);
  if ((h >= 6 && h < 9) || (h >= 17 && h < 21)) return 1;
  if (h >= 9 && h < 17) return 0.35 + 0.45 * cloudCover;
  return 0.3;
}

/** Pelicans fish the swell by day, most in the morning and evening. */
export function pelicanActivity(hours: number): number {
  const h = wrap(hours);
  if (h < 6.5 || h >= 19) return 0;
  return (h < 10 || h >= 16) ? 1 : 0.5;
}

/** About one night in four, a bloom in the water makes the breaking surf glow blue. */
export function bioluminescenceNight(key: string): boolean {
  return hash01(`bio:${key}`) < 0.25;
}

/** How brightly the bloom shows: only when it's properly dark, best under a weak moon. */
export function bioluminescenceLevel(darkness: number, moonlight: number): number {
  return Math.max(0, Math.min(1, (darkness - 0.7) * 3.3)) * (1 - 0.5 * moonlight);
}

/** About one night in six, a turtle nest at the foot of the dune hatches. */
export function hatchlingNight(key: string): boolean {
  return hash01(`hatch:${key}`) < 0.17;
}

/** Hatchlings dig out late in the evening, when the sand has cooled. */
export function hatchlingTime(hours: number): boolean {
  const h = wrap(hours);
  return h >= 21.5 || h < 1.5;
}

// --- The farm and its night visitors ------------------------------------------------

/** The sheepdog is sent round the flock now and then through the working day. */
export function sheepdogTime(hours: number): boolean {
  const h = wrap(hours);
  return h >= 8.5 && h < 17.5;
}

/** Hedgehogs snuffle out after dark, through the night. */
export function hedgehogActivity(hours: number, raining: boolean): number {
  const h = wrap(hours);
  if (h >= 21.5 || h < 4.5) return raining ? 0.5 : 1;
  return 0;
}

/** Roe deer step out of the tree line in the half-light of dawn. */
export function roeDeerOut(hours: number): boolean {
  const h = wrap(hours);
  return h >= 5 && h < 7.6;
}
