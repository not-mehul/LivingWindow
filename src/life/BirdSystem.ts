import { Container, Graphics, Sprite } from 'pixi.js';
import { clamp, lerp } from '../core/math';
import type { Viewport } from '../core/Viewport';
import type { Environment } from '../scene/Environment';
import type { SoundId } from '../audio/sounds/SoundBank';
import {
  chooseNextState,
  PECK_INTERVAL,
  PERCHED_STATES,
  SEED_PER_PECK,
  stateDuration,
  TEMPERAMENTS,
  type BirdState,
} from '../sim/birdBrain';
import { perspectiveScale, spriteSizeAt } from '../sim/perspective';
import { birdActivity } from '../audio/soundscapes/schedules';
import { interiorTint } from '../scene/lighting';
import type { BirdseedState } from '../state/BirdseedState';
import { BirdSpriteCache, FLAP_CYCLE, SPECIES, type BirdPose, type SpeciesId } from '../sprites/birdSprites';
import { FLAP_CYCLE_6 } from '../sprites/birdClose';

/**
 * A bird's sprite size near the window: drawn a little larger than the
 * world's perspective alone would make it, so a bird on the sill shows its
 * detail, easing back to perspective size as it flies off into the view.
 */
function nearSize(z: number, relative: number): number {
  const boost = 1 + 0.35 * Math.max(0, 1 - z / NEAR_Z);
  return Math.round(spriteSizeAt(z, relative) * boost);
}

/** How long each frame of a little standing-about action shows (s). */
const MICRO_FRAME = 0.16;
const MICRO: Record<'blink' | 'tilt' | 'tail' | 'preen' | 'scratch' | 'fluff' | 'shake', readonly BirdPose[]> = {
  blink: ['blink'],
  tilt: ['tilt', 'tilt', 'tilt', 'tilt', 'idle', 'look-up'],
  tail: ['tail-flick', 'idle', 'tail-flick'],
  preen: ['preen-1', 'preen-2', 'preen-1', 'preen-2', 'preen-1', 'preen-2', 'preen-1', 'idle', 'blink'],
  scratch: ['scratch-1', 'scratch-2', 'scratch-1', 'scratch-2', 'scratch-1', 'scratch-2', 'idle'],
  fluff: ['fluff', 'fluff', 'fluff', 'fluff', 'fluff', 'fluff', 'fluff', 'fluff', 'idle-breathe'],
  /** Shaking the wet off after rain. */
  shake: ['fluff', 'idle', 'fluff', 'idle', 'fluff', 'preen-1', 'idle'],
};
/** A bath in the puddle: ducking in, flicking water over its back, a fluffed-up shake. */
const BATHE: readonly BirdPose[] = ['peck-down', 'fluff', 'peck-down', 'fluff', 'peck-down', 'fluff', 'fluff', 'scratch-1', 'fluff', 'idle'];
/** Birds that settle for the night where they are, rather than flying off at dusk. */
const ROOSTERS: readonly SpeciesId[] = ['pigeon', 'sparrow', 'finch', 'chickadee', 'robin', 'bluebird'];
import { sillWidth, type Ledge, type LifeSoundSink, type SillState, sillScreenX } from './types';
import { sillContacts } from '../window/sillContacts';
import { SongBudget } from './songBudget';
import { roostTime, wakeTime } from '../sim/interplay';

/** Below this depth birds are drawn in screen space, at the window's pixel scale. */
const NEAR_Z = 0.33;
const MAX_BIRDS = 14;
const MAX_SILL_BIRDS = 3;
/** Minimum gap between birds on the sill, in art px (a sparrow is ~29 px wide). */
const SILL_SPACING = 24;

const LAYER_Z = { far: 0.92, mid: 0.8, near: 0.62 } as const;
const KIND_Z: Record<string, number> = { lamp: 0.68, sidewalk: 0.72 };

export const SPECIES_VOICE: Record<SpeciesId, SoundId> = {
  pigeon: 'pigeon-coo',
  sparrow: 'sparrow-chirp',
  crow: 'crow-caw',
  woodpecker: 'woodpecker-drum',
  jay: 'jay-call',
  chickadee: 'chickadee-call',
  finch: 'finch-song',
  bluebird: 'bluebird-song',
  robin: 'robin-song',
  seagull: 'gull-cry',
  sandpiper: 'sandpiper-peep',
  owl: 'owl-hoot',
};

/**
 * Which birds live in a landscape and when they're about. Each scene
 * supplies its own; the default is the city.
 */
export interface BirdEcology {
  /** Relative odds of each species turning up, for the hour and weather. */
  mix: (hours: number, env: Environment) => Partial<Record<SpeciesId, number>>;
  /** Overall bird activity 0..1 (defaults to the daytime chorus). */
  activity?: (env: Environment) => number;
  /** Species that never land on the sill. */
  shySpecies?: readonly SpeciesId[];
  /** At most this many of a species at once. */
  maxPerSpecies?: Partial<Record<SpeciesId, number>>;
  /** Species seen as distant flocks; empty for none. */
  flockSpecies?: readonly SpeciesId[];
  /** Preference of a species for a kind of perch (default 1). */
  perchPreference?: (species: SpeciesId, kind: string) => number;
}

