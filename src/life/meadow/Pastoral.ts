import { Container, Graphics, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { FOCAL, type GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { cowsResting, sheepdogTime } from '../../sim/wildlife';
import { drawDogSized, drawHorseSized, drawSheepSized, HORSE_WALK, SHEEP_WALK, type DogPose, type HorsePose, type SheepPose } from '../../sprites/meadowSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);

/** Heights (world px) at depth 1. */
const SHEEP_HEIGHT = 30;
const DOG_HEIGHT = 24;
const HORSE_HEIGHT = 66;

// --- The flock and its dog ----------------------------------------------------------

type SheepState = 'graze' | 'walk' | 'lie' | 'flee';

interface Sheep {
  walker: GroundWalker;
  state: SheepState;
  timer: number;
  /** Where it likes to be relative to the flock's middle (ground px). */
  ox: number;
  oz: number;
  stride: number;
  sprite: Sprite;
}

/** Where the flock grazes: the left of the pasture, among the oaks. */
const FLOCK_AREA = { gx0: -430, gx1: -60, depth0: 1.6, depth1: 3.2 };

/**
 * A small flock of sheep grazing together: drifting across the grass as a
 * loose bunch, lying down at night, bleating now and then. Through the day
 * the sheepdog is sent round them: it races out in a wide arc, drops to a
 * crouch, and the flock bunches up and moves off ahead of it.
 */
export class SheepFlock {
  private readonly sheep: Sheep[] = [];
  private readonly sprites = new DrawnCache();
  private centre = { gx: -250, depth: 2.3 };
  private centreTarget = { gx: -250, depth: 2.3 };
  private retarget = r(20, 40);
  private baaTimer = r(8, 20);
  readonly dog: Sheepdog;

  constructor(
    container: Container,
    plane: GroundPlane,
    area: WalkArea,
    obstacles: readonly Obstacle[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
    count = 6,
  ) {
    for (let i = 0; i < count; i++) {
      const ox = r(-45, 45);
      const oz = r(-30, 30);
      const w = new GroundWalker(plane, area, this.centre.gx + ox, this.centre.depth + oz / FOCAL, Math.random() * Math.PI * 2);
      w.obstacles = obstacles;
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      container.addChild(sprite);
      this.sheep.push({ walker: w, state: 'graze', timer: r(1, 6), ox, oz, stride: Math.random() * 4, sprite });
    }
    this.dog = new Sheepdog(container, plane, area, obstacles, () => this.centre);
  }

  get count(): number {
    return this.sheep.length;
  }

  /** How many are on their feet and moving off from the dog. */
  get fleeing(): number {
    return this.sheep.filter((s) => s.state === 'flee').length;
  }

  update(dt: number, env: Environment): void {
    const resting = cowsResting(env.lighting.hours);
    // The flock's middle drifts slowly across the grass.
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = r(30, 70);
      this.centreTarget = { gx: r(FLOCK_AREA.gx0, FLOCK_AREA.gx1), depth: r(FLOCK_AREA.depth0, FLOCK_AREA.depth1) };
    }
    const dog = this.dog.position;
    if (dog && this.dog.herding) {
      // Pushed away from the dog.
      const dx = this.centre.gx - dog.gx;
      const dz = (this.centre.depth - dog.depth) * FOCAL;
      const d = Math.hypot(dx, dz) || 1;
      this.centreTarget = {
        gx: Math.max(FLOCK_AREA.gx0, Math.min(FLOCK_AREA.gx1, this.centre.gx + (dx / d) * 80)),
        depth: Math.max(FLOCK_AREA.depth0, Math.min(FLOCK_AREA.depth1, this.centre.depth + ((dz / d) * 80) / FOCAL)),
      };
    }
    const k = Math.min(1, dt * (this.dog.herding ? 0.6 : 0.05));
    this.centre.gx += (this.centreTarget.gx - this.centre.gx) * k;
    this.centre.depth += (this.centreTarget.depth - this.centre.depth) * k;

    for (const s of this.sheep) this.step(s, dt, resting);
    this.dog.update(dt, env);

    this.baaTimer -= dt;
    if (this.baaTimer <= 0) {
      this.baaTimer = this.dog.herding ? r(1.5, 4) : r(12, 35);
      const s = this.sheep[Math.floor(Math.random() * this.sheep.length)];
      if (!resting || Math.random() < 0.2) this.sound('sheep-baa', this.viewport.worldXToStereo(s.walker.point.x), 0.4 + 0.4 * (1 - s.walker.point.scale));
    }
    const tint = env.lighting.ambient;
    for (const s of this.sheep) this.draw(s, tint);
  }

  private step(s: Sheep, dt: number, resting: boolean): void {
    const w = s.walker;
    s.timer -= dt;
    const bunch = this.dog.herding ? 0.45 : 1;
    const home = { gx: this.centre.gx + s.ox * bunch, depth: this.centre.depth + (s.oz * bunch) / FOCAL };
    const away = w.distanceTo(home.gx, home.depth);
    if (this.dog.herding && s.state !== 'flee') {
      s.state = 'flee';
      s.timer = 0;
    }
    if (s.state === 'flee' && !this.dog.herding) s.state = 'graze';
    if (resting && s.state !== 'flee') {
      s.state = 'lie';
      w.speed = 0;
    } else if (s.state === 'lie') s.state = 'graze';
    if (s.state === 'flee' || (s.state === 'walk' && away > 6)) {
      w.steering = { kind: 'seek', ...home };
      w.speed = s.state === 'flee' ? 34 : 9;
      if (s.state === 'walk' && away <= 6) s.state = 'graze';
    } else if (s.state === 'graze') {
      w.speed = 0;
      if (s.timer <= 0) {
        s.timer = r(3, 10);
        // Wander off a step, or catch up with the others.
        if (away > 40 || Math.random() < 0.3) s.state = 'walk';
      }
    } else if (s.state === 'walk') s.state = 'graze';
    w.update(dt);
    s.stride += w.speed * w.point.scale * dt;
  }

  private draw(s: Sheep, tint: number): void {
    const p = s.walker.point;
    const h = Math.max(6, Math.round((SHEEP_HEIGHT * p.scale) / 2) * 2);
    const pose: SheepPose = s.state === 'lie' ? 'lie' : s.walker.speed > 0 ? SHEEP_WALK[Math.floor(s.stride / 2.5) % 4] : Math.floor(s.timer * 1.5) % 4 === 0 ? 'stand' : Math.floor(s.timer * 2) % 2 === 0 ? 'graze-1' : 'graze-2';
    s.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawSheepSized(pose, h));
    s.sprite.scale.x = s.walker.facing;
    s.sprite.position.set(Math.round(p.x), Math.round(p.y));
    s.sprite.zIndex = p.y;
    s.sprite.tint = tint;
  }
}

type DogState = 'away' | 'outrun' | 'crouch' | 'leave';

/** The sheepdog: out in a wide, fast arc round the flock, a crouching stalk, then away. */
export class Sheepdog {
  private walker: GroundWalker | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private state: DogState = 'away';
  private timer = r(60, 180);
  private angle = 0;
  private stride = 0;
  private spin: 1 | -1 = 1;

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly flockCentre: () => { gx: number; depth: number },
  ) {
    this.sprite.visible = false;
    container.addChild(this.sprite);
  }

  get herding(): boolean {
    return this.state === 'outrun' || this.state === 'crouch';
  }

  get position(): { gx: number; depth: number } | null {
    return this.walker ? { gx: this.walker.gx, depth: this.walker.depth } : null;
  }

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (this.state === 'away') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(150, 360);
        if (sheepdogTime(env.lighting.hours)) this.start();
      }
      return;
    }
    const w = this.walker!;
    this.timer += dt;
    const c = this.flockCentre();
    if (this.state === 'outrun') {
      // Round the flock in a wide arc, keeping it between itself and the window.
      this.angle += this.spin * dt * 0.55;
      const radius = 110;
      w.steering = { kind: 'seek', gx: c.gx + Math.cos(this.angle) * radius, depth: c.depth + (Math.sin(this.angle) * radius) / FOCAL };
      w.speed = 85;
      if (this.timer > 14) {
        this.state = 'crouch';
        this.timer = 0;
      }
    } else if (this.state === 'crouch') {
      w.speed = 0;
      if (this.timer > 6) {
        this.state = 'leave';
        this.timer = 0;
        w.steering = { kind: 'exit', side: w.gx < 0 ? -1 : 1 };
      }
    } else {
      w.speed = 45;
      if (w.gone) {
        this.state = 'away';
        this.walker = null;
        this.sprite.visible = false;
        return;
      }
    }
    w.update(dt);
    this.stride += w.speed * w.point.scale * dt;
    const p = w.point;
    const h = Math.max(6, Math.round((DOG_HEIGHT * p.scale) / 2) * 2);
    const pose: DogPose = this.state === 'crouch' ? 'crouch' : this.state === 'leave' ? (Math.floor(this.stride / 4) % 2 === 0 ? 'trot-1' : 'trot-2') : Math.floor(this.stride / 5) % 2 === 0 ? 'run-1' : 'run-2';
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawDogSized(pose, h));
    // Crouched, it faces the flock.
    this.sprite.scale.x = this.state === 'crouch' ? (c.gx > w.gx ? 1 : -1) : w.facing;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y));
    this.sprite.zIndex = p.y;
    this.sprite.tint = env.lighting.ambient;
  }

  private start(): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const depth = r(1.8, 2.8);
    const w = new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 60 * d }, side * (this.plane.halfWidthAt(depth) + 30 * depth), depth, side > 0 ? Math.PI : 0);
    w.obstacles = this.obstacles;
    this.walker = w;
    this.state = 'outrun';
    this.timer = 0;
    const c = this.flockCentre();
    this.angle = Math.atan2((depth - c.depth) * FOCAL, w.gx - c.gx);
    this.spin = Math.random() < 0.5 ? 1 : -1;
    this.sprite.visible = true;
  }
}

