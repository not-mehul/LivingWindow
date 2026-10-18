import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { gridToTexture } from '../../sprites/birdSprites';
import { drawPerson, randomLook, type PersonFacing, type PersonLook, type PersonPose } from '../../sprites/people';
import type { Environment } from '../../scene/Environment';
import { projectPoint } from '../../sim/cityGeometry';
import { gardenerOut, pigeonFeederOut, windowCleanersOut } from '../../sim/wildlife';
import { PERSON_HEIGHT_AT_1 } from '../StreetLife';

const r = (a: number, b: number) => a + Math.random() * (b - a);

/** A person somewhere on the roofs, drawn at their depth. */
class Figure {
  readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly textures = new Map<string, Texture>();

  /** `size` is their height at depth 1: the roofs across the way are built smaller than the street's people. */
  constructor(
    readonly look: PersonLook,
    private readonly size = PERSON_HEIGHT_AT_1,
  ) {}

  show(x: number, y: number, depth: number, facing: PersonFacing, pose: PersonPose, frame: number, dir: 1 | -1, tint: number): void {
    const h = Math.max(3, Math.round(this.size / depth));
    const key = `${facing}:${pose}:${frame % 4}:${h}`;
    let t = this.textures.get(key);
    if (!t) {
      const { grid, palette } = drawPerson(this.look, facing, pose, frame, false, h);
      t = gridToTexture(grid, palette.colors);
      this.textures.set(key, t);
    }
    this.sprite.texture = t;
    this.sprite.position.set(Math.round(x), Math.round(y));
    this.sprite.scale.x = dir;
    this.sprite.tint = tint;
    this.sprite.visible = true;
  }
}

// --- Window cleaners on the glass tower ------------------------------------

/** The glass tower's face, towards us: ground units, and where it shows on screen. */
const TOWER = { gx0: -630, gx1: -480, depth: 2.2, top: 122, bottom: 170 };
const GONDOLA_W = 34;

/**
 * Two window cleaners in a cradle hung on cables down the face of the glass
 * tower, working their way down one drop at a time, wiping as they go.
 */
class WindowCleaners {
  readonly container = new Container({ label: 'window-cleaners' });
  private readonly gfx = new Graphics();
  private readonly workers = [new Figure(randomLook(), 17), new Figure(randomLook(), 17)];
  private column = 0;
  private y = TOWER.top;
  private wipe = 0;
  private wipeTimer = r(3, 8);
  private rising = false;

  constructor() {
    for (const w of this.workers) this.container.addChild(w.sprite);
    this.container.addChild(this.gfx);
    this.container.visible = false;
  }

  update(dt: number, env: Environment, out: boolean): void {
    if (!out && !this.container.visible) return;
    this.container.visible = true;
    const columns = 3;
    const x0 = projectPoint(TOWER.gx0 + GONDOLA_W / 2, TOWER.depth).x;
    const x1 = projectPoint(TOWER.gx1 - GONDOLA_W / 2, TOWER.depth).x;
    const cx = x0 + ((x1 - x0) * this.column) / (columns - 1);
    if (this.rising || !out) {
      // Hauled back up to the roof (and away, when the day's done).
      this.y -= 22 * dt;
      if (this.y <= TOWER.top) {
        this.rising = false;
        this.column = (this.column + 1) % columns;
        if (!out) {
          this.container.visible = false;
          return;
        }
      }
    } else if (this.wipe > 0) {
      this.wipe -= dt;
    } else {
      this.y += 2.2 * dt;
      this.wipeTimer -= dt;
      if (this.wipeTimer <= 0) {
        this.wipe = r(2, 5);
        this.wipeTimer = r(4, 10);
      }
      if (this.y >= TOWER.bottom) this.rising = true;
    }
    const scale = 1 / TOWER.depth;
    const w = Math.round(GONDOLA_W * scale);
    const left = Math.round(cx - w / 2);
    const y = Math.round(this.y);
    const tint = env.lighting.ambient;
    // The workers, facing the glass, arms sweeping while they wipe.
    this.workers.forEach((f, i) => {
      const frame = this.wipe > 0 ? Math.floor(env.time * 3 + i) % 2 : 0;
      f.show(left + w * (i === 0 ? 0.3 : 0.72), y + 2, TOWER.depth, 'back', frame ? 'browse' : 'stand', 0, i === 0 ? 1 : -1, tint);
    });
    // The cradle: a box with a rail round it, on two cables up to the roof.
    const g = this.gfx;
    g.clear();
    const steel = 0x8a9098;
    const dark = 0x4a5058;
    g.rect(left, y - 6, 1, 6).fill(dark).rect(left + w - 1, y - 6, 1, 6).fill(dark);
    g.rect(left, y - 6, w, 1).fill(steel);
    g.rect(left, y - 3, w, 4).fill(0xc8c4bc).rect(left, y + 1, w, 1).fill(dark);
    g.rect(left + 1, y - 2, w - 2, 1).fill(0xe8a030);
    for (const cxl of [left + 2, left + w - 3]) g.rect(cxl, 0, 1, Math.max(0, y - 6)).fill({ color: 0x3a3e44, alpha: 0.7 });
    g.tint = tint;
  }
}