export const CITY_ECOLOGY: BirdEcology = {
  mix: (hours) => {
    const dusk = (hours > 17.5 && hours < 20.5) || (hours > 5 && hours < 7);
    const crow = dusk ? 0.3 : 0.12;
    return { crow, pigeon: 0.45, sparrow: 1 - crow - 0.45 };
  },
  shySpecies: [],
  flockSpecies: ['pigeon', 'pigeon', 'crow'],
  perchPreference: (species, kind) =>
    (kind === 'sidewalk' ? (species === 'pigeon' ? 3 : 0.5) : 1) *
    (kind === 'antenna' ? (species === 'crow' ? 2 : species === 'sparrow' ? 0 : 1) : 1),
};

/** Daytime activity: the dawn chorus, quiet nights, fewer birds in bad weather. */
export function defaultActivity(env: Environment): number {
  const { weather } = env;
  let a = birdActivity(env.lighting.hours);
  if (weather.kind === 'rain') a *= 1 - Math.min(1, weather.precipitation * 1.6);
  if (weather.kind === 'snow') a *= 1 - 0.5 * weather.precipitation;
  return a * (1 - weather.lightning);
}

interface Perch {
  ledge: Ledge;
  z: number;
  occupants: Set<Bird>;
  capacity: number;
}

interface Flight {
  from: { x: number; y: number; z: number };
  /** Fixed destination, or a function for moving targets (the sill pans with the view). */
  to: () => { x: number; y: number; z: number };
  arc: number;
  t: number;
  duration: number;
  /** What happens on arrival. */
  arrive: { kind: 'perch'; perch: Perch; x: number } | { kind: 'sill'; sillX: number } | { kind: 'leave' };
}

interface Bird {
  id: number;
  species: SpeciesId;
  state: BirdState;
  timer: number;
  duration: number;
  /** Where the bird is: in the world, or standing on the sill (screen space). */
  onSill: boolean;
  x: number;
  y: number;
  z: number;
  sillX: number;
  facing: 1 | -1;
  perch: Perch | null;
  flight: Flight | null;
  stay: number;
  stayLength: number;
  flap: number;
  glide: number;
  peckTimer: number;
  hop: { from: number; to: number; t: number } | null;
  pose: BirdPose;
  poseTimer: number;
  /** A little action while it stands about (a blink, a preen, a scratch …): its frames and how far through. */
  micro: { frames: readonly BirdPose[]; step: number; t: number } | null;
  microIn: number;
  startleIn: number | null;
  sprite: Sprite;
  shadow: Graphics;
  /** Settled for the night: head tucked in, until the morning. */
  roosting: boolean;
  /** Bathing in the sill puddle (the steps of the bath already splashed). */
  bathing?: boolean;
}

interface Flock {
  sprites: Sprite[];
  offsets: Array<{ x: number; y: number; phase: number }>;
  x: number;
  y: number;
  z: number;
  vx: number;
  species: SpeciesId;
  flap: number;
}

export interface BirdLayers {
  far: Container;
  mid: Container;
  near: Container;
}

export interface BirdSystemOptions {
  ledges: Ledge[];
  worldLayers: BirdLayers;
  /** Screen-space container for birds flying close to the window. */
  nearLayer: Container;
  /** Screen-space container on the sill (birds stand here). */
  sillLayer: Container;
  viewport: Viewport;
  birdseed: BirdseedState;
  sound: LifeSoundSink;
  /** Return false to ignore a tap (e.g. it ended a pan). */
  canTap: () => boolean;
  ecology?: BirdEcology;
  rng?: () => number;
}

/**
 * Every bird in the scene: the director that sends them in, their state
 * machines, flight paths that grow them as they near the window, their
 * perches (rooftops, antennas, lamps, the street and the sill), and how they
 * scatter from threats.
 */
const NO_SWAY = { x: 0, y: 0 };

export class BirdSystem {
  private readonly birds: Bird[] = [];
  private readonly flocks: Flock[] = [];
  private readonly perches: Perch[];
  private readonly sprites = new BirdSpriteCache();
  private readonly rng: () => number;
  private readonly ecology: BirdEcology;
  private nextId = 1;
  private spawnTimer = 2;
  private flockTimer = 8;
  private sill: SillState | null = null;
  private env: Environment | null = null;
  private readonly songs = new SongBudget();
  private wasRaining = false;
  /** Seconds since the rain stopped (birds shake themselves off and preen), or Infinity. */
  private sinceRain = Infinity;

  constructor(private readonly options: BirdSystemOptions) {
    this.rng = options.rng ?? Math.random;
    this.ecology = options.ecology ?? CITY_ECOLOGY;
    this.perches = options.ledges.map((ledge) => ({
      ledge,
      z: ledge.z ?? KIND_Z[ledge.kind] ?? LAYER_Z[ledge.layer],
      occupants: new Set<Bird>(),
      capacity: ledge.kind === 'sidewalk' ? 6 : Math.max(1, Math.floor((ledge.x1 - ledge.x0 + 1) / 6)),
    }));
  }

  get count(): number {
    return this.birds.length;
  }

  /** Sill positions (art px) of the birds standing there, for the cat to eye up. */
  sillBirds(): number[] {
    return this.birds.filter((b) => b.onSill).map((b) => b.sillX);
  }

