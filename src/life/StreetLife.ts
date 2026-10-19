import { Container, Sprite } from 'pixi.js';
import { lerpColor } from '../core/color';
import { FOCAL } from '../sim/groundPlane';
import type { Environment } from '../scene/Environment';
import { MAX_PEDESTRIANS, pedestrianTarget, RAIN_THRESHOLD } from '../sim/crowd';
import { stallProgress, type MarketShift } from '../sim/stalls';
import {
  DAY_STALLS,
  NIGHT_STALLS,
  PersonSpriteCache,
  randomLook,
  STALL_STAGES,
  StallSpriteCache,
  type PersonFacing,
  type PersonLook,
  type StallKind,
} from '../sprites/streetSprites';
import type { PersonPose } from '../sprites/people';
import { chance } from '../sim/interplay';

interface Person {
  id: number;
  look: PersonLook;
  /** On the street's ground plane. */
  gx: number;
  depth: number;
  /** Ground px per second. */
  speed: number;
  /** Where they're headed: an end of the street, or a doorway. */
  goal: { gx: number; depth: number };
  goalIsDoor: boolean;
  /** Which way they face on screen. */
  dir: 1 | -1;
  /** Seen from the front (coming towards us), the back (walking away) or the side (crossing). */
  facing: PersonFacing;
  umbrella: boolean;
  umbrellaIn: number | null;
  hurrying: boolean;
  browse: number;
  browsed: boolean;
  stride: number;
  sprite: Sprite;
  vendor: boolean;
  /** A small moment: they stop and do something (look up, wave, hail a cab) for a while. */
  moment: { pose: PersonPose; left: number; facing: PersonFacing; dir: 1 | -1 } | null;
  /** After a wave, how long the chat goes on. */
  chatAfter?: number;
  /** Sheltering from the rain under a stall's awning: where they stand, and whether they've got there. */
  shelter: { gx: number; depth: number; under: boolean; goal: { gx: number; depth: number }; goalIsDoor: boolean } | null;
}

/** A walker on the street, as others see them. */
export interface Walker {
  id: number;
  gx: number;
  depth: number;
  /** Ground px/s along the street (+ away); 0 when stopped. */
  heading: number;
  busy: boolean;
  look: PersonLook;
}

interface Stall {
  kind: StallKind;
  shift: MarketShift;
  gx: number;
  depth: number;
  offset: number;
  sprite: Sprite;
  lights: Sprite | null;
  /** Whether its bulbs are on (its pool of light on the street follows this). */
  lit: boolean;
  vendor: Person | null;
}

/** A person's height (world px) right in front of the view, at depth 1. */
export const PERSON_HEIGHT_AT_1 = 30;

/** A person's height in px at a depth along the street. */
export function personHeightAt(depth: number): number {
  return Math.max(3, Math.round(PERSON_HEIGHT_AT_1 / depth));
}
/** A stall's height at depth 1. */
const STALL_HEIGHT_AT_1 = 36;
/** The street's ends: people walk off into the distance, or out of view under the sill. */
export const FAR_END = 9.5;
export const NEAR_END = 0.95;

export interface StreetLifeOptions {
  /** Doorways along the street, at the building lines. */
  doors: Array<{ gx: number; depth: number }>;
  /** Where the market stalls set up, and whether each is a day or a night stall. */
  stallSpots: Array<{ gx: number; depth: number; shift: MarketShift }>;
  /** Half-width of the lane people walk in (ground px). */
  laneHalf: number;
  /** Screen position of a point on the street. */
  project: (gx: number, depth: number) => { x: number; y: number };
  /** How much lamp and stall light falls on a point of the street (0 in the dark, ~1 in a pool's heart). */
  lightAt?: (gx: number, depth: number) => number;
  rng?: () => number;
}

/**
 * The market street far below: pedestrians who follow the city's daily
 * rhythm, walking up and down the street (shrinking into the distance, or
 * growing as they come towards the building and pass out of sight below),
 * ducking into doorways, reaching for umbrellas when it rains; daytime
 * vendors who set up in the morning; and night-market stalls that light up
 * the evening.
 */
export class StreetLife {
  readonly container = new Container({ label: 'street-life', sortableChildren: true });
  /** Emissive stall lights (string bulbs, lanterns). */
  readonly lightsContainer = new Container({ label: 'street-lights' });

  private readonly people: Person[] = [];
  private readonly stalls: Stall[] = [];
  private readonly personSprites = new PersonSpriteCache();
  private readonly stallSprites = new StallSpriteCache();
  private readonly rng: () => number;
  private nextId = 1;
  private spawnTimer = 0;
  private wasRaining = false;
  private initialised = false;
  private hours = 12;

