import { Sprite, type Container } from 'pixi.js';
import type { Environment } from '../../scene/Environment';
import { FOCAL } from '../../sim/groundPlane';
import { chance } from '../../sim/interplay';
import { BirdSpriteCache, FLAP_CYCLE, type BirdPose } from '../../sprites/birdSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';

type Species = 'pigeon' | 'crow';

interface Bird {
  species: Species;
  gx: number;
  depth: number;
  /** Height above the pavement (world px at this depth), while flying. */
  lift: number;
  vx: number;
  vz: number;
  vlift: number;
  dir: 1 | -1;
  state: 'in' | 'peck' | 'walk' | 'off';
  timer: number;
  target: { gx: number; depth: number };
  sprite: Sprite;
}

export interface StreetPigeonsOptions {
  container: Container;
  project: (gx: number, depth: number) => { x: number; y: number };
  tintAt: (gx: number, depth: number) => number;
  sound: LifeSoundSink;
  pan: (x: number) => number;
}

/**
 * A little flock of pigeons working the pavement for crumbs by the food
 * stalls: bobbing about, pecking, shuffling out of the way. Anyone walking
 * through them, a rider or the street sweeper, sends them clattering up and
 * away (and the rest go with them); a while later they drift back down.
 * At first light, before the sweeper's been, crows come down instead to pick
 * over where the night market stood.
 */
export class StreetPigeons {
  private readonly birds: Bird[] = [];
  private readonly sprites = new BirdSpriteCache();
  private returnIn = r(5, 20);

  constructor(private readonly options: StreetPigeonsOptions) {}

  get count(): number {
    return this.birds.filter((b) => b.state !== 'off').length;
  }

  /** Bring a flock down now (dev). */
  summon(): void {
    this.returnIn = 0;
  }