  update(dt: number, env: Environment, sill: SillState): void {
    this.env = env;
    this.songs.tick(dt, birdActivity(env.lighting.hours));
    this.sill = sill;
    const activity = this.activity(env);

    // Rain sends birds for shelter as it starts.
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.15;
    if (raining && !this.wasRaining) this.startleAll(0.7);
    if (raining) this.sinceRain = 0;
    else this.sinceRain += dt;
    this.wasRaining = raining;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = (2 + this.rng() * 6) / Math.max(0.05, activity);
      if (activity > 0.03 && this.birds.length < MAX_BIRDS) this.spawn(sill);
    }
    this.flockTimer -= dt;
    if (this.flockTimer <= 0) {
      this.flockTimer = 20 + this.rng() * 50;
      const flockers = this.ecology.flockSpecies ?? [];
      if (activity > 0.1 && env.weather.lightning < 0.3 && flockers.length > 0) {
        this.spawnFlock(flockers[Math.floor(this.rng() * flockers.length)]);
      }
    }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const bird = this.birds[i];
      if (this.step(bird, dt, sill)) {
        this.remove(i);
        continue;
      }
      this.render(bird, sill);
    }
    this.updateFlocks(dt);
  }

  /** Scare birds: from the closing window, a lightning crack, or rain. */
  startleAll(probability: number, sillOnly = false): void {
    for (const bird of this.birds) {
      if (sillOnly && !bird.onSill) continue;
      if (this.rng() < probability) this.startle(bird);
    }
  }

  /** Birds flying close past the window right now: where they are along the sill (art px). */
  nearFlights(sill: SillState): number[] {
    const fs = sill.surface.frameScale;
    return this.birds.filter((b) => b.flight && !b.onSill && b.z < NEAR_Z && b.sprite.parent === this.options.nearLayer).map((b) => (b.sprite.x - sill.surface.left) / fs);
  }

  /** How many birds are roosting for the night. */
  get roosting(): number {
    return this.birds.filter((b) => b.roosting).length;
  }

  /** Scare the birds on the sill within `radius` art px of `sillX`. */
  startleNear(sillX: number, radius: number): void {
    for (const bird of this.birds) {
      if (bird.onSill && Math.abs(bird.sillX - sillX) < radius) this.startle(bird);
    }
  }

  /** A tap on the screen: shoos away any bird under it. Returns true if one was hit. */
  tap(screenX: number, screenY: number): boolean {
    if (!this.options.canTap()) return false;
    const { viewport } = this.options;
    // Nearest the viewer first: a bird on the sill beats one on the street behind it.
    const byDepth = [...this.birds].sort((a, b) => (a.onSill ? 0 : a.z) - (b.onSill ? 0 : b.z));
    for (const bird of byDepth) {
      if (!PERCHED_STATES.includes(bird.state) && bird.state !== 'fly-in') continue;
      const { x, y, half } = this.screenBounds(bird, viewport);
      if (Math.abs(screenX - x) < half && Math.abs(screenY - y) < half) {
        this.startle(bird);
        return true;
      }
    }
    return false;
  }

  /** Spawn a bird heading for the sill straight away (for demos and tests). */
  summonToSill(species: SpeciesId = 'sparrow'): boolean {
    if (!this.sill) return false;
    const target = this.chooseSillSpot(this.sill);
    if (target === null) return false;
    this.createBird(species, this.sill, { kind: 'sill', sillX: target });
    return true;
  }

  /** Bring a few birds down to a perch near a world point (e.g. where someone scatters crumbs). Returns how many came. */
  summonToPerchNear(x: number, y: number, species: SpeciesId, count: number, reach = 12): number {
    const sill = this.sill;
    if (!sill) return 0;
    const perch = this.perches
      .filter((p) => p.ledge.x0 <= x + 40 + reach && p.ledge.x1 >= x - 40 - reach && Math.abs(p.ledge.y - y) < reach)
      .sort((a, b) => Math.abs(a.ledge.y - y) - Math.abs(b.ledge.y - y))[0];
    if (!perch) return 0;
    let n = 0;
    for (let i = 0; i < count && perch.occupants.size < perch.capacity && this.birds.length < MAX_BIRDS; i++) {
      const px = Math.max(perch.ledge.x0, Math.min(perch.ledge.x1, Math.round(x + (this.rng() - 0.5) * 50)));
      this.createBird(species, sill, { kind: 'perch', perch, x: px });
      n++;
    }
    return n;
  }

  // --- Director -------------------------------------------------------

  private activity(env: Environment): number {
    return (this.ecology.activity ?? defaultActivity)(env);
  }

  /** Roll a species from the ecology's mix, respecting per-species caps. */
  private pickSpecies(env: Environment): SpeciesId | null {
    const mix = this.ecology.mix(env.lighting.hours, env);
    const caps = this.ecology.maxPerSpecies ?? {};
    const options = (Object.entries(mix) as Array<[SpeciesId, number]>).filter(([species, w]) => {
      const cap = caps[species];
      return w > 0 && (cap === undefined || this.birds.filter((b) => b.species === species).length < cap);
    });
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.rng() * total;
    for (const [species, w] of options) {
      roll -= w;
      if (roll < 0) return species;
    }
    return null;
  }

  private spawn(sill: SillState): void {
    const env = this.env;
    if (!env) return;
    const species = this.pickSpecies(env);
    if (!species) return;
    const sillBirds = this.birds.filter((b) => b.onSill || b.flight?.arrive.kind === 'sill').length;
    const shy = this.ecology.shySpecies ?? [];
    const sillOk = sill.windowOpen && sill.catX === null && sillBirds < MAX_SILL_BIRDS && !shy.includes(species);
    const chanceSill = clamp(0.1 * this.options.birdseed.attraction, 0, 0.75);
    if (sillOk && this.rng() < chanceSill) {
      const spot = this.chooseSillSpot(sill);
      if (spot !== null) {
        this.createBird(species, sill, { kind: 'sill', sillX: spot });
        return;
      }
    }
    // Otherwise somewhere in the city, preferring perches in view.
    const perch = this.choosePerch(species);
    if (perch) {
      const x = lerp(perch.ledge.x0, perch.ledge.x1, this.rng());
      this.createBird(species, sill, { kind: 'perch', perch, x: Math.round(x) });
    }
  }

  private choosePerch(species: SpeciesId): Perch | null {
    const { viewport } = this.options;
    const left = viewport.panX - 40;
    const right = viewport.visibleRight + 40;
    const preference = this.ecology.perchPreference ?? (() => 1);
    const weight = (p: Perch) => preference(species, p.ledge.kind);
    const candidates = this.perches.filter(
      (p) => p.occupants.size < p.capacity && p.ledge.x1 >= left && p.ledge.x0 <= right && weight(p) > 0,
    );
    if (candidates.length === 0) return null;
    const total = candidates.reduce((s, p) => s + weight(p), 0);
    let roll = this.rng() * total;
    for (const p of candidates) {
      roll -= weight(p);
      if (roll < 0) return p;
    }
    return candidates[0];
  }

  private chooseSillSpot(sill: SillState): number | null {
    const width = sillWidth(sill);
    const taken = this.birds
      .map((b) => (b.onSill ? b.sillX : b.flight?.arrive.kind === 'sill' ? b.flight.arrive.sillX : null))
      .filter((x): x is number => x !== null);
    const free = (x: number) => taken.every((t) => Math.abs(t - x) >= SILL_SPACING) && x > 12 && x < width - 12;
    // A puddle after rain: some come down to bathe in it.
    const puddle = sill.puddleX;
    if (puddle !== null && puddle !== undefined && this.rng() < 0.5) {
      for (const side of [6, -6]) if (free(puddle + side)) return Math.round(puddle + side);
    }
    // With seed out, land beside the bowl.
    if (this.options.birdseed.isStocked) {
      const reach = sill.bowlHalfWidth + 14;
      const sides = this.rng() < 0.5 ? [-reach, reach] : [reach, -reach];
      for (const side of sides) if (free(sill.bowlX + side)) return sill.bowlX + side;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = 14 + this.rng() * (width - 28);
      if (free(x) && Math.abs(x - sill.bowlX) > sill.bowlHalfWidth + 10) return Math.round(x);
    }
    return null;
  }

  private createBird(species: SpeciesId, sill: SillState, arrive: Flight['arrive']): void {
    const { viewport } = this.options;
    const visible = viewport.layout.visibleWorldWidth;
    const fromLeft = this.rng() < 0.5;
    const start = {
      x: viewport.panX + (fromLeft ? -0.1 : 1.1) * visible + (this.rng() - 0.5) * 60,
      y: 20 + this.rng() * 120,
      z: 0.55 + this.rng() * 0.25,
    };
    if (arrive.kind === 'perch') {
      start.x = arrive.x + (fromLeft ? -1 : 1) * (80 + this.rng() * 160);
      start.y = Math.max(-10, arrive.perch.ledge.y - 60 - this.rng() * 120);
      start.z = Math.min(0.98, arrive.perch.z + 0.04);
    }
    const sprite = new Sprite({ anchor: { x: 0.5, y: 0.5 } });
    sprite.eventMode = 'none';
    const shadow = new Graphics();
    shadow.eventMode = 'none';
    const bird: Bird = {
      id: this.nextId++,
      species,
      state: 'fly-in',
      timer: 0,
      duration: 0,
      onSill: false,
      ...start,
      sillX: 0,
      facing: fromLeft ? 1 : -1,
      perch: null,
      flight: null,
      stay: 0,
      stayLength: 0,
      flap: this.rng(),
      glide: 0,
      peckTimer: 0,
      hop: null,
      pose: 'fly-mid',
      poseTimer: 0,
      micro: null,
      microIn: 1 + this.rng() * 3,
      roosting: false,
      startleIn: null,
      sprite,
      shadow,
    };
    bird.flight = this.planFlight(bird, arrive, sill);
    if (arrive.kind === 'perch') arrive.perch.occupants.add(bird);
    this.birds.push(bird);
  }

  // --- Behaviour ------------------------------------------------------

  /** Advance one bird. Returns true when it has left the scene. */
  private step(bird: Bird, dt: number, sill: SillState): boolean {
    const t = TEMPERAMENTS[bird.species];

    if (bird.startleIn !== null) {
      bird.startleIn -= dt;
      if (bird.startleIn <= 0) {
        bird.startleIn = null;
        this.enter(bird, 'take-off');
      }
    }

    // Sill visitors bolt if the window shuts or the cat comes too close.
    if (bird.onSill && PERCHED_STATES.includes(bird.state) && bird.startleIn === null) {
      const catNear =
        sill.catX !== null && Math.abs(sill.catX - bird.sillX) < t.wariness * (sill.catStalking ? 1.3 : 0.7);
      if (!sill.windowOpen || catNear) this.startle(bird);
    }

    if (bird.flight) {
      const done = this.fly(bird, dt);
      if (done) return this.land(bird, sill);
      return false;
    }

    bird.timer += dt;
    bird.stay += dt;
    this.animatePerched(bird, dt, sill);

    if (bird.state === 'take-off') {
      if (bird.timer >= bird.duration) this.depart(bird, sill);
      return false;
    }
    // Dusk: some small birds settle down where they are for the night, and stay till morning.
    const hours = this.env?.lighting.hours ?? 12;
    if (bird.roosting) {
      if (wakeTime(hours)) {
        // Morning: awake, a stretch and a preen, and then about its day.
        bird.roosting = false;
        bird.stay = 0;
        bird.micro = { frames: MICRO.preen, step: 0, t: 0 };
        this.enter(bird, 'perch-idle');
      } else {
        bird.timer = 0;
        return false;
      }
    } else if (!bird.onSill && bird.state === 'perch-idle' && ROOSTERS.includes(bird.species) && roostTime(hours) && bird.timer >= bird.duration) {
      if (this.rng() < 0.6) {
        bird.roosting = true;
        bird.micro = null;
        return false;
      }
    }
    if (bird.timer >= bird.duration) {
      const atBowl = bird.onSill && this.atBowl(bird, sill);
      const width = bird.onSill ? sillWidth(sill) : 0;
      const next = chooseNextState(bird.state, {
        species: bird.species,
        onSill: bird.onSill,
        atBowl,
        seedAvailable: this.options.birdseed.isStocked,
        canHop: bird.onSill ? width > 40 : (bird.perch?.ledge.x1 ?? 0) - (bird.perch?.ledge.x0 ?? 0) > 6,
        restlessness: clamp(bird.stay / bird.stayLength, 0, 1),
      }, this.rng);
      this.enter(bird, next);
    }
    return false;
  }

  private enter(bird: Bird, state: BirdState): void {
    const sill = this.sill;
    bird.state = state;
    bird.timer = 0;
    bird.duration = stateDuration(state, bird.species, this.rng);
    bird.poseTimer = 0;
    switch (state) {
      case 'look-around':
        if (this.rng() < 0.35) bird.facing = bird.facing === 1 ? -1 : 1;
        break;
      case 'hop': {
        const step = (bird.onSill ? 6 : 1.5) + this.rng() * (bird.onSill ? 10 : 2.5);
        let to: number;
        const from = bird.onSill ? bird.sillX : bird.x;
        if (bird.onSill && sill && this.options.birdseed.isStocked && !this.atBowl(bird, sill)) {
          // Hop towards the bowl's nearest feeding spot.
          const reach = sill.bowlHalfWidth + SPECIES[bird.species].size * 48 * 0.28;
          const spot = bird.sillX < sill.bowlX ? sill.bowlX - reach : sill.bowlX + reach;
          to = from + clamp(spot - from, -step, step);
        } else {
          to = from + (this.rng() < 0.5 ? -step : step);
        }
        if (bird.onSill && sill) to = clamp(to, 12, sillWidth(sill) - 12);
        else if (bird.perch) to = clamp(to, bird.perch.ledge.x0, bird.perch.ledge.x1);
        if (this.collides(bird, to)) to = from;
        bird.facing = to >= from ? 1 : -1;
        bird.hop = { from, to, t: 0 };
        break;
      }
      case 'peck-seed':
        bird.peckTimer = 0;
        // Woodpeckers drum on wood rather than pecking the ground.
        if (bird.species === 'woodpecker' && !bird.onSill && this.rng() < 0.6) this.sound(bird, 'woodpecker-drum');
        if (bird.onSill && sill && this.atBowl(bird, sill)) bird.facing = bird.sillX < sill.bowlX ? 1 : -1;
        break;
      case 'chirp':
        this.voice(bird);
        break;
      case 'take-off':
        this.sound(bird, 'wing-flap');
        break;
    }
  }

  private animatePerched(bird: Bird, dt: number, sill: SillState): void {
    bird.poseTimer += dt;
    switch (bird.state) {
      case 'perch-idle': {
        const weather = this.env?.weather;
        bird.pose = Math.floor(bird.poseTimer / 0.7) % 2 === 0 ? 'idle' : 'idle-breathe';
        // Roosting: head tucked in, now and then lifted to look about.
        if (bird.roosting) {
          bird.pose = bird.poseTimer % 11 < 0.8 ? 'idle' : 'sleep';
          break;
        }
        // In the snow, puffed up round against the cold.
        if (weather?.kind === 'snow' && weather.precipitation > 0.1 && !bird.micro) bird.pose = Math.floor(bird.poseTimer / 1.6) % 3 === 2 ? 'idle-breathe' : 'fluff';
        // On the sill in a stiff breeze, it turns to face into the wind.
        if (bird.onSill && weather && Math.abs(weather.wind) > 0.45) bird.facing = weather.wind > 0 ? -1 : 1;
        // An owl blinks slowly now and then.
        if (bird.species === 'owl' && bird.poseTimer % 4.3 < 0.22) bird.pose = 'sleep';
        else this.microAction(bird, dt);
        break;
      }
      case 'look-around': {
        const phase = Math.floor(bird.poseTimer / 0.45) % 3;
        bird.pose = phase === 0 ? 'look-up' : phase === 1 ? 'idle' : 'look-back';
        break;
      }
      case 'hop': {
        // Crouch, spring, sail through the air, land.
        const t = bird.hop ? bird.hop.t : 1;
        bird.pose = t < 0.14 ? 'hop-crouch' : t < 0.86 ? 'hop-air' : 'hop-land';
        if (bird.hop) {
          bird.hop.t = Math.min(1, bird.timer / bird.duration);
          const x = lerp(bird.hop.from, bird.hop.to, bird.hop.t);
          if (bird.onSill) bird.sillX = x;
          else bird.x = x;
          if (bird.hop.t >= 1) bird.hop = null;
        }
        break;
      }
      case 'peck-seed': {
        bird.peckTimer += dt;
        const inPeck = bird.peckTimer % PECK_INTERVAL;
        bird.pose = inPeck < PECK_INTERVAL * 0.35 ? 'peck-reach' : inPeck < PECK_INTERVAL * 0.7 ? 'peck-down' : 'peck-swallow';
        if (bird.peckTimer >= PECK_INTERVAL) {
          bird.peckTimer -= PECK_INTERVAL;
          if (bird.onSill && this.atBowl(bird, sill)) this.options.birdseed.consume(SEED_PER_PECK);
        }
        break;
      }
      case 'chirp':
        bird.pose = (['chirp', 'chirp-2', 'chirp', 'idle'] as const)[Math.floor(bird.poseTimer / 0.12) % 4];
        break;
      case 'take-off':
        // A crouch, then the spring into the first wingbeat.
        bird.pose = bird.poseTimer < 0.12 ? 'takeoff-1' : 'takeoff-2';
        break;
    }
  }

  /** Now and then, while it stands about, a bird does something small: blinks, cocks its head, preens, scratches, fluffs up, flicks its tail. */
  private microAction(bird: Bird, dt: number): void {
    if (bird.micro) {
      const m = bird.micro;
      m.t += dt;
      const each = MICRO_FRAME;
      if (m.t >= each) {
        m.t -= each;
        m.step++;
        // Each duck into the puddle sends up a little splash.
        if (bird.bathing && m.frames[m.step] === 'peck-down' && this.sill) sillContacts.splash(sillScreenX(this.sill, bird.sillX));
      }
      if (m.step >= m.frames.length) {
        bird.micro = null;
        bird.bathing = false;
      } else bird.pose = m.frames[m.step];
      return;
    }
    bird.microIn -= dt;
    if (bird.microIn > 0) return;
    bird.microIn = 1.2 + this.rng() * 4;
    // At the puddle: a bath.
    const puddle = this.sill?.puddleX;
    if (bird.onSill && puddle !== null && puddle !== undefined && Math.abs(bird.sillX - puddle) < 14 && this.rng() < 0.7) {
      bird.micro = { frames: BATHE, step: 0, t: 0 };
      bird.bathing = true;
      bird.pose = BATHE[0];
      sillContacts.splash(sillScreenX(this.sill!, bird.sillX));
      return;
    }
    const roll = this.rng();
    // Just after rain they shake the wet off and preen a lot.
    const damp = this.sinceRain < 600;
    const frames = damp && roll < 0.45 ? (roll < 0.2 ? MICRO.shake : MICRO.preen) : roll < 0.34 ? MICRO.blink : roll < 0.5 ? MICRO.tilt : roll < 0.62 ? MICRO.tail : roll < 0.74 ? MICRO.preen : roll < 0.86 ? MICRO.scratch : MICRO.fluff;
    bird.micro = { frames, step: 0, t: 0 };
    bird.pose = frames[0];
  }

  private atBowl(bird: Bird, sill: SillState): boolean {
    const reach = sill.bowlHalfWidth + SPECIES[bird.species].size * 48 * 0.28;
    return Math.abs(Math.abs(bird.sillX - sill.bowlX) - reach) < 6;
  }

  private collides(bird: Bird, x: number): boolean {
    if (!bird.onSill) return false;
    return this.birds.some((b) => b !== bird && b.onSill && Math.abs(b.sillX - x) < SILL_SPACING * 0.8);
  }

  private startle(bird: Bird): void {
    if (bird.startleIn !== null || !PERCHED_STATES.includes(bird.state)) return;
    bird.startleIn = this.rng() * 0.25;
  }

  /** Leave the current perch for somewhere else, or out of the scene. */
  private depart(bird: Bird, sill: SillState): void {
    bird.perch?.occupants.delete(bird);
    bird.perch = null;
    if (bird.onSill) {
      // Convert the sill position to world coordinates for the flight.
      const screenX = sillScreenX(sill, bird.sillX);
      const screenY = sill.surface.y - 20 * sill.surface.frameScale;
      const world = this.options.viewport.screenToWorld(screenX, screenY);
      bird.x = world.x;
      bird.y = world.y;
      bird.z = 0.02;
      bird.onSill = false;
      sillContacts.touch(screenX, 0.35 + SPECIES[bird.species].size * 0.3);
    }
    const goElsewhere = this.rng() < 0.3 && this.activity(this.env!) > 0.3;
    const perch = goElsewhere ? this.choosePerch(bird.species) : null;
    if (perch) {
      perch.occupants.add(bird);
      bird.flight = this.planFlight(bird, { kind: 'perch', perch, x: Math.round(lerp(perch.ledge.x0, perch.ledge.x1, this.rng())) }, sill);
    } else {
      bird.flight = this.planFlight(bird, { kind: 'leave' }, sill);
    }
    bird.state = 'fly-away';
  }

  private planFlight(bird: Bird, arrive: Flight['arrive'], sill: SillState): Flight {
    const { viewport } = this.options;
    let to: Flight['to'];
    if (arrive.kind === 'sill') {
      to = () => {
        const s = this.sill ?? sill;
        // Aim the body's centre so the feet meet the sill on touchdown.
        const half = (spriteSizeAt(0, SPECIES[bird.species].size) / 2 - 2) * s.surface.frameScale;
        const p = viewport.screenToWorld(s.surface.left + arrive.sillX * s.surface.frameScale, s.surface.y - half);
        return { x: p.x, y: p.y, z: 0 };
      };
    } else if (arrive.kind === 'perch') {
      const half = spriteSizeAt(arrive.perch.z, SPECIES[bird.species].size) / 2;
      const fixed = { x: arrive.x, y: arrive.perch.ledge.y - half, z: arrive.perch.z };
      to = () => fixed;
    } else {
      const visible = viewport.layout.visibleWorldWidth;
      const right = this.rng() < 0.5;
      const fixed = {
        x: viewport.panX + (right ? visible + 80 : -80),
        y: -10 + this.rng() * 90,
        z: clamp(bird.z + 0.3 + this.rng() * 0.3, 0.45, 0.95),
      };
      to = () => fixed;
    }
    const end = to();
    const from = { x: bird.x, y: bird.y, z: bird.z };
    const avgScale = perspectiveScale((from.z + end.z) / 2);
    const distance = Math.hypot(end.x - from.x, end.y - from.y);
    const duration = clamp(distance / (TEMPERAMENTS[bird.species].speed * avgScale) + Math.abs(end.z - from.z) * 2.5, 1.2, 9);
    return { from, to, arc: 15 + this.rng() * 40, t: 0, duration, arrive };
  }

  /** Move along the flight path. Returns true on arrival. */
  private fly(bird: Bird, dt: number): boolean {
    const f = bird.flight!;
    const temperament = TEMPERAMENTS[bird.species];
    f.t = Math.min(1, f.t + dt / f.duration);
    const end = f.to();
    // Ease out so birds slow to land; arc upward mid-flight.
    const t = f.arrive.kind === 'leave' ? f.t * f.t : 1 - (1 - f.t) * (1 - f.t);
    const prevX = bird.x;
    bird.x = lerp(f.from.x, end.x, t);
    bird.y = lerp(f.from.y, end.y, t) - Math.sin(Math.PI * t) * f.arc * perspectiveScale(bird.z);
    bird.z = lerp(f.from.z, end.z, t);
    if (Math.abs(bird.x - prevX) > 0.01) bird.facing = bird.x > prevX ? 1 : -1;

    // Flap, with the odd glide; flare with slow beats when landing.
    const landing = f.arrive.kind !== 'leave' && f.t > 0.85;
    if (bird.glide > 0) {
      bird.glide -= dt;
      bird.pose = 'glide';
    } else {
      bird.flap += dt * temperament.flapRate * (landing ? 0.6 : 1);
      bird.pose = FLAP_CYCLE_6[Math.floor(bird.flap * 6) % 6];
      if (!landing && this.rng() < temperament.glide * dt * 0.6) bird.glide = 0.4 + this.rng() * 0.8;
    }
    // Flaring to land: wings thrown forward, tail fanned, feet out.
    if (landing && f.t > 0.9) bird.pose = f.t > 0.96 ? 'flare-2' : 'flare-1';
    return f.t >= 1;
  }

  /** Arrival. Returns true if the bird has left the scene. */
  private land(bird: Bird, sill: SillState): boolean {
    const f = bird.flight!;
    bird.flight = null;
    if (f.arrive.kind === 'leave') return true;
    const t = TEMPERAMENTS[bird.species];
    bird.stay = 0;
    bird.stayLength = lerp(t.stay[0], t.stay[1], this.rng()) * (this.options.birdseed.isStocked ? 1.6 : 1);
    if (f.arrive.kind === 'sill') {
      if (!sill.windowOpen || sill.catX !== null) {
        bird.flight = this.planFlight(bird, { kind: 'leave' }, sill);
        bird.state = 'fly-away';
        return false;
      }
      bird.onSill = true;
      bird.sillX = f.arrive.sillX;
      bird.z = 0;
      sillContacts.touch(sillScreenX(sill, bird.sillX), 0.5 + SPECIES[bird.species].size * 0.4);
    } else {
      bird.perch = f.arrive.perch;
      bird.x = f.arrive.x;
      bird.y = f.arrive.perch.ledge.y;
      bird.z = f.arrive.perch.z;
    }
    this.enter(bird, 'perch-idle');
    return false;
  }

  // --- Rendering ------------------------------------------------------

  private render(bird: Bird, sill: SillState): void {
    const { viewport, worldLayers, nearLayer, sillLayer } = this.options;
    const sp = SPECIES[bird.species];
    const sprite = bird.sprite;
    const flying = bird.flight !== null || bird.state === 'take-off';
    const lighting = this.env?.lighting;

    if (bird.onSill) {
      const fs = sill.surface.frameScale;
      const size = nearSize(0, sp.size);
      this.reparent(bird, sillLayer);
      sprite.texture = this.sprites.get(bird.species, bird.pose, size);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(fs * bird.facing, fs);
      const hopLift = bird.hop ? Math.sin(Math.PI * bird.hop.t) * 4 : 0;
      sprite.position.set(
        Math.round((sill.surface.left + bird.sillX * fs) / fs) * fs,
        sill.surface.y + Math.round(2 - hopLift) * fs,
      );
      // A soft shadow on the sill under the bird.
      bird.shadow.clear();
      bird.shadow.ellipse(0, 0, size * 0.3, 1.5).fill({ color: 0x000000, alpha: 0.22 });
      bird.shadow.scale.set(fs);
      bird.shadow.position.set(sprite.x, sill.surface.y + fs);
      bird.shadow.visible = true;
      // The room's light falls on sill visitors too.
      sprite.tint = lighting ? interiorTint(lighting) : 0xffffff;
      return;
    }

    bird.shadow.visible = false;
    // Perched on a swaying branch, it rides with it.
    const sway = !flying && bird.perch?.ledge.sway ? bird.perch.ledge.sway() : NO_SWAY;
    if (bird.z < NEAR_Z) {
      const fs = viewport.layout.frameScale;
      const size = nearSize(bird.z, sp.size);
      this.reparent(bird, nearLayer);
      const p = viewport.worldToScreen(bird.x + sway.x, bird.y + sway.y);
      sprite.texture = this.sprites.get(bird.species, bird.pose, size);
      sprite.anchor.set(0.5, flying ? 0.5 : 1);
      sprite.scale.set(fs * bird.facing, fs);
      sprite.position.set(p.x, p.y);
    } else {
      const layer = bird.perch
        ? worldLayers[bird.perch.ledge.layer]
        : bird.z >= 0.86
          ? worldLayers.far
          : bird.z >= 0.72
            ? worldLayers.mid
            : worldLayers.near;
      this.reparent(bird, layer);
      const size = spriteSizeAt(bird.z, sp.size);
      sprite.texture = this.sprites.get(bird.species, bird.pose, size);
      sprite.anchor.set(0.5, flying ? 0.5 : 1);
      sprite.scale.set(bird.facing, 1);
      const hopLift = bird.hop ? Math.sin(Math.PI * bird.hop.t) * 1.5 : 0;
      sprite.position.set(Math.round(bird.x + sway.x), Math.round(bird.y + sway.y + (flying ? 0 : 1) - hopLift));
    }
    sprite.tint = lighting ? lighting.ambient : 0xffffff;
  }

  private reparent(bird: Bird, layer: Container): void {
    if (bird.sprite.parent === layer) return;
    layer.addChild(bird.sprite);
    if (layer === this.options.sillLayer) layer.addChildAt(bird.shadow, 0);
    else bird.shadow.removeFromParent();
  }

  private screenBounds(bird: Bird, viewport: Viewport): { x: number; y: number; half: number } {
    const sprite = bird.sprite;
    const sp = SPECIES[bird.species];
    if (bird.onSill || sprite.parent === this.options.nearLayer) {
      const size = spriteSizeAt(bird.z, sp.size) * Math.abs(sprite.scale.y);
      return { x: sprite.x, y: sprite.y - (sprite.anchor.y === 1 ? size / 2 : 0), half: Math.max(18, size * 0.45) };
    }
    const size = spriteSizeAt(bird.z, sp.size) * viewport.layout.scale;
    const p = viewport.worldToScreen(bird.x, bird.y);
    return { x: p.x, y: p.y - (sprite.anchor.y === 1 ? size / 2 : 0), half: Math.max(14, size * 0.6) };
  }

  private remove(index: number): void {
    const bird = this.birds[index];
    bird.perch?.occupants.delete(bird);
    bird.sprite.destroy();
    bird.shadow.destroy();
    this.birds.splice(index, 1);
  }

  // --- Sound ----------------------------------------------------------

  private voice(bird: Bird): void {
    // Birds sing in bouts: past the flock's budget, a chirp is only seen, not heard.
    if (!this.songs.take()) return;
    this.sound(bird, SPECIES_VOICE[bird.species]);
  }

  private sound(bird: Bird, id: Parameters<LifeSoundSink>[0]): void {
    const { viewport } = this.options;
    const sill = this.sill;
    let pan: number;
    if (bird.onSill && sill) {
      const x = sillScreenX(sill, bird.sillX);
      pan = (x / viewport.layout.screenWidth) * 2 - 1;
    } else {
      pan = viewport.worldXToStereo(bird.x);
    }
    this.options.sound(id, pan, bird.onSill ? 0 : bird.z);
  }

  // --- Distant flocks -------------------------------------------------

  private spawnFlock(species: SpeciesId): void {
    const { viewport, worldLayers } = this.options;
    const count = 4 + Math.floor(this.rng() * 6);
    const right = this.rng() < 0.5;
    const z = 0.86 + this.rng() * 0.1;
    const flock: Flock = {
      sprites: [],
      offsets: [],
      x: viewport.panX + (right ? -30 : viewport.layout.visibleWorldWidth + 30),
      y: 30 + this.rng() * 90,
      z,
      vx: (right ? 1 : -1) * (22 + this.rng() * 14),
      species,
      flap: 0,
    };
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite({ anchor: 0.5 });
      sprite.scale.x = right ? 1 : -1;
      worldLayers.far.addChild(sprite);
      flock.sprites.push(sprite);
      flock.offsets.push({ x: -i * (5 + this.rng() * 6), y: (this.rng() - 0.5) * 16, phase: this.rng() });
    }
    this.flocks.push(flock);
  }

  private updateFlocks(dt: number): void {
    const { viewport } = this.options;
    const ambient = this.env?.lighting.ambient ?? 0xffffff;
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const flock = this.flocks[i];
      flock.x += flock.vx * dt;
      flock.flap += dt * 8;
      const size = spriteSizeAt(flock.z, SPECIES[flock.species].size);
      flock.sprites.forEach((sprite, j) => {
        const o = flock.offsets[j];
        const pose = FLAP_CYCLE[Math.floor((flock.flap + o.phase) * 4) % 4];
        sprite.texture = this.sprites.get(flock.species, pose, size);
        sprite.position.set(
          Math.round(flock.x + o.x * Math.sign(flock.vx)),
          Math.round(flock.y + o.y + Math.sin(flock.flap * 0.3 + j) * 3),
        );
        sprite.tint = ambient;
      });
      const left = viewport.panX - 120;
      const right = viewport.visibleRight + 120;
      if (flock.x < left || flock.x > right) {
        for (const sprite of flock.sprites) sprite.destroy();
        this.flocks.splice(i, 1);
      }
    }
  }
}
