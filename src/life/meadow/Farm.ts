import { Sprite, type Container } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { GroundPlane } from '../../sim/groundPlane';
import { FOCAL } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { lieBeforeRain } from '../../sim/interplay';
import { chickensOut, cowsResting } from '../../sim/wildlife';
import { ChickenSpriteCache, COW_WALK, CowSpriteCache, type ChickenCoat, type ChickenPose, type CowCoat, type CowPose } from '../../sprites/meadowSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

type CowState = 'graze' | 'walk' | 'stand' | 'lie' | 'leave';

interface Cow {
  coat: CowCoat;
  walker: GroundWalker;
  state: CowState;
  timer: number;
  duration: number;
  stride: number;
  sprite: Sprite;
  /** Walking home in single file at dusk: the cow it follows (none for the leader). */
  follows?: Cow | null;
}

/** A cow's height (world px) at depth 1, just in front of the window. */
const COW_HEIGHT = 58;
/** A hen's height at depth 1. */
const HEN_HEIGHT = 22;
/** Ambling pace, ground px per second at depth 1. */
const WALK_SPEED = 9;

/**
 * The herd, out on the pasture. Cows graze for long spells, amble a few steps
 * towards or away from the window (growing and shrinking with distance,
 * walking round the oaks, the hen house and the creek), lift their heads and
 * moo. As the cloud thickens before rain they lie down, one by one; in the
 * rain the ones on their feet turn their tails to the wind. At dusk two or
 * three amble off in single file before settling. After dark most lie down;
 * one or two wander off, and by morning the herd is back.
 */
export class CowHerd {
  private readonly cows: Cow[] = [];
  private readonly sprites = new CowSpriteCache();
  private returnTimer = 0;
  private weather = { cloud: 0, precipitation: 0, wind: 0, raining: false };

  constructor(
    private readonly container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    for (let i = 0; i < 5; i++) {
      const target = this.grazeSpot();
      this.add(target.gx, target.depth);
    }
  }

  get count(): number {
    return this.cows.length;
  }

  /** Where every cow is (for checks): ground position and whether it's lying down. */
  get positions(): Array<{ gx: number; depth: number; state: CowState }> {
    return this.cows.map((c) => ({ gx: c.walker.gx, depth: c.walker.depth, state: c.state }));
  }

  /** Heads up from the grass, all of them, at a sudden noise. */
  lookUp(): void {
    for (const cow of this.cows) if (cow.state === 'graze' || cow.state === 'stand') this.begin(cow, 'stand', r(3, 7));
  }

  /** Two or three cows amble off in single file towards the far side of the field, nose to tail, and lie down there. */
  fileHome(): boolean {
    const free = this.cows.filter((c) => c.state === 'graze' || c.state === 'stand');
    if (free.length < 2) return false;
    // The leader sets off across the field; the cows nearest it fall in behind.
    const near = (a: Cow, b: Cow) => Math.hypot(a.walker.gx - b.walker.gx, (a.walker.depth - b.walker.depth) * FOCAL);
    const leaders = free.filter((c) => free.some((o) => o !== c && near(c, o) < 450));
    if (leaders.length === 0) return false;
    const leader = leaders[Math.floor(Math.random() * leaders.length)];
    const lw = leader.walker;
    const away = lw.gx > 0 ? -1 : 1;
    const depth = Math.max(this.area.minDepth + 0.3, Math.min(this.area.maxDepth - 0.3, lw.depth + r(-0.3, 0.3)));
    const half = this.plane.halfWidthAt(depth) * 0.8;
    let gate = { gx: 0, depth };
    for (let tries = 0; tries < 10; tries++) {
      gate = { gx: Math.max(-half, Math.min(half, lw.gx + away * r(240, 400))), depth: depth + r(-0.15, 0.15) };
      if (!GroundWalker.blocked(this.obstacles, gate.gx, gate.depth, 20)) break;
    }
    const followers = free.filter((c) => c !== leader && near(c, leader) < 450).sort((a, b) => near(a, leader) - near(b, leader)).slice(0, 2);
    const file = [leader, ...followers];
    file.forEach((cow, i) => {
      this.begin(cow, 'walk', 0);
      cow.follows = i === 0 ? null : file[i - 1];
    });
    lw.steering = { kind: 'seek', ...gate };
    return true;
  }