  /**
   * `threats`: walkers and vehicles moving along the street; `pigeonSpots`:
   * where there are crumbs (open food stalls); `crowSpots`: where the
   * night market packed up, for the crows at dawn.
   */
  update(dt: number, env: Environment, threats: Array<{ gx: number; depth: number; speed: number; big?: boolean }>, pigeonSpots: Array<{ gx: number; depth: number }>, crowSpots: Array<{ gx: number; depth: number }>): void {
    const h = env.lighting.hours;
    const raining = env.weather.kind === 'rain' && env.weather.precipitation > 0.25;
    const dawn = h > 5.4 && h < 7.4;
    const day = h > 7 && h < 19.5;
    // A new flock comes down when the pavement's been quiet a while.
    if (this.count === 0) {
      this.returnIn -= dt;
      const spots = dawn ? crowSpots : day ? pigeonSpots : [];
      if (this.returnIn <= 0 && spots.length > 0 && !raining) {
        this.returnIn = r(40, 120);
        this.land(spots[Math.floor(Math.random() * spots.length)], dawn ? 'crow' : 'pigeon');
      }
    }
    // Anyone coming through flushes them, and they all go up together.
    let flush = false;
    for (const b of this.birds) {
      if (b.state !== 'peck' && b.state !== 'walk') continue;
      for (const t of threats) {
        if (Math.abs(t.speed) < 1) continue;
        const reach = t.big ? 40 : 16;
        if (Math.abs(t.gx - b.gx) < reach && Math.abs(t.depth - b.depth) * FOCAL < reach) {
          flush = true;
          break;
        }
      }
      if (flush) break;
    }
    if (flush || (raining && this.count > 0) || (!day && !dawn && this.count > 0)) this.flushAll(flush ? 1 : 0.3);

    const tint = env.lighting.ambient;
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.timer -= dt;
      let pose: BirdPose = 'idle';
      if (b.state === 'in' || b.state === 'off') {
        b.gx += b.vx * dt;
        b.depth += (b.vz * dt) / FOCAL;
        b.lift += b.vlift * dt;
        if (b.state === 'in') {
          // Gliding down to the pavement.
          b.vlift = -Math.max(6, b.lift * 1.5);
          if (b.lift <= 0.5) {
            b.lift = 0;
            b.state = 'peck';
            b.vx = b.vz = b.vlift = 0;
            b.timer = r(0.5, 2);
          }
          pose = b.lift < 4 ? 'glide' : FLAP_CYCLE[Math.floor(env.time * 9 + i) % 4];
        } else {
          b.vlift += dt * 8;
          pose = FLAP_CYCLE[Math.floor(env.time * 12 + i) % 4];
          if (b.lift > 120) {
            b.sprite.destroy();
            this.birds.splice(i, 1);
            continue;
          }
        }
      } else {
        if (b.timer <= 0) {
          // Peck, look about, or a few steps on.
          const roll = Math.random();
          if (roll < 0.5) {
            b.state = 'peck';
            b.timer = r(0.4, 1.4);
          } else if (roll < 0.8) {
            b.state = 'walk';
            b.target = { gx: b.gx + r(-8, 8), depth: b.depth + r(-0.05, 0.05) };
            b.timer = r(0.8, 2);
          } else {
            b.state = 'peck';
            b.timer = -r(0.5, 1.5);
          }
        }
        if (b.state === 'walk') {
          const dx = b.target.gx - b.gx;
          const dz = (b.target.depth - b.depth) * FOCAL;
          const d = Math.hypot(dx, dz);
          if (d > 0.3) {
            const s = Math.min(d, 7 * dt);
            b.gx += (dx / d) * s;
            b.depth += ((dz / d) * s) / FOCAL;
            if (Math.abs(dx) > 0.2) b.dir = dx > 0 ? 1 : -1;
          }
          // The pigeon's nodding walk.
          pose = Math.floor(env.time * 6 + i) % 2 === 0 ? 'idle' : 'idle-breathe';
        } else pose = b.timer < 0 ? 'look-back' : Math.floor(env.time * 3 + i) % 3 === 0 ? 'peck-down' : 'peck-reach';
        // Turning about now and then.
        if (chance(0.3, dt) && b.species === 'pigeon') b.dir = b.dir === 1 ? -1 : 1;
      }
      const p = this.options.project(b.gx, b.depth);
      const size = Math.max(3, Math.round((b.species === 'crow' ? 11 : 9) / b.depth));
      b.sprite.texture = this.sprites.get(b.species, pose, size);
      b.sprite.scale.x = b.dir;
      b.sprite.position.set(Math.round(p.x), Math.round(p.y - b.lift / b.depth));
      b.sprite.zIndex = p.y;
      b.sprite.tint = b.lift > 2 ? tint : this.options.tintAt(b.gx, b.depth);
    }
  }

  private land(spot: { gx: number; depth: number }, species: Species): void {
    const n = species === 'crow' ? 2 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 4);
    // Out on the pavement in front of the stall, just off the walkers' line.
    const side = Math.sign(spot.gx) || 1;
    for (let k = 0; k < n; k++) {
      const gx = spot.gx - side * r(14, 30);
      const depth = spot.depth + r(-0.12, 0.12);
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      this.options.container.addChild(sprite);
      const lift = r(50, 80);
      this.birds.push({ species, gx: gx + r(-40, 40), depth, lift, vx: 0, vz: 0, vlift: -20, dir: Math.random() < 0.5 ? 1 : -1, state: 'in', timer: 0, target: { gx, depth }, sprite });
      const b = this.birds[this.birds.length - 1];
      b.vx = (gx - b.gx) / 3;
      b.dir = b.vx > 0 ? 1 : -1;
    }
  }

  private flushAll(odds: number): void {
    let any = false;
    for (const b of this.birds) {
      if (b.state === 'off' || b.state === 'in' || Math.random() > Math.max(odds, 0.6)) continue;
      b.state = 'off';
      b.vx = (Math.random() < 0.5 ? -1 : 1) * r(20, 40);
      b.dir = b.vx > 0 ? 1 : -1;
      b.vz = r(-10, 30);
      b.vlift = r(25, 40);
      any = true;
    }
    if (any) {
      const b = this.birds[0];
      if (b) this.options.sound('wing-flap', this.options.pan(this.options.project(b.gx, b.depth).x), 0.5);
    }
  }
}