  constructor(private readonly options: StreetLifeOptions) {
    this.rng = options.rng ?? Math.random;
    this.createStalls();
  }

  /** The stalls open right now: what they sell and where they stand. */
  openStalls(): Array<{ kind: StallKind; gx: number; depth: number }> {
    return this.stalls.filter((s) => stallProgress(s.shift, this.hours, s.offset) >= 1).map(({ kind, gx, depth }) => ({ kind, gx, depth }));
  }

  /** Whether stall `i` (in the order of `stallSpots`) has its lights on. */
  stallLit(i: number): number {
    return this.stalls[i]?.lit ? 1 : 0;
  }

  /** Share of the maximum crowd currently on the street, 0..1 (for crowd murmur). */
  get crowdLevel(): number {
    return this.pedestrianCount / MAX_PEDESTRIANS;
  }

  get pedestrianCount(): number {
    return this.people.filter((p) => !p.vendor).length;
  }

  /** Everyone walking the street (not the vendors). */
  walkers(): Walker[] {
    return this.people
      .filter((p) => !p.vendor)
      .map((p) => ({ id: p.id, gx: p.gx, depth: p.depth, heading: p.moment || p.browse > 0 || p.shelter?.under ? 0 : Math.sign(p.goal.depth - p.depth) * p.speed, busy: p.moment !== null || p.browse > 0 || p.shelter !== null || p.hurrying, look: p.look }));
  }

  /** Have someone stop and strike a pose a while (look up at the sky, wave, hail a cab). */
  moment(id: number, pose: PersonPose, seconds: number, facing: PersonFacing, dir?: 1 | -1): boolean {
    const p = this.people.find((q) => q.id === id && !q.vendor);
    if (!p || p.moment || p.hurrying) return false;
    p.moment = { pose, left: seconds, facing, dir: dir ?? p.dir };
    return true;
  }

  /** Someone leaves the street without walking off it (into a taxi, into the busker's crowd). */
  take(id: number): boolean {
    const i = this.people.findIndex((q) => q.id === id && !q.vendor);
    if (i < 0) return false;
    this.removePerson(i);
    return true;
  }

  /** People near the skyline end of the street, or anyone with a chance, stop and look up (fireworks, a searchlight overhead). */
  lookUp(odds: number, seconds: [number, number], near?: { gx: number; depth: number; radius: number }): number {
    let n = 0;
    for (const p of this.people) {
      if (p.vendor || p.moment || p.hurrying || this.rng() >= odds) continue;
      if (near && Math.hypot(p.gx - near.gx, (p.depth - near.depth) * FOCAL) > near.radius) continue;
      p.moment = { pose: 'look-up', left: seconds[0] + this.rng() * (seconds[1] - seconds[0]), facing: 'back', dir: p.dir };
      n++;
    }
    return n;
  }

  update(dt: number, env: Environment): void {
    const { weather, lighting } = env;
    const raining = weather.kind === 'rain' && weather.precipitation > RAIN_THRESHOLD;
    const target = pedestrianTarget(lighting.hours, weather);

    // First frame: populate the street instead of waiting for walkers to arrive.
    if (!this.initialised) {
      this.initialised = true;
      for (let i = 0; i < target; i++) this.spawn(raining, true);
    }

    if (raining && !this.wasRaining) this.onRainStart();
    if (!raining && this.wasRaining) this.onRainStop();
    this.wasRaining = raining;
    this.meetFriends(dt);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.pedestrianCount < target) {
      this.spawnTimer = 0.3 + this.rng() * 1.2;
      this.spawn(raining, false);
    }
    // Too many for the hour: some head for the nearest door.
    if (this.pedestrianCount > target + 2) {
      const walker = this.people.find((p) => !p.vendor && !p.goalIsDoor);
      if (walker) this.headIndoors(walker);
    }