  update(dt: number, env: Environment): void {
    const resting = cowsResting(env.lighting.hours);
    const { cloudCover, precipitation, wind, kind } = env.weather;
    this.weather = { cloud: cloudCover, precipitation, wind, raining: kind === 'rain' && precipitation > 0.1 };
    // Wanderers come back by day, in from a side of the field.
    if (!resting && this.cows.length < 5) {
      this.returnTimer -= dt;
      if (this.returnTimer <= 0) {
        this.returnTimer = r(20, 60);
        const side = Math.random() < 0.5 ? -1 : 1;
        const depth = r(this.area.minDepth + 0.4, this.area.maxDepth - 0.5);
        const cow = this.add(side * (this.plane.halfWidthAt(depth) + 30 * depth), depth);
        cow.state = 'walk';
        cow.walker.steering = { kind: 'seek', ...this.grazeSpot() };
      }
    }
    const { ambient, haze } = env.lighting;
    for (let i = this.cows.length - 1; i >= 0; i--) {
      const cow = this.cows[i];
      cow.timer += dt;
      if (resting && cow.state !== 'lie' && cow.state !== 'leave' && cow.timer > cow.duration) {
        // Settle down for the night, or (sometimes) head for the barn.
        if (Math.random() < 0.2 && this.cows.length > 2) {
          cow.state = 'leave';
          cow.walker.steering = { kind: 'exit', side: cow.walker.gx >= 0 ? 1 : -1 };
        } else this.begin(cow, 'lie', r(60, 200));
      }
      const w = cow.walker;
      w.speed = cow.state === 'walk' || cow.state === 'leave' ? WALK_SPEED : 0;
      w.update(dt);
      cow.stride += w.speed * w.point.scale * dt;
      if (cow.state === 'leave') {
        if (w.gone) {
          cow.sprite.destroy();
          this.cows.splice(i, 1);
          continue;
        }
      } else if (cow.state === 'walk' && cow.follows !== undefined) {
        // In the file: the leader heads for the far side; each of the others keeps a length behind the one ahead.
        const ahead = cow.follows;
        if (ahead) {
          const aw = ahead.walker;
          w.steering = { kind: 'seek', gx: aw.gx - Math.cos(aw.heading) * 34, depth: aw.depth - (Math.sin(aw.heading) * 34) / FOCAL };
        }
        const s = w.steering;
        // The leader stops at the far side; each behind it once it's caught up.
        const done = ahead ? ahead.state !== 'walk' && s.kind === 'seek' && w.distanceTo(s.gx, s.depth) < 14 : (s.kind === 'seek' && w.distanceTo(s.gx, s.depth) < 10) || cow.timer > 60;
        if (done || cow.timer > 90) {
          cow.follows = undefined;
          this.begin(cow, 'lie', r(60, 160));
        }
      } else if (cow.state === 'walk') {
        const s = w.steering;
        // Arrived, or given up going round something.
        if ((s.kind === 'seek' && w.distanceTo(s.gx, s.depth) < 5) || cow.timer > 45) this.begin(cow, 'graze', r(10, 30));
      } else if (cow.timer > cow.duration && !(resting && cow.state === 'lie')) {
        this.decide(cow, resting);
      }
      const depthFraction = (w.depth - this.area.minDepth) / (this.area.maxDepth - this.area.minDepth);
      this.draw(cow, lerpColor(ambient, haze, Math.max(0, depthFraction) * 0.3));
    }
  }

