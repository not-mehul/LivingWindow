/**
 * The rooftop cat's behaviour: it pads in along the sill, then wanders,
 * sits, stretches, naps, and stalks any birds it spots, before leaving.
 */
export type CatState = 'enter' | 'walk' | 'sit' | 'stretch' | 'nap' | 'stalk' | 'pounce' | 'exit';

export interface CatContext {
  /** Birds currently on the sill. */
  birdsOnSill: number;
  /** Seconds since the cat arrived. */
  elapsed: number;
  /** How long this visit should last. */
  visitLength: number;
  /** Raining: cats don't linger. */
  wet: boolean;
}

export function chooseCatState(current: CatState, ctx: CatContext, rng: () => number = Math.random): CatState {
  if (ctx.wet || ctx.elapsed > ctx.visitLength) return 'exit';
  if (current === 'stalk') return 'pounce';
  if (current === 'pounce') return 'sit';
  if (ctx.birdsOnSill > 0 && current !== 'nap' && rng() < 0.75) return 'stalk';
  const weights: Array<[CatState, number]> = [
    ['walk', current === 'walk' ? 1 : 3],
    ['sit', current === 'sit' ? 1 : 3],
    ['stretch', current === 'stretch' || current === 'nap' ? (current === 'nap' ? 4 : 0) : 1],
    ['nap', current === 'nap' ? 0 : current === 'sit' ? 2.5 : 0.5],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [state, w] of weights) {
    roll -= w;
    if (roll < 0) return state;
  }
  return 'sit';
}

export function catStateDuration(state: CatState, rng: () => number = Math.random): number {
  const r = (min: number, max: number) => min + (max - min) * rng();
  switch (state) {
    case 'sit':
      return r(5, 16);
    case 'stretch':
      return r(1.8, 3);
    case 'nap':
      return r(25, 80);
    case 'pounce':
      return 0.45;
    default:
      return 0; // walking states end on arrival
  }
}

/** Walking speeds along the sill, in art px per second. */
export const CAT_WALK_SPEED = 18;
export const CAT_STALK_SPEED = 7;
/** Seconds between visits (min, max): the cat is a rare treat. */
export const CAT_VISIT_INTERVAL: readonly [number, number] = [6 * 60, 14 * 60];
/** The first visit comes sooner so it can actually be met. */
export const CAT_FIRST_VISIT: readonly [number, number] = [90, 240];
