import type { SpeciesId } from '../sprites/birdSprites';

/**
 * The bird finite state machine from the design document:
 * FLY_IN → PERCH_IDLE ⇄ LOOK_AROUND ⇄ HOP ⇄ PECK_SEED ⇄ CHIRP → TAKE_OFF → FLY_AWAY.
 * Transitions are weighted dice rolls, never a fixed loop, and the weights
 * depend on species, where the bird is and whether there is seed.
 */
export type BirdState =
  | 'fly-in'
  | 'perch-idle'
  | 'look-around'
  | 'hop'
  | 'peck-seed'
  | 'chirp'
  | 'take-off'
  | 'fly-away';

export const PERCHED_STATES: readonly BirdState[] = ['perch-idle', 'look-around', 'hop', 'peck-seed', 'chirp'];

export interface Temperament {
  chirp: number;
  hop: number;
  peck: number;
  look: number;
  /** Seconds a visit lasts before the bird grows restless (min, max). */
  stay: readonly [number, number];
  /** Flight speed in world px/s at full scale. */
  speed: number;
  flapRate: number;
  /** How readily it glides between flaps (0..1). */
  glide: number;
  /** How close (sill art px) a threat may come before it bolts. */
  wariness: number;
}

export const TEMPERAMENTS: Record<SpeciesId, Temperament> = {
  pigeon: { chirp: 0.8, hop: 1.2, peck: 2.2, look: 2, stay: [25, 70], speed: 150, flapRate: 9, glide: 0.5, wariness: 40 },
  sparrow: { chirp: 2.6, hop: 3, peck: 1.6, look: 2.6, stay: [12, 40], speed: 170, flapRate: 15, glide: 0.15, wariness: 55 },
  crow: { chirp: 1.6, hop: 1, peck: 1.2, look: 2.4, stay: [20, 60], speed: 140, flapRate: 7, glide: 0.6, wariness: 70 },
  woodpecker: { chirp: 0.8, hop: 1, peck: 3.2, look: 1.6, stay: [20, 55], speed: 150, flapRate: 11, glide: 0.4, wariness: 60 },
  jay: { chirp: 2, hop: 2, peck: 1.4, look: 2.6, stay: [15, 45], speed: 160, flapRate: 10, glide: 0.35, wariness: 65 },
  chickadee: { chirp: 3, hop: 3.2, peck: 1.8, look: 2.6, stay: [10, 35], speed: 175, flapRate: 17, glide: 0.1, wariness: 45 },
  finch: { chirp: 2.8, hop: 2.6, peck: 2, look: 2.2, stay: [12, 40], speed: 170, flapRate: 15, glide: 0.15, wariness: 55 },
  bluebird: { chirp: 2.4, hop: 2, peck: 1.4, look: 2.4, stay: [12, 40], speed: 165, flapRate: 14, glide: 0.2, wariness: 55 },
  robin: { chirp: 2.2, hop: 2.4, peck: 2.2, look: 2.4, stay: [15, 50], speed: 160, flapRate: 12, glide: 0.25, wariness: 50 },
  seagull: { chirp: 1.8, hop: 1, peck: 1.6, look: 2.2, stay: [25, 80], speed: 145, flapRate: 6, glide: 0.8, wariness: 45 },
  sandpiper: { chirp: 1.2, hop: 2.5, peck: 3, look: 1.4, stay: [15, 45], speed: 180, flapRate: 16, glide: 0.2, wariness: 60 },
  owl: { chirp: 1.4, hop: 0.2, peck: 0.3, look: 3.2, stay: [60, 180], speed: 120, flapRate: 6, glide: 0.7, wariness: 50 },
  eagle: { chirp: 0.4, hop: 0, peck: 0.3, look: 2, stay: [40, 90], speed: 130, flapRate: 4, glide: 0.95, wariness: 80 },
};

export interface PerchContext {
  species: SpeciesId;
  onSill: boolean;
  /** Standing right beside the bowl. */
  atBowl: boolean;
  /** Seed is in the bowl. */
  seedAvailable: boolean;
  /** Room to hop along this perch. */
  canHop: boolean;
  /** 0 = just arrived, 1 = ready to leave. */
  restlessness: number;
}

type Weighted = Array<[BirdState, number]>;

export function transitionWeights(current: BirdState, ctx: PerchContext): Weighted {
  const t = TEMPERAMENTS[ctx.species];
  const feeding = ctx.atBowl && ctx.seedAvailable;
  const wantsBowl = ctx.onSill && ctx.seedAvailable && !ctx.atBowl;
  const weights: Weighted = [
    ['perch-idle', current === 'perch-idle' ? 0.6 : 2],
    ['look-around', t.look],
    ['hop', ctx.canHop ? (wantsBowl ? 7 : t.hop) : 0],
    // Seed draws them in; otherwise they forage at the odd crumb.
    ['peck-seed', feeding ? t.peck * 4 : t.peck * 0.35],
    ['chirp', current === 'chirp' ? t.chirp * 0.3 : t.chirp],
    ['take-off', 0.04 + 6 * ctx.restlessness ** 2 * (feeding ? 0.4 : 1)],
  ];
  return weights.filter(([, w]) => w > 0);
}

export function chooseNextState(current: BirdState, ctx: PerchContext, rng: () => number = Math.random): BirdState {
  const weights = transitionWeights(current, ctx);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [state, w] of weights) {
    roll -= w;
    if (roll < 0) return state;
  }
  return weights[weights.length - 1][0];
}

/** How long a bird holds a state before rolling again (seconds). */
export function stateDuration(state: BirdState, species: SpeciesId, rng: () => number = Math.random): number {
  const r = (min: number, max: number) => min + (max - min) * rng();
  switch (state) {
    case 'perch-idle':
      return r(1.2, 4);
    case 'look-around':
      return r(0.8, 2.4);
    case 'hop':
      return species === 'sparrow' ? 0.28 : 0.36;
    case 'peck-seed':
      return r(0.8, 2.6);
    case 'chirp':
      return species === 'pigeon' ? r(1, 1.6) : r(0.6, 1.2);
    case 'take-off':
      return 0.35;
    default:
      return 0;
  }
}

/** Seconds per peck while in PECK_SEED. */
export const PECK_INTERVAL = 0.42;
/** Seed eaten by one peck at the bowl (a full bowl lasts several minutes). */
export const SEED_PER_PECK = 0.0035;