  /** Somewhere open on the pasture, picked evenly by screen row so cows come up close as often as they keep far off. */
  private grazeSpot(): { gx: number; depth: number } {
    const near = this.plane.project(0, this.area.minDepth).y;
    const far = this.plane.project(0, this.area.maxDepth).y;
    let depth = 2;
    let gx = 0;
    for (let tries = 0; tries < 30; tries++) {
      depth = this.plane.depthAtY(r(far, near));
      const half = this.plane.halfWidthAt(depth) * 0.9;
      gx = r(-half, half);
      // Open grass, not right on top of another cow.
      const crowded = this.cows.some((c) => Math.hypot(c.walker.gx - gx, (c.walker.depth - depth) * FOCAL) < 70);
      if (!GroundWalker.blocked(this.obstacles, gx, depth, 8) && !crowded) break;
    }
    return { gx, depth };
  }

  private add(gx: number, depth: number): Cow {
    const coats: CowCoat[] = ['holstein', 'holstein', 'jersey', 'brown'];
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.container.addChild(sprite);
    // Spawning just off the side is allowed: the area's limit only applies while wandering.
    const walker = new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 60 * d }, gx, depth, Math.random() * Math.PI * 2);
    walker.obstacles = this.obstacles;
    walker.steering = { kind: 'seek', gx, depth };
    const cow: Cow = { coat: coats[Math.floor(Math.random() * coats.length)], walker, state: 'graze', timer: 0, duration: r(5, 25), stride: 0, sprite };
    this.cows.push(cow);
    return cow;
  }

  private begin(cow: Cow, state: CowState, duration: number): void {
    cow.state = state;
    cow.timer = 0;
    cow.duration = duration;
  }

  private decide(cow: Cow, resting: boolean): void {
    if (resting) {
      this.begin(cow, 'lie', r(60, 200));
      return;
    }
    // Cloud gathering: down they go, before the rain.
    if (Math.random() < lieBeforeRain(this.weather.cloud, this.weather.precipitation)) {
      this.begin(cow, 'lie', r(60, 180));
      return;
    }
    const roll = Math.random();
    if (roll < 0.3) {
      this.begin(cow, 'walk', 0);
      // A few steps to fresh grass, rather than across the whole field.
      const w = cow.walker;
      let spot = this.grazeSpot();
      for (let tries = 0; tries < 8 && Math.hypot(spot.gx - w.gx, (spot.depth - w.depth) * FOCAL) > 220; tries++) spot = this.grazeSpot();
      w.steering = { kind: 'seek', ...spot };
    } else if (roll < 0.45) {
      this.begin(cow, 'stand', r(3, 8));
      if (Math.random() < 0.4) this.sound('cow-moo', this.viewport.worldXToStereo(cow.walker.point.x), 0.55 + 0.35 * Math.min(1, cow.walker.point.scale));
    } else {
      this.begin(cow, 'graze', r(10, 35));
    }
  }

  private draw(cow: Cow, tint: number): void {
    const p = cow.walker.point;
    // Even sizes only: sprites are generated per size, so this bounds the cache.
    const height = evenSize(COW_HEIGHT * p.scale, 8);
    let pose: CowPose;
    switch (cow.state) {
      case 'walk':
      case 'leave':
        pose = COW_WALK[Math.floor(cow.stride / Math.max(2, height * 0.12)) % 4];
        break;
      case 'graze':
        pose = Math.floor(cow.timer / 0.8) % 2 === 0 ? 'graze-1' : 'graze-2';
        break;
      case 'lie':
        pose = 'lie';
        break;
      default:
        pose = 'stand';
    }
    cow.sprite.texture = this.sprites.get(cow.coat, pose, height);
    // Standing about in the rain with the wind up, they turn their tails to it.
    const tailToWind = this.weather.raining && Math.abs(this.weather.wind) > 0.25 && cow.state !== 'walk' && cow.state !== 'leave';
    cow.sprite.scale.x = tailToWind ? (this.weather.wind > 0 ? 1 : -1) : cow.walker.facing;
    cow.sprite.position.set(Math.round(p.x), Math.round(p.y));
    cow.sprite.zIndex = p.y;
    cow.sprite.tint = tint;
  }
}