// --- The horse in its paddock ---------------------------------------------------------

/** The paddock: ground rectangle beyond the pasture on the left. */
export const PADDOCK = { gx0: -820, gx1: -520, depth0: 3.8, depth1: 5.0 };

type HorseState = 'graze' | 'walk' | 'stand';

/**
 * A bay horse in a railed paddock across the field: grazing, ambling to a
 * fresh patch, standing to swish its tail at the flies, and whinnying now
 * and then.
 */
export class HorsePaddock {
  readonly back = new Graphics();
  readonly front = new Graphics();
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private gx = -680;
  private depth = 4.3;
  private target = { gx: -680, depth: 4.3 };
  private state: HorseState = 'graze';
  private timer = r(4, 10);
  private stride = 0;
  private dir: 1 | -1 = 1;
  private whinnyTimer = r(40, 120);

  constructor(
    container: Container,
    private readonly plane: GroundPlane,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    container.addChild(this.back, this.sprite, this.front);
    this.drawFence();
  }

  /** Rails and posts round the paddock: the back and sides behind the horse, the front rail before it. */
  private drawFence(): void {
    const { gx0, gx1, depth0, depth1 } = PADDOCK;
    const rail = 0x9a8262;
    const shade = 0x5a4a38;
    const post = (g: Graphics, gx: number, depth: number) => {
      const p = this.plane.project(gx, depth);
      const h = Math.max(3, Math.round(36 * p.scale));
      g.rect(Math.round(p.x), Math.round(p.y) - h, 1, h).fill(shade);
    };
    const railLine = (g: Graphics, a: { gx: number; depth: number }, b: { gx: number; depth: number }) => {
      for (const hgt of [18, 32]) {
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const gx = a.gx + (b.gx - a.gx) * t;
          const depth = a.depth + (b.depth - a.depth) * t;
          const p = this.plane.project(gx, depth);
          const y = Math.round(p.y - hgt * p.scale);
          g.rect(Math.round(p.x), y, 1, 1).fill(rail);
        }
      }
    };
    // Back and sides.
    railLine(this.back, { gx: gx0, depth: depth1 }, { gx: gx1, depth: depth1 });
    railLine(this.back, { gx: gx0, depth: depth0 }, { gx: gx0, depth: depth1 });
    railLine(this.back, { gx: gx1, depth: depth0 }, { gx: gx1, depth: depth1 });
    for (let gx = gx0; gx <= gx1; gx += 75) post(this.back, gx, depth1);
    for (let d = depth0; d <= depth1; d += 0.3) {
      post(this.back, gx0, d);
      post(this.back, gx1, d);
    }
    // Front.
    railLine(this.front, { gx: gx0, depth: depth0 }, { gx: gx1, depth: depth0 });
    for (let gx = gx0; gx <= gx1; gx += 75) post(this.front, gx, depth0);
    this.back.zIndex = this.plane.project(0, depth1).y - 0.5;
    this.front.zIndex = this.plane.project(0, depth0).y + 0.5;
  }

  update(dt: number, env: Environment): void {
    const night = cowsResting(env.lighting.hours);
    this.timer -= dt;
    if (this.state === 'walk') {
      const dx = this.target.gx - this.gx;
      const dz = (this.target.depth - this.depth) * FOCAL;
      const d = Math.hypot(dx, dz);
      if (d < 2) {
        this.state = 'graze';
        this.timer = r(6, 16);
      } else {
        const s = Math.min(d, 9 * dt);
        this.gx += (dx / d) * s;
        this.depth += ((dz / d) * s) / FOCAL;
        this.stride += s * this.plane.project(this.gx, this.depth).scale;
        if (Math.abs(dx) > 1) this.dir = dx > 0 ? 1 : -1;
      }
    } else if (this.timer <= 0) {
      this.timer = r(5, 14);
      const roll = Math.random();
      if (night) this.state = 'stand';
      else if (roll < 0.4) {
        this.state = 'walk';
        this.target = { gx: r(PADDOCK.gx0 + 30, PADDOCK.gx1 - 30), depth: r(PADDOCK.depth0 + 0.12, PADDOCK.depth1 - 0.12) };
      } else this.state = roll < 0.8 ? 'graze' : 'stand';
    }
    this.whinnyTimer -= dt;
    const p = this.plane.project(this.gx, this.depth);
    if (this.whinnyTimer <= 0) {
      this.whinnyTimer = r(60, 180);
      if (!night) this.sound('horse-whinny', this.viewport.worldXToStereo(p.x), 0.75);
    }
    const h = Math.max(6, Math.round((HORSE_HEIGHT * p.scale) / 2) * 2);
    let pose: HorsePose;
    if (this.state === 'walk') pose = HORSE_WALK[Math.floor(this.stride / 2.5) % 4];
    else if (this.state === 'graze') pose = Math.floor(env.time * 0.8) % 2 === 0 ? 'graze-1' : 'graze-2';
    else pose = !night && Math.floor(env.time * 1.3) % 5 === 0 ? 'swish' : 'stand';
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawHorseSized(pose, h));
    this.sprite.scale.x = this.dir;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y));
    this.sprite.zIndex = p.y;
    const tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.12);
    this.sprite.tint = tint;
    this.back.tint = tint;
    this.front.tint = tint;
  }
}