    // After dark there's a little spill from the shop windows everywhere, and real warmth in the pools of light.
    this.baseTint = lerpColor(lighting.ambient, 0xffe2b8, lighting.darkness * 0.18);
    this.updateStalls(lighting.hours, lighting.emissive);

    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.vendor) {
        p.sprite.tint = this.tintAt(p.gx, p.depth);
        continue;
      }
      if (this.walk(p, dt, raining)) {
        this.removePerson(i);
        continue;
      }
      this.draw(p);
    }
  }

  private baseTint = 0xffffff;

  /** The tint for something standing at a point of the street: the hour's light, warmed where a lamp or stall shines. */
  tintAt(gx: number, depth: number): number {
    const light = this.options.lightAt?.(gx, depth) ?? 0;
    if (light <= 0.01) return this.baseTint;
    return lerpColor(this.baseTint, 0xffd8a0, Math.min(0.85, light * 0.75));
  }

  private laneSpot(): number {
    return (this.rng() * 2 - 1) * this.options.laneHalf * 0.75;
  }

  private spawn(raining: boolean, anywhere: boolean): void {
    const { doors } = this.options;
    const away = this.rng() < 0.5;
    let gx = this.laneSpot();
    let depth: number;
    const fromDoor = !anywhere && doors.length > 0 && this.rng() < 0.4;
    if (anywhere) depth = NEAR_END + 0.2 + this.rng() * (FAR_END - NEAR_END - 1);
    else if (fromDoor) {
      const door = doors[Math.floor(this.rng() * doors.length)];
      gx = door.gx * 0.95;
      depth = door.depth;
    } else depth = away ? NEAR_END : FAR_END;
    const person: Person = {
      id: this.nextId++,
      look: randomLook(this.rng),
      gx,
      depth,
      speed: 16 + this.rng() * 12,
      goal: { gx: this.laneSpot(), depth: away ? FAR_END + 0.5 : NEAR_END - 0.1 },
      goalIsDoor: false,
      dir: this.rng() < 0.5 ? 1 : -1,
      facing: away ? 'back' : 'front',
      umbrella: raining && this.rng() < 0.85,
      umbrellaIn: null,
      hurrying: false,
      browse: 0,
      browsed: false,
      stride: this.rng() * 2,
      sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }),
      vendor: false,
      moment: null,
      shelter: null,
    };
    // Some are heading into a building along the street.
    if (doors.length > 0 && this.rng() < 0.3) {
      const ahead = doors.filter((d) => (d.depth - depth) * (away ? 1 : -1) > 0.3);
      if (ahead.length > 0) {
        person.goal = ahead[Math.floor(this.rng() * ahead.length)];
        person.goalIsDoor = true;
      }
    }
    this.container.addChild(person.sprite);
    this.people.push(person);
  }

  /** Rain arrives: most open umbrellas, some duck under the nearest stall's awning to wait it out, the rest hurry for cover. */
  private onRainStart(): void {
    const open = this.stalls.filter((s) => stallProgress(s.shift, this.hours, s.offset) >= 1);
    const taken = new Map<Stall, number>();
    for (const p of this.people) {
      if (p.vendor || p.umbrella) continue;
      const stall = open.find((s) => Math.abs(s.depth - p.depth) < 0.9 && (taken.get(s) ?? 0) < 3);
      if (stall && this.rng() < 0.55) {
        // Under the awning, in front of the counter, a step apart from the others there.
        const n = taken.get(stall) ?? 0;
        taken.set(stall, n + 1);
        const side = Math.sign(stall.gx) || 1;
        p.shelter = { gx: stall.gx - side * (8 + n * 3), depth: stall.depth + (n - 1) * 0.04, under: false, goal: p.goal, goalIsDoor: p.goalIsDoor };
        p.goal = { gx: p.shelter.gx, depth: p.shelter.depth };
        p.goalIsDoor = false;
        p.browse = 0;
        p.moment = null;
      } else if (this.rng() < 0.6) p.umbrellaIn = 0.3 + this.rng() * 2.2;
      else {
        p.hurrying = true;
        this.headIndoors(p);
      }
    }
  }

  /** The rain's stopped: those sheltering look out, and go on their way. */
  private onRainStop(): void {
    for (const p of this.people) {
      if (!p.shelter) continue;
      p.goal = p.shelter.goal;
      p.goalIsDoor = p.shelter.goalIsDoor;
      // A moment's pause, looking up at the sky, before stepping out.
      p.moment = { pose: 'look-up', left: 0.6 + this.rng() * 1.6, facing: 'front', dir: p.dir };
      p.shelter = null;
    }
  }

  /** Now and then two people passing each other turn out to know each other: they stop, one waves, they chat, and part. */
  private meetFriends(dt: number): void {
    if (!chance(0.8, dt, this.rng)) return;
    const free = this.people.filter((p) => !p.vendor && !p.moment && !p.hurrying && !p.shelter && p.browse <= 0 && p.depth > 1.3 && p.depth < 6);
    for (const a of free) {
      const da = Math.sign(a.goal.depth - a.depth);
      const b = free.find((q) => q !== a && Math.sign(q.goal.depth - q.depth) === -da && Math.abs(q.depth - a.depth) < 0.18 && Math.abs(q.gx - a.gx) < 26);
      if (!b) continue;
      const seconds = 3 + this.rng() * 5;
      const aDir: 1 | -1 = b.gx > a.gx ? 1 : -1;
      a.moment = { pose: 'wave', left: 1.4, facing: 'side', dir: aDir };
      b.moment = { pose: 'stand', left: seconds, facing: 'side', dir: aDir === 1 ? -1 : 1 };
      // After the wave, a chat.
      a.chatAfter = seconds - 1.4;
      return;
    }
  }

  private headIndoors(p: Person): void {
    const { doors } = this.options;
    const ends = [
      { gx: p.gx, depth: NEAR_END - 0.1 },
      { gx: p.gx, depth: FAR_END + 0.5 },
    ];
    const cost = (g: { gx: number; depth: number }) => Math.abs(g.depth - p.depth) * FOCAL + Math.abs(g.gx - p.gx);
    const door = doors.reduce<{ gx: number; depth: number } | null>((best, d) => (!best || cost(d) < cost(best) ? d : best), null);
    const end = cost(ends[0]) < cost(ends[1]) ? ends[0] : ends[1];
    p.goalIsDoor = door !== null && cost(door) < cost(end);
    p.goal = p.goalIsDoor && door ? door : end;
    p.browse = 0;
  }

  /** Returns true once the person has left the street. */
  private walk(p: Person, dt: number, raining: boolean): boolean {
    if (p.umbrellaIn !== null) {
      p.umbrellaIn -= dt;
      if (p.umbrellaIn <= 0) {
        p.umbrellaIn = null;
        p.umbrella = true;
      }
    }
    if (!raining && p.umbrella && this.rng() < dt * 0.2) p.umbrella = false;

    if (p.moment) {
      p.moment.left -= dt;
      if (p.moment.left <= 0) {
        p.moment = null;
        if (p.chatAfter && p.chatAfter > 0) {
          p.moment = { pose: 'stand', left: p.chatAfter, facing: 'side', dir: p.dir };
          p.chatAfter = 0;
        }
      }
      return false;
    }
    if (p.shelter?.under) return false;
    if (p.browse > 0) {
      p.browse -= dt;
      return false;
    }
    // Pause at an open stall now and then, especially at the night market.
    if (!p.browsed && !p.hurrying && !raining) {
      const stall = this.stalls.find((s) => stallProgress(s.shift, this.hours, s.offset) >= 1 && Math.abs(s.depth - p.depth) * FOCAL < 3 && Math.sign(s.gx) === Math.sign(p.gx || 1));
      if (stall) {
        p.browsed = true;
        if (this.rng() < (stall.shift === 'night' ? 0.55 : 0.3)) {
          p.browse = 2 + this.rng() * 8;
          // Turn to the stall.
          p.facing = 'side';
          p.dir = stall.gx > p.gx ? 1 : -1;
        }
      }
    }

    const speed = p.speed * (p.hurrying ? 2.1 : 1);
    const dz = (p.goal.depth - p.depth) * FOCAL;
    const dx = p.goal.gx - p.gx;
    const distance = Math.hypot(dx, dz);
    if (distance < 2 && p.shelter) {
      // Under the awning: turn to face out at the rain.
      p.shelter.under = true;
      p.facing = 'front';
      return false;
    }
    if (distance < 2) return true;
    // Walk mostly along the street; drift across it on the way (straight over to a doorway near the end).
    const step = Math.min(distance, speed * dt);
    const across = p.goalIsDoor && Math.abs(dz) < 60 ? 1 : Math.min(1, 40 / Math.max(40, Math.abs(dz)));
    const sx = dx * across;
    const len = Math.hypot(sx, dz) || 1;
    const before = p.gx / p.depth;
    p.gx += (sx / len) * step;
    p.depth += ((dz / len) * step) / FOCAL;
    // Face the way they're moving across the screen (walking straight up the street, keep the last way).
    const screenDx = p.gx / p.depth - before;
    if (Math.abs(screenDx) > 0.002) p.dir = screenDx > 0 ? 1 : -1;
    // Mostly crossing: side on; otherwise we see their faces or their backs.
    p.facing = Math.abs(sx) > Math.abs(dz) * 1.2 ? 'side' : dz > 0 ? 'back' : 'front';
    p.stride += (step / p.depth) * 0.45;
    return false;
  }

  private draw(p: Person): void {
    const m = p.moment;
    const pose: PersonPose = m ? m.pose : p.shelter?.under ? 'stand' : p.browse > 0 ? 'browse' : 'walk';
    const facing = m ? m.facing : p.facing;
    // Waving: the hand goes back and forth.
    const frame = m ? Math.floor(performance.now() / 220) % 2 : Math.floor(p.stride) % 4;
    p.sprite.texture = this.personSprites.get(p.look, p.id, facing, pose, frame, p.umbrella && pose !== 'wave' && pose !== 'hail', personHeightAt(p.depth));
    p.sprite.scale.x = m ? (facing === 'side' ? m.dir : 1) : p.dir;
    const pt = this.options.project(p.gx, p.depth);
    p.sprite.position.set(Math.round(pt.x), Math.round(pt.y));
    p.sprite.zIndex = pt.y;
    p.sprite.tint = this.tintAt(p.gx, p.depth);
  }

  private removePerson(index: number): void {
    const p = this.people[index];
    p.sprite.destroy();
    this.personSprites.forget(p.id);
    this.people.splice(index, 1);
  }

  // --- Stalls ---------------------------------------------------------

  private createStalls(): void {
    const counts: Record<MarketShift, number> = { day: 0, night: 0 };
    this.options.stallSpots.forEach(({ gx, depth, shift }) => {
      const kinds = shift === 'day' ? DAY_STALLS : NIGHT_STALLS;
      const kind = kinds[counts[shift]++ % kinds.length];
      const height = Math.max(4, Math.round(STALL_HEIGHT_AT_1 / depth));
      const at = this.options.project(gx, depth);
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      sprite.position.set(Math.round(at.x), Math.round(at.y));
      sprite.zIndex = at.y;
      sprite.visible = false;
      // Facing into the street (drawn mirrored, so its sign still reads).
      this.container.addChild(sprite);
      const lightsTexture = this.stallSprites.lights(kind, height, gx > 0);
      let lights: Sprite | null = null;
      if (lightsTexture) {
        lights = new Sprite({ texture: lightsTexture, anchor: { x: 0.5, y: 1 } });
        lights.position.set(Math.round(at.x), Math.round(at.y));
        lights.blendMode = 'add';
        lights.visible = false;
        this.lightsContainer.addChild(lights);
      }
      this.stalls.push({ kind, shift, gx, depth, offset: (this.rng() - 0.5) * 0.6, sprite, lights, lit: false, vendor: null });
    });
  }

  private updateStalls(hours: number, emissive: number): void {
    this.hours = hours;
    for (const stall of this.stalls) {
      const progress = stallProgress(stall.shift, hours, stall.offset);
      const visible = progress > 0;
      stall.sprite.visible = visible;
      const height = Math.max(4, Math.round(STALL_HEIGHT_AT_1 / stall.depth));
      if (visible) {
        const stage = progress >= 1 ? STALL_STAGES - 1 : Math.min(STALL_STAGES - 2, Math.floor(progress * (STALL_STAGES - 1)));
        stall.sprite.texture = this.stallSprites.get(stall.kind, stage, height, stall.gx > 0);
        stall.sprite.tint = this.tintAt(stall.gx, stall.depth);
      }
      if (stall.lights) {
        stall.lit = progress >= 1;
        stall.lights.visible = stall.lit;
        // Bulbs shimmer a little.
        const shimmer = 0.85 + 0.15 * Math.sin(performance.now() / 300 + stall.depth * 40);
        stall.lights.alpha = Math.min(1, emissive * 1.3) * shimmer;
      }
      // A vendor minds the stall while it's up, behind the counter (on the wall side).
      if (progress > 0.3 && !stall.vendor) {
        const gx = stall.gx + Math.sign(stall.gx) * 12;
        const vendor: Person = {
          id: this.nextId++,
          look: randomLook(this.rng),
          gx,
          depth: stall.depth,
          speed: 0,
          goal: { gx, depth: stall.depth },
          goalIsDoor: false,
          dir: stall.gx > 0 ? -1 : 1,
          facing: 'side',
          umbrella: false,
          umbrellaIn: null,
          hurrying: false,
          browse: 0,
          browsed: true,
          stride: 0,
          sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }),
          vendor: true,
          moment: null,
          shelter: null,
        };
        vendor.sprite.texture = this.personSprites.get(vendor.look, vendor.id, 'side', 'stand', 0, false, personHeightAt(stall.depth));
        const at = this.options.project(gx, stall.depth);
        vendor.sprite.position.set(Math.round(at.x), Math.round(at.y) - 1);
        vendor.sprite.scale.x = vendor.dir;
        vendor.sprite.zIndex = stall.sprite.zIndex - 0.5;
        this.container.addChild(vendor.sprite);
        stall.vendor = vendor;
        this.people.push(vendor);
      } else if (progress <= 0.3 && stall.vendor) {
        const index = this.people.indexOf(stall.vendor);
        if (index >= 0) this.removePerson(index);
        stall.vendor = null;
      }
    }
  }
}