// --- Chickens -------------------------------------------------------------

interface Chicken {
  coat: ChickenCoat;
  /** Ground position. */
  gx: number;
  depth: number;
  target: { gx: number; depth: number };
  dir: 1 | -1;
  pose: ChickenPose;
  timer: number;
  sprite: Sprite;
  /** Running for the door in a fluster (s left), after a short freeze (`freeze` s). */
  fright: number;
  freeze: number;
  /** Hiding indoors after a scare (s left). */
  inside: number;
}

/**
 * Hens pecking about the yard round the hen house by day, filing in through
 * its door at dusk. A fox prowling near, or an eagle low overhead, sends
 * them squawking and flapping for the door (after a frozen moment, for the
 * eagle), and they stay in a while before venturing out again.
 */
export class Chickens {
  private readonly hens: Chicken[] = [];
  private readonly sprites = new ChickenSpriteCache();
  private readonly door: { gx: number; depth: number };

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    /** The coop: its ground position and door (world point). */
    private readonly coop: { gx: number; depth: number; door: { x: number; y: number } },
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    const d = plane.unproject(coop.door.x, coop.door.y);
    // Just outside the door, at the foot of the ramp.
    this.door = { gx: d.gx + 18, depth: d.depth - 0.04 };
    const coats: ChickenCoat[] = ['white', 'brown', 'brown', 'black', 'white'];
    for (const coat of coats) {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      container.addChild(sprite);
      const spot = this.yardSpot();
      this.hens.push({ coat, ...spot, target: spot, dir: 1, pose: 'stand', timer: r(0, 2), sprite, fright: 0, freeze: 0, inside: 0 });
    }
  }

  /** The hen house door, on the ground. */
  get doorSpot(): { gx: number; depth: number } {
    return { ...this.door };
  }

  /** Where the hens out in the yard are. */
  get spots(): Array<{ gx: number; depth: number }> {
    return this.hens.filter((h) => h.sprite.visible && h.fright <= 0).map((h) => ({ gx: h.gx, depth: h.depth }));
  }

  /** Hens within `radius` (ground px) of a prowler run for the door. Returns how many did. */
  scatter(gx: number, depth: number, radius: number): number {
    let n = 0;
    for (const hen of this.hens) {
      if (!hen.sprite.visible || hen.fright > 0) continue;
      if (Math.hypot(hen.gx - gx, (hen.depth - depth) * FOCAL) > radius) continue;
      hen.fright = 8;
      hen.freeze = r(0, 0.25);
      n++;
    }
    if (n > 0) this.cluck(gx, depth, 0.8);
    return n;
  }

  /** A shadow overhead: every hen out freezes a moment, then makes for the door. */
  takeCover(): number {
    let n = 0;
    for (const hen of this.hens) {
      if (!hen.sprite.visible || hen.fright > 0) continue;
      hen.fright = 8;
      hen.freeze = r(0.5, 1.3);
      n++;
    }
    if (n > 0) this.cluck(this.door.gx, this.door.depth, 0.7);
    return n;
  }

  private cluck(gx: number, depth: number, gain: number): void {
    this.sound('chicken-cluck', this.viewport.worldXToStereo(this.plane.project(gx, depth).x), gain);
  }

  /** How many hens are out in the yard. */
  get outside(): number {
    return this.hens.filter((h) => h.sprite.visible).length;
  }

  /** A spot in the yard in front of the hen house (on the viewer's side, away from the creek). */
  private yardSpot(): { gx: number; depth: number } {
    const a = r(0, Math.PI * 2);
    const radius = r(30, 110);
    return { gx: this.coop.gx + Math.cos(a) * radius - 40, depth: Math.max(this.coop.depth - 0.5, this.coop.depth - 0.08 - Math.abs(Math.sin(a)) * radius / FOCAL) };
  }

  update(dt: number, env: Environment): void {
    const out = chickensOut(env.lighting.hours) && !(env.weather.kind === 'rain' && env.weather.precipitation > 0.3);
    for (const hen of this.hens) {
      hen.timer -= dt;
      let speed = 0;
      if (hen.inside > 0) {
        // Keeping indoors after a fright; then back out of the door.
        hen.inside -= dt;
        hen.sprite.visible = false;
        if (hen.inside > 0 || !out) continue;
      }
      if (hen.fright > 0) {
        hen.fright -= dt;
        if (hen.freeze > 0) {
          // Frozen, head up.
          hen.freeze -= dt;
          hen.pose = 'stand';
        } else {
          // Squawking and flapping for the door.
          hen.target = this.door;
          speed = 36;
          hen.pose = Math.floor(performance.now() / 110) % 3 === 0 ? 'flap' : 'walk';
          if (this.distance(hen, this.door) < 3) {
            hen.sprite.visible = false;
            hen.fright = 0;
            hen.inside = r(40, 100);
            continue;
          }
        }
      } else if (!out) {
        // Head for the coop door, then disappear inside.
        hen.target = this.door;
        speed = 16;
        hen.pose = 'walk';
        if (this.distance(hen, this.door) < 3) hen.sprite.visible = false;
      } else {
        if (!hen.sprite.visible) {
          // Back out of the door in the morning.
          hen.sprite.visible = true;
          hen.gx = this.door.gx;
          hen.depth = this.door.depth;
          hen.target = this.yardSpot();
          hen.pose = 'walk';
        }
        if (hen.timer <= 0) {
          const roll = Math.random();
          if (roll < 0.45) {
            hen.pose = 'peck';
            hen.timer = r(0.3, 1.2);
          } else if (roll < 0.8) {
            hen.pose = 'walk';
            hen.target = this.yardSpot();
            hen.timer = r(1.5, 4);
          } else if (roll < 0.86) {
            hen.pose = 'scratch';
            hen.timer = r(0.4, 1);
          } else if (roll < 0.92) {
            hen.pose = 'flap';
            hen.timer = 0.4;
            this.sound('chicken-cluck', this.viewport.worldXToStereo(this.plane.project(hen.gx, hen.depth).x), 0.66);
          } else {
            hen.pose = 'stand';
            hen.timer = r(0.5, 2);
          }
        }
        if (hen.pose === 'walk') speed = 12;
      }
      if (speed > 0 && hen.sprite.visible) {
        const dx = hen.target.gx - hen.gx;
        const dz = (hen.target.depth - hen.depth) * FOCAL;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          const step = Math.min(d, speed * dt);
          hen.gx += (dx / d) * step;
          hen.depth += (dz / d) * step / FOCAL;
          if (Math.abs(dx) > 0.5) hen.dir = dx > 0 ? 1 : -1;
        } else if (out) hen.pose = 'stand';
      }
      const p = this.plane.project(hen.gx, hen.depth);
      const frame: ChickenPose = hen.pose === 'walk' && Math.floor(performance.now() / 160) % 2 === 0 ? 'walk-2' : hen.pose;
      // Sized by how far off it stands, like the cows.
      hen.sprite.texture = this.sprites.get(hen.coat, frame, Math.max(6, Math.min(22, HEN_HEIGHT * p.scale)));
      hen.sprite.scale.x = hen.dir;
      hen.sprite.position.set(Math.round(p.x), Math.round(p.y));
      hen.sprite.zIndex = p.y;
      hen.sprite.tint = env.lighting.ambient;
    }
  }

  private distance(hen: Chicken, to: { gx: number; depth: number }): number {
    return Math.hypot(to.gx - hen.gx, (to.depth - hen.depth) * FOCAL);
  }
}
