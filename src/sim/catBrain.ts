/**
 * The rooftop cat's behaviour: it pads in along the sill, then wanders,
 * sits, washes, loafs, yawns, stretches, naps, chatters at birds or stalks
 * them, before leaving.
 */
export type CatState = 'enter' | 'walk' | 'sit' | 'groom' | 'loaf' | 'yawn' | 'stretch' | 'nap' | 'stalk' | 'pounce' | 'chatter' | 'exit';

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
  const napped = current === 'nap';
  const settled = current === 'sit' || current === 'loaf';
  const weights: Array<[CatState, number]> = [
    ['walk', current === 'walk' ? 1 : napped ? 1.5 : 3],
    ['sit', current === 'sit' ? 1 : napped ? 2 : 3],
    ['stretch', napped ? 4 : current === 'stretch' ? 0 : current === 'loaf' ? 1.5 : 1],
    ['nap', napped ? 0 : settled ? 2 : 0.4],
    ['groom', current === 'groom' ? 0 : current === 'sit' ? 2 : 1],
    ['loaf', current === 'loaf' || napped ? 0 : 1.2],
    ['yawn', current === 'yawn' ? 0 : napped ? 2 : 0.6],
    // Birds it didn't go after: it sits and chatters at them instead.
    ['chatter', ctx.birdsOnSill > 0 && current !== 'chatter' ? 3 : 0],
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
      return r(2.4, 3.4);
    case 'groom':
      return r(6, 14);
    case 'loaf':
      return r(15, 45);
    case 'yawn':
      return r(1.7, 2.1);
    case 'chatter':
      return r(3, 7);
    case 'nap':
      return r(25, 80);
    case 'pounce':
      // The wiggle (0.9 s), then the leap.
      return 1.45;
    default:
      return 0; // walking states end on arrival
  }
}

/** Walking speeds along the sill, in art px per second. */
export const CAT_WALK_SPEED = 22;
export const CAT_STALK_SPEED = 8;
/** Seconds between visits (min, max): the cat is a rare treat. */
export const CAT_VISIT_INTERVAL: readonly [number, number] = [6 * 60, 14 * 60];
/** The first visit comes sooner so it can actually be met. */
export const CAT_FIRST_VISIT: readonly [number, number] = [90, 240];