// --- The rooftop garden, the gardener and the washing ------------------------

/** Ground points on the roof across the street (it's at h = 110). */
const ROOF_H = 110;
const PLANTERS = [
  { gx: 100, depth: 1.08 },
  { gx: 128, depth: 1.08 },
  { gx: 156, depth: 1.08 },
];
const STAIR_DOOR = { gx: 268, depth: 1.6 };
const LINE = { gx0: 182, gx1: 246, depth: 1.38, h: 134 };
const WASHING = [0xe8e4dc, 0x3c6aa8, 0xd8443c, 0xe0c060, 0xd88aa0, 0x6aa86a];

function roofPoint(gx: number, depth: number, h = ROOF_H): { x: number; y: number } {
  return projectPoint(gx, depth, h);
}

/** Planter boxes of herbs and flowers, a washing line, and a gardener who comes up to water them. */
class RoofGarden {
  readonly container = new Container({ label: 'roof-garden' });
  private readonly planters = new Graphics();
  private readonly washing = new Graphics();
  private readonly drops = new Graphics();
  private readonly gardener = new Figure(randomLook(), 22);
  private state: 'away' | 'walk-out' | 'water' | 'walk-back' = 'away';
  private target = 0;
  private pos = { ...STAIR_DOOR };
  private timer = 0;
  private stride = 0;

  constructor() {
    this.gardener.sprite.visible = false;
    this.container.addChild(this.washing, this.planters, this.gardener.sprite, this.drops);
    this.drawPlanters();
  }

  private drawPlanters(): void {
    const g = this.planters;
    for (const [i, p] of PLANTERS.entries()) {
      const a = roofPoint(p.gx - 12, p.depth);
      const b = roofPoint(p.gx + 12, p.depth);
      const w = Math.round(b.x - a.x);
      const h = Math.max(2, Math.round(7 / p.depth));
      const x = Math.round(a.x);
      const y = Math.round(a.y) - h;
      g.rect(x, y, w, h).fill(0x8a5a36).rect(x, y, w, 1).fill(0xb07a4a).rect(x, y + h - 1, w, 1).fill(0x5a3a22);
      // Leaves and flowers spilling over.
      for (let k = 0; k < w; k++) {
        const tall = 2 + ((k * 7 + i * 3) % 4);
        g.rect(x + k, y - tall, 1, tall).fill(k % 3 === 0 ? 0x3a7a3a : 0x5a9a4a);
        if ((k + i) % 4 === 1) g.rect(x + k, y - tall - 1, 1, 1).fill([0xe86a9a, 0xf2d040, 0xe8e4dc][(k + i) % 3]);
      }
    }
  }

  update(dt: number, env: Environment, out: boolean): void {
    const tint = env.lighting.ambient;
    this.planters.tint = tint;
    this.drawWashing(env);
    this.washing.tint = tint;
    const speed = 22;
    const step = (to: { gx: number; depth: number }) => {
      const dx = to.gx - this.pos.gx;
      const dz = (to.depth - this.pos.depth) * 700;
      const d = Math.hypot(dx, dz);
      if (d < 1) return true;
      const s = Math.min(d, speed * dt);
      this.pos.gx += (dx / d) * s;
      this.pos.depth += ((dz / d) * s) / 700;
      this.stride += s;
      return false;
    };
    let pose: PersonPose = 'walk';
    let facing: PersonFacing = 'side';
    let dir: 1 | -1 = 1;
    this.drops.clear();
    switch (this.state) {
      case 'away':
        this.gardener.sprite.visible = false;
        if (out) {
          this.state = 'walk-out';
          this.target = 0;
          this.pos = { ...STAIR_DOOR };
        }
        return;
      case 'walk-out': {
        const to = { gx: PLANTERS[this.target].gx + 8, depth: PLANTERS[this.target].depth + 0.06 };
        dir = to.gx > this.pos.gx ? 1 : -1;
        if (step(to)) {
          this.state = 'water';
          this.timer = r(4, 7);
        }
        break;
      }
      case 'water': {
        // Tipping the can over the planter, water pattering down.
        pose = 'browse';
        dir = -1;
        this.timer -= dt;
        const can = roofPoint(this.pos.gx - 10, this.pos.depth, ROOF_H + 9);
        const plant = roofPoint(this.pos.gx - 12, PLANTERS[this.target].depth, ROOF_H + 4);
        for (let k = 0; k < 4; k++) {
          const t = (env.time * 1.6 + k / 4) % 1;
          this.drops.rect(Math.round(can.x - k % 2), Math.round(can.y + (plant.y - can.y) * t), 1, 1).fill({ color: 0x9ac8f0, alpha: 0.85 });
        }
        if (this.timer <= 0) {
          this.target++;
          this.state = this.target < PLANTERS.length && out ? 'walk-out' : 'walk-back';
        }
        break;
      }
      case 'walk-back':
        dir = STAIR_DOOR.gx > this.pos.gx ? 1 : -1;
        facing = 'back';
        if (step(STAIR_DOOR)) this.state = 'away';
        break;
    }
    const p = roofPoint(this.pos.gx, this.pos.depth);
    this.gardener.show(p.x, p.y, this.pos.depth, facing, pose, Math.floor(this.stride / 5), dir, tint);
  }

