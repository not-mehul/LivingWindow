import { Container, Sprite, type Texture } from 'pixi.js';
import { drawPixelTexture } from '../core/pixelTexture';
import { lerpColor } from '../core/color';
import { WORLD_WIDTH } from '../config';
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
  type PersonLook,
  type StallKind,
} from '../sprites/streetSprites';

interface Person {
  id: number;
  look: PersonLook;
  x: number;
  /** Feet row; a pixel of variation gives the crowd depth. */
  y: number;
  dir: 1 | -1;
  speed: number;
  /** Where they're headed: an edge of the panorama or a doorway. */
  goal: number;
  goalIsDoor: boolean;
  umbrella: boolean;
  umbrellaIn: number | null;
  hurrying: boolean;
  browse: number;
  browsed: boolean;
  stride: number;
  sprite: Sprite;
  vendor: boolean;
}

interface Stall {
  kind: StallKind;
  shift: MarketShift;
  x: number;
  offset: number;
  sprite: Sprite;
  lights: Sprite | null;
  glow: Sprite | null;
  vendor: Person | null;
}

/** A warm, dithered pool of light thrown by a night-market stall. */
function createGlowTexture(): Texture {
  const width = 44;
  const height = 22;
  return drawPixelTexture(width, height, (c) => {
    const bayer = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - width / 2 + 0.5) / (width / 2);
        const dy = (y - height + 3) / height;
        const d = Math.sqrt(dx * dx + dy * dy * 1.2);
        if (d >= 1) continue;
        const level = (1 - d) ** 1.4;
        if (level * 1.1 > (bayer[y & 3][x & 3] + 0.5) / 16) c.px(x, y, level > 0.55 ? '#ffd890' : '#ffb060');
      }
    }
  });
}

export interface StreetLifeOptions {
  /** Doorways along the street (world x). */
  doors: number[];
  /** Sidewalk surface (world y of people's feet). */
  sidewalkY: number;
  rng?: () => number;
}

/**
 * The street below: pedestrians who follow the city's daily rhythm (and
 * reach for umbrellas or dash for doorways when it rains), daytime vendors
 * who set up in the morning, and night-market stalls that light up the evening.
 */
export class StreetLife {
  readonly container = new Container({ label: 'street-life' });
  /** Emissive stall lights (string bulbs, lanterns). */
  readonly lightsContainer = new Container({ label: 'street-lights' });

  private readonly people: Person[] = [];
  private readonly stalls: Stall[] = [];
  private readonly personSprites = new PersonSpriteCache();
  private readonly stallSprites = new StallSpriteCache();
  private readonly stallLayer = new Container({ label: 'stalls' });
  private readonly peopleLayer = new Container({ label: 'pedestrians', sortableChildren: true });
  private readonly rng: () => number;
  private nextId = 1;
  private spawnTimer = 0;
  private wasRaining = false;
  private initialised = false;
  private hours = 12;

  constructor(private readonly options: StreetLifeOptions) {
    this.rng = options.rng ?? Math.random;
    this.container.addChild(this.stallLayer, this.peopleLayer);
    this.createStalls();
  }

  /** Share of the maximum crowd currently on the street, 0..1 (for crowd murmur). */
  get crowdLevel(): number {
    return this.people.filter((p) => !p.vendor).length / MAX_PEDESTRIANS;
  }

