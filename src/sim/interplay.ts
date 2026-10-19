import type { GroundSpot } from './flock';
import { groundDistance } from './flock';

/**
 * Small shared pieces for creatures noticing one another: how near is too
 * near for each kind of animal, a reaction that keeps some distance in
 * hand before it repeats, and steady per-minute odds that don't depend on
 * the frame rate.
 */

export { groundDistance };

/**
 * Flight distances (ground px): inside this an animal bolts; within about
 * twice it, it stops and watches. Big, wary animals give the widest berth.
 */
export const FLIGHT_DISTANCE = {
  hen: 55,
  rabbit: 60,
  hare: 70,
  hedgehog: 45,
  sheep: 90,
  deer: 120,
  squirrel: 70,
  sandpiper: 40,
  crab: 30,
  gull: 35,
  pigeon: 26,
} as const;

export type Wary = keyof typeof FLIGHT_DISTANCE;
export type Alarm = 'none' | 'watch' | 'bolt';

/** How an animal of `kind` reacts to a threat this far off: bolting inside its flight distance, watching a little beyond it. */
export function alarmAt(kind: Wary, distance: number, threatScale = 1): Alarm {
  const flight = FLIGHT_DISTANCE[kind] * threatScale;
  if (distance < flight) return 'bolt';
  if (distance < flight * 2.2) return 'watch';
  return 'none';
}

/** The same, between two ground spots. */
export function alarmBetween(kind: Wary, animal: GroundSpot, threat: GroundSpot, threatScale = 1): Alarm {
  return alarmAt(kind, groundDistance(animal, threat), threatScale);
}

/** True with `perMinute` odds per minute, whatever the frame step. */
export function chance(perMinute: number, dt: number, rng: () => number = Math.random): boolean {
  return rng() < 1 - Math.exp((-perMinute * dt) / 60);
}

/** A reaction that, once used, rests for a while before it can happen again. */
export class Cooldown {
  private left: number;

  constructor(
    private readonly min: number,
    private readonly max: number,
    initial = 0,
  ) {
    this.left = initial;
  }

  get ready(): boolean {
    return this.left <= 0;
  }

  tick(dt: number): void {
    if (this.left > 0) this.left -= dt;
  }

  /** Use it now (if it's ready); it then rests between `min` and `max` seconds. */
  use(rng: () => number = Math.random): boolean {
    if (this.left > 0) return false;
    this.left = this.min + (this.max - this.min) * rng();
    return true;
  }

  /** Spend a ready reaction only if `odds` come up, so it happens now and then rather than every time it could. */
  maybe(odds: number, rng: () => number = Math.random): boolean {
    if (this.left > 0 || rng() >= odds) return false;
    return this.use(rng);
  }
}

/** A gentle 0..1 window between hours `from` and `to`, ramping over `ramp` hours at each end (wraps past midnight). */
export function hourWindow(hours: number, from: number, to: number, ramp = 0.5): number {
  const h = ((hours % 24) + 24) % 24;
  const span = (((to - from) % 24) + 24) % 24;
  const t = (((h - from) % 24) + 24) % 24;
  if (t > span) return 0;
  return Math.min(1, t / ramp, (span - t) / ramp);
}

// --- Birds' day ------------------------------------------------------------------

/** Dusk: small birds about now settle down for the night where they're perched. */
export function roostTime(hours: number): boolean {
  const h = ((hours % 24) + 24) % 24;
  return h >= 19.4 && h < 22;
}

/** First light: roosting birds wake. */
export function wakeTime(hours: number): boolean {
  const h = ((hours % 24) + 24) % 24;
  return h >= 5.8 && h < 12;
}

// --- Weather lore ------------------------------------------------------------------

/** How likely a cow is to lie down when it next decides what to do: the old saying that cows lie down before rain. */
export function lieBeforeRain(cloudCover: number, precipitation: number): number {
  if (precipitation > 0.05) return 0.15;
  return Math.max(0, Math.min(0.6, (cloudCover - 0.6) * 2.4));
}

/** A warm, still, dry afternoon: the flies are out and tails are swishing. */
export function fliesOut(hours: number, wind: number, cloudCover: number, precipitation: number): number {
  if (precipitation > 0.05 || Math.abs(wind) > 0.35) return 0;
  return hourWindow(hours, 11.5, 18, 1) * (1 - Math.min(1, cloudCover * 1.2)) * (1 - Math.abs(wind) * 2);
}

/** The golden hours, morning and evening, when rabbits play. */
export function goldenHour(hours: number): number {
  return Math.max(hourWindow(hours, 6, 8, 0.5), hourWindow(hours, 18, 20.2, 0.5));
}