  /** Washing pegged out on a line between two poles, swaying in the wind. */
  private drawWashing(env: Environment): void {
    const g = this.washing;
    g.clear();
    const a = roofPoint(LINE.gx0, LINE.depth, LINE.h);
    const b = roofPoint(LINE.gx1, LINE.depth, LINE.h);
    const foot = roofPoint(LINE.gx0, LINE.depth);
    const pole = 0x5a5e66;
    g.rect(Math.round(a.x), Math.round(a.y), 1, Math.round(foot.y - a.y)).fill(pole);
    g.rect(Math.round(b.x), Math.round(b.y), 1, Math.round(foot.y - b.y)).fill(pole);
    const span = Math.round(b.x - a.x);
    for (let x = 1; x < span; x++) g.rect(Math.round(a.x) + x, Math.round(a.y + Math.sin((x / span) * Math.PI) * 1.5), 1, 1).fill(0x8a8a90);
    const wind = env.weather.wind;
    const items = [3, 5, 3, 6, 2, 4];
    let x = 2;
    items.forEach((w, i) => {
      if (x + w >= span - 1) return;
      const sag = Math.sin(((x + w / 2) / span) * Math.PI) * 1.5;
      const top = Math.round(a.y + sag) + 1;
      const h = w >= 5 ? 6 : w === 2 ? 2 : 4;
      const sway = Math.round(Math.sin(env.time * (1.6 + i * 0.3) + i) * (0.4 + Math.abs(wind) * 1.6) + wind * 1.5);
      const color = WASHING[i % WASHING.length];
      for (let row = 0; row < h; row++) {
        const off = Math.round((sway * row) / Math.max(1, h));
        g.rect(Math.round(a.x) + x + off, top + row, w, 1).fill(row === h - 1 ? darker(color) : color);
      }
      x += w + 2;
    });
  }
}

/** A garment's shadowed hem. */
function darker(color: number): number {
  return ((color >> 1) & 0x7f7f7f) + ((color >> 2) & 0x3f3f3f);
}

// --- Feeding the pigeons on the terrace ------------------------------------

const FEEDER = { gx: -250, depth: 1.25, h: 150 };

/** Someone on the terrace at left scattering crumbs, and the pigeons that come for them. */
class PigeonFeeder {
  readonly container = new Container({ label: 'pigeon-feeder' });
  private readonly figure = new Figure(randomLook());
  private readonly crumbs = new Graphics();
  private present = false;
  private throwTimer = 2;
  private flights: Array<{ x: number; y: number; vx: number; vy: number; t: number }> = [];

  constructor(private readonly summonPigeons: (x: number, y: number, count: number) => void) {
    this.figure.sprite.visible = false;
    this.container.addChild(this.figure.sprite, this.crumbs);
  }