  get pedestrianCount(): number {
    return this.people.filter((p) => !p.vendor).length;
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
    this.wasRaining = raining;

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

    // After dark, people are lit by shop windows and street lamps.
    const tint = lerpColor(lighting.ambient, 0xffe2b8, lighting.darkness * 0.55);
    this.updateStalls(lighting.hours, lighting.emissive, tint);

    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.vendor) {
        p.sprite.tint = tint;
        continue;
      }
      if (this.walk(p, dt, raining)) {
        this.removePerson(i);
        continue;
      }
      this.draw(p, tint);
    }
  }

  private spawn(raining: boolean, anywhere: boolean): void {
    const { doors, sidewalkY } = this.options;
    const fromDoor = doors.length > 0 && this.rng() < 0.45;
    const dir: 1 | -1 = this.rng() < 0.5 ? 1 : -1;
    let x: number;
    if (anywhere) x = this.rng() * WORLD_WIDTH;
    else if (fromDoor) x = doors[Math.floor(this.rng() * doors.length)];
    else x = dir > 0 ? -6 : WORLD_WIDTH + 6;
    const look = randomLook(this.rng);
    const person: Person = {
      id: this.nextId++,
      look,
      x,
      y: sidewalkY + Math.floor(this.rng() * 3) - 1,
      dir,
      speed: 5.5 + this.rng() * 4.5,
      goal: dir > 0 ? WORLD_WIDTH + 8 : -8,
      goalIsDoor: false,
      umbrella: raining && this.rng() < 0.85,
      umbrellaIn: null,
      hurrying: false,
      browse: 0,
      browsed: false,
      stride: this.rng() * 2,
      sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }),
      vendor: false,
    };
    // Some are heading into a building down the street.
    if (doors.length > 0 && this.rng() < 0.35) {
      const ahead = doors.filter((d) => (d - x) * dir > 20);
      if (ahead.length > 0) {
        person.goal = ahead[Math.floor(this.rng() * ahead.length)];
        person.goalIsDoor = true;
      }
    }
    this.peopleLayer.addChild(person.sprite);
    this.people.push(person);
  }

  /** Rain arrives: most open umbrellas, the rest hurry for cover. */
  private onRainStart(): void {
    for (const p of this.people) {
      if (p.vendor || p.umbrella) continue;
      if (this.rng() < 0.6) {
        p.umbrellaIn = 0.3 + this.rng() * 2.2;
      } else {
        p.hurrying = true;
        this.headIndoors(p);
      }
    }
  }

  private headIndoors(p: Person): void {
    const { doors } = this.options;
    const candidates = [...doors, -8, WORLD_WIDTH + 8];
    const nearest = candidates.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a));
    p.goal = nearest;
    p.goalIsDoor = doors.includes(nearest);
    p.dir = nearest >= p.x ? 1 : -1;
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

    if (p.browse > 0) {
      p.browse -= dt;
      return false;
    }
    // Pause at an open stall now and then, especially at the night market.
    if (!p.browsed && !p.hurrying && !raining) {
      const stall = this.stalls.find((s) => stallProgress(s.shift, this.hours, s.offset) >= 1 && Math.abs(s.x - p.x) < 2);
      if (stall) {
        p.browsed = true;
        if (this.rng() < (stall.shift === 'night' ? 0.55 : 0.3)) p.browse = 2 + this.rng() * 8;
      }
    }

    const speed = p.speed * (p.hurrying ? 2.1 : 1);
    p.x += p.dir * speed * dt;
    p.stride += speed * dt * 0.28;
    const arrived = (p.goal - p.x) * p.dir <= 0;
    return arrived;
  }

  private draw(p: Person, tint: number): void {
    const frame = p.browse > 0 ? 'stand' : Math.floor(p.stride) % 2 === 0 ? 'walk-a' : 'walk-b';
    p.sprite.texture = this.personSprites.get(p.look, p.id, frame, p.umbrella);
    p.sprite.scale.x = p.dir;
    p.sprite.position.set(Math.round(p.x), p.y);
    p.sprite.zIndex = p.y;
    p.sprite.tint = tint;
  }

  private removePerson(index: number): void {
    const p = this.people[index];
    p.sprite.destroy();
    this.personSprites.forget(p.id);
    this.people.splice(index, 1);
  }

  // --- Stalls ---------------------------------------------------------

  private createStalls(): void {
    const { doors, sidewalkY } = this.options;
    const glowTexture = createGlowTexture();
    const place = (positions: number[], kinds: readonly StallKind[], shift: MarketShift) => {
      positions.forEach((x, i) => {
        // Keep doorways clear.
        if (doors.some((d) => Math.abs(d - x) < 14)) x += 18;
        const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
        sprite.position.set(x, sidewalkY);
        sprite.visible = false;
        this.stallLayer.addChild(sprite);
        const kind = kinds[i % kinds.length];
        const lightsTexture = this.stallSprites.lights(kind);
        let lights: Sprite | null = null;
        let glow: Sprite | null = null;
        if (lightsTexture) {
          glow = new Sprite({ texture: glowTexture, anchor: { x: 0.5, y: 1 } });
          glow.position.set(x, sidewalkY + 2);
          glow.blendMode = 'add';
          glow.visible = false;
          this.lightsContainer.addChild(glow);
          lights = new Sprite({ texture: lightsTexture, anchor: { x: 0.5, y: 1 } });
          lights.position.set(x, sidewalkY);
          lights.blendMode = 'add';
          lights.visible = false;
          this.lightsContainer.addChild(lights);
        }
        this.stalls.push({ kind, shift, x, offset: (this.rng() - 0.5) * 0.6, sprite, lights, glow, vendor: null });
      });
    };
    place([118, 296, 540, 706], DAY_STALLS, 'day');
    place([168, 404, 468, 640, 778], NIGHT_STALLS, 'night');
  }

  private updateStalls(hours: number, emissive: number, tint: number): void {
    this.hours = hours;
    for (const stall of this.stalls) {
      const progress = stallProgress(stall.shift, hours, stall.offset);
      const visible = progress > 0;
      stall.sprite.visible = visible;
      if (visible) {
        const stage = progress >= 1 ? STALL_STAGES - 1 : Math.min(STALL_STAGES - 2, Math.floor(progress * (STALL_STAGES - 1)));
        stall.sprite.texture = this.stallSprites.get(stall.kind, stage);
        stall.sprite.tint = tint;
      }
      if (stall.lights && stall.glow) {
        const lit = progress >= 1;
        stall.lights.visible = stall.glow.visible = lit;
        // Bulbs shimmer a little; the glow only shows once it's dark.
        const shimmer = 0.85 + 0.15 * Math.sin(performance.now() / 300 + stall.x);
        stall.lights.alpha = Math.min(1, emissive * 1.3) * shimmer;
        stall.glow.alpha = Math.max(0, emissive - 0.3) * 0.5;
      }
      // A vendor minds the stall while it's up.
      if (progress > 0.3 && !stall.vendor) {
        const vendor: Person = {
          id: this.nextId++,
          look: randomLook(this.rng),
          x: stall.x + 3,
          y: this.options.sidewalkY - 2,
          dir: this.rng() < 0.5 ? 1 : -1,
          speed: 0,
          goal: 0,
          goalIsDoor: false,
          umbrella: false,
          umbrellaIn: null,
          hurrying: false,
          browse: 0,
          browsed: true,
          stride: 0,
          sprite: new Sprite({ anchor: { x: 0.5, y: 1 } }),
          vendor: true,
        };
        vendor.sprite.texture = this.personSprites.get(vendor.look, vendor.id, 'stand', false);
        vendor.sprite.position.set(vendor.x, vendor.y);
        vendor.sprite.scale.x = vendor.dir;
        // Behind the counter.
        this.stallLayer.addChildAt(vendor.sprite, 0);
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