  update(dt: number, env: Environment, out: boolean): void {
    const p = projectPoint(FEEDER.gx, FEEDER.depth, FEEDER.h);
    if (out && !this.present) {
      this.present = true;
      this.summonPigeons(p.x + 10, p.y + 5, 3 + Math.floor(Math.random() * 3));
    }
    if (!out) this.present = false;
    this.figure.sprite.visible = this.present;
    this.crumbs.clear();
    if (!this.present) return;
    // A toss of crumbs every few seconds.
    this.throwTimer -= dt;
    let throwing = false;
    if (this.throwTimer <= 0) {
      this.throwTimer = r(2.5, 6);
      for (let k = 0; k < 5; k++) this.flights.push({ x: p.x + 4, y: p.y - 14, vx: r(8, 26), vy: r(-14, -4), t: 0 });
    }
    if (this.throwTimer > 0 && this.flights.length > 0) throwing = true;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const c = this.flights[i];
      c.t += dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vy += 60 * dt;
      if (c.y >= p.y + 6 || c.t > 2) {
        this.flights.splice(i, 1);
        continue;
      }
      this.crumbs.rect(Math.round(c.x), Math.round(c.y), 1, 1).fill(0xe8dcc0);
    }
    this.figure.show(p.x, p.y, FEEDER.depth, 'side', throwing ? 'browse' : 'stand', 0, 1, env.lighting.ambient);
  }
}

// --- The delivery drone on the pad across the street -----------------------

type DroneState = 'away' | 'arriving' | 'landed' | 'leaving';

/**
 * A delivery quadcopter that drops in on the landing pad across the street
 * now and then: descending on whirring rotors, kicking up dust as it
 * settles, its props spinning down to a stop while it waits with its
 * parcel, then spinning up again and lifting off into the city.
 */
export class PadDrone {
  readonly container = new Container({ label: 'pad-drone' });
  private readonly gfx = new Graphics();
  private stateName: DroneState = 'away';
  private timer = r(30, 120);
  /** Height above the pad (ground px) and sideways drift. */
  private alt = 0;
  private drift = 0;
  private spin = 0;
  private rotor = 0;
  private dust: Array<{ x: number; y: number; vx: number; vy: number; t: number }> = [];

  constructor(private readonly pad: { gx: number; depth: number; h: number }) {
    this.container.addChild(this.gfx);
  }

  get state(): DroneState {
    return this.stateName;
  }

  /** Bring it in now. */
  summon(): void {
    if (this.stateName === 'away') this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.3;
    this.timer -= dt;
    switch (this.stateName) {
      case 'away':
        if (this.timer <= 0) {
          if (!raining || Math.random() < 0.3) {
            this.stateName = 'arriving';
            this.alt = 240;
            this.drift = (Math.random() < 0.5 ? -1 : 1) * r(80, 160);
            this.spin = 1;
          }
          this.timer = r(90, 260);
        }
        break;
      case 'arriving': {
        // Slowing as it nears the pad, the last few feet gentle.
        const v = Math.max(8, this.alt * 0.6);
        this.alt = Math.max(0, this.alt - v * dt);
        this.drift *= Math.pow(0.4, dt);
        if (this.alt < 14 && Math.random() < dt * 30) this.kick();
        if (this.alt <= 0) {
          this.stateName = 'landed';
          this.drift = 0;
          this.timer = r(20, 70);
          for (let k = 0; k < 6; k++) this.kick();
        }
        break;
      }
      case 'landed':
        this.spin = Math.max(0, this.spin - dt * 0.4);
        if (this.timer <= 0) {
          this.spin = Math.min(1, this.spin + dt * 0.8);
          if (this.spin >= 1) {
            this.stateName = 'leaving';
            for (let k = 0; k < 6; k++) this.kick();
          }
        }
        break;
      case 'leaving':
        this.alt += Math.max(10, this.alt * 0.9) * dt;
        this.drift += dt * 30;
        if (this.alt > 260) {
          this.stateName = 'away';
          this.timer = r(90, 260);
        }
        break;
    }
    this.rotor += dt * this.spin * 40;
    this.draw(dt, env);
  }

  /** A puff of dust off the pad. */
  private kick(): void {
    const p = projectPoint(this.pad.gx, this.pad.depth, this.pad.h);
    const a = Math.random() * Math.PI * 2;
    this.dust.push({ x: p.x, y: p.y, vx: Math.cos(a) * r(6, 14), vy: Math.sin(a) * r(1, 3) - 1, t: 0 });
  }

  private draw(dt: number, env: Environment): void {
    const g = this.gfx;
    g.clear();
    const tint = env.lighting.ambient;
    for (let k = this.dust.length - 1; k >= 0; k--) {
      const d = this.dust[k];
      d.t += dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.t > 1.2) {
        this.dust.splice(k, 1);
        continue;
      }
      g.rect(Math.round(d.x), Math.round(d.y), 1, 1).fill({ color: 0xb8b0a0, alpha: 0.5 * (1 - d.t / 1.2) });
    }
    if (this.stateName === 'away') {
      g.tint = 0xffffff;
      return;
    }
    const scale = 1 / this.pad.depth;
    const base = projectPoint(this.pad.gx + this.drift, this.pad.depth, this.pad.h);
    const at = projectPoint(this.pad.gx + this.drift, this.pad.depth, this.pad.h + 3 + this.alt);
    const x = Math.round(at.x);
    const y = Math.round(at.y);
    // Its shadow on the pad, sharper as it comes down.
    if (this.alt < 60) {
      const sw = Math.round(22 * scale * (1 + this.alt / 60));
      g.rect(Math.round(base.x - sw / 2), Math.round(base.y), sw, 1).fill({ color: 0x000000, alpha: 0.35 * (1 - this.alt / 60) });
    }
    const w = Math.max(7, Math.round(24 * scale));
    const dark = lerpColor(0x24262c, tint, 0.25);
    const shell = lerpColor(0x4a505a, tint, 0.3);
    const stripe = lerpColor(0x3ad8e8, tint, 0.35);
    const parcel = lerpColor(0xf0a020, tint, 0.3);
    // Body with a coloured stripe, arms out to the rotors, landing legs, and the parcel slung underneath.
    g.rect(x - Math.round(w * 0.22), y - 3, Math.round(w * 0.44), 3).fill(shell);
    g.rect(x - Math.round(w * 0.22), y - 2, Math.round(w * 0.44), 1).fill(stripe);
    g.rect(x - Math.round(w / 2), y - 3, w, 1).fill(dark);
    g.rect(x - 2, y, 5, 3).fill(parcel);
    g.rect(x - 2, y, 5, 1).fill(lerpColor(parcel, 0xffffff, 0.3));
    g.rect(x - Math.round(w * 0.3), y, 1, 3).fill(dark);
    g.rect(x + Math.round(w * 0.3), y, 1, 3).fill(dark);
    g.rect(x - Math.round(w / 2), y - 2, 1, 2).fill(dark);
    g.rect(x + Math.round(w / 2) - 1, y - 2, 1, 2).fill(dark);
    // Rotors: a blur when spinning, two still blades when stopped.
    for (const side of [-1, 1]) {
      const rx = x + side * Math.round(w / 2);
      if (this.spin > 0.3) g.rect(rx - 4, y - 4, 9, 1).fill({ color: 0xd8dce0, alpha: 0.3 + 0.35 * this.spin });
      else {
        const flip = Math.floor(this.rotor) % 2 === 0;
        g.rect(rx - (flip ? 3 : 1), y - 4, flip ? 7 : 3, 1).fill(dark);
      }
    }
    // A status light: blinking green when it's waiting, red in flight.
    const blink = Math.floor(env.time * 2) % 2 === 0;
    if (blink) g.rect(x, y - 4, 1, 1).fill(this.stateName === 'landed' ? 0x3aff6a : 0xff3a3a);
  }
}

export interface RooftopsOptions {
  /** Ask the birds to come down near a world point. */
  summonPigeons: (x: number, y: number, count: number) => void;
  /** The drone pad across the street. */
  dronePad: { gx: number; depth: number; h: number };
}

/**
 * Life on the roofs around us: window cleaners working down the glass tower
 * by day, a gardener watering the planters across the way morning and
 * evening, washing on the line, and someone feeding the pigeons.
 */
export class Rooftops {
  readonly container = new Container({ label: 'rooftops' });
  readonly cleaners = new WindowCleaners();
  readonly garden = new RoofGarden();
  readonly feeder: PigeonFeeder;
  readonly drone: PadDrone;
  private forced: { cleaners: boolean; gardener: boolean; feeder: boolean } = { cleaners: false, gardener: false, feeder: false };

  constructor(options: RooftopsOptions) {
    this.feeder = new PigeonFeeder(options.summonPigeons);
    this.drone = new PadDrone(options.dronePad);
    this.container.addChild(this.cleaners.container, this.garden.container, this.feeder.container, this.drone.container);
  }

  /** Bring one of them out regardless of the hour (for demos and tests). */
  summon(who: 'cleaners' | 'gardener' | 'feeder' | 'drone'): void {
    if (who === 'drone') this.drone.summon();
    else this.forced[who] = true;
  }

  update(dt: number, env: Environment): void {
    const h = env.lighting.hours;
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.15;
    this.cleaners.update(dt, env, this.forced.cleaners || windowCleanersOut(h, raining));
    this.garden.update(dt, env, this.forced.gardener || gardenerOut(h, raining));
    this.feeder.update(dt, env, this.forced.feeder || pigeonFeederOut(h, raining));
    this.drone.update(dt, env);
  }
}
