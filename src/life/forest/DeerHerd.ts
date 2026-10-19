import { Sprite, type Container } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { alarmAt, groundDistance } from '../../sim/interplay';
import { deerActivity } from '../../sim/wildlife';
import { DEER_WALK, DeerSpriteCache, type DeerKind, type DeerPose } from '../../sprites/forestSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

type DeerState = 'walk' | 'graze' | 'alert' | 'bound' | 'leave';

interface Deer {
  kind: DeerKind;
  walker: GroundWalker;
  state: DeerState;
  timer: number;
  duration: number;
  /** How long it has been out; it wanders off eventually. */
  age: number;
  stride: number;
  sprite: Sprite;
  /** A fawn trailing its mother keeps close to her. */
  follows: Deer | null;
  /** Seconds spent dropping out of sight over the brow. */
  sinking: number;
  /** A fawn kicking up its heels round its mother (s left). */
  frolic: number;
  frolicAngle: number;
}

/** A doe's height (world px) at depth 1, i.e. right in front of the window. */
const DOE_HEIGHT = 44;
/** Walking pace, in ground px per second at depth 1. */
const WALK_SPEED = 13;
const BOUND_SPEED = 70;
const SINK_SECONDS = 0.9;

/**
 * Deer in the wood in front of the cabin. They come up from the valley or in
 * from the sides and wander between the trunks, towards and away from the
 * window (growing and shrinking with distance, passing behind nearer trees
 * and ferns), browse, look up, and bound off for cover when startled.
 */
export class DeerHerd {
  private readonly deer: Deer[] = [];
  private readonly sprites = new DeerSpriteCache();
  private spawnTimer = 5;

  constructor(
    private readonly container: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    /** Trunks to walk round. */
    private readonly obstacles: readonly Obstacle[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  get count(): number {
    return this.deer.length;
  }

  /** Startle every deer into bounding away. */
  startle(): void {
    for (const d of this.deer) this.bolt(d);
  }

  /** Where each deer stands. */
  get spots(): Array<{ gx: number; depth: number }> {
    return this.deer.map((d) => ({ gx: d.walker.gx, depth: d.walker.depth }));
  }

  /**
   * Something dangerous at a ground point (`scale` for how dangerous: a
   * bear further than a fox): deer near it bound away, and those a little
   * further off lift their heads and stare.
   */
  alarm(gx: number, depth: number, scale = 1): void {
    for (const d of this.deer) {
      if (d.state === 'bound' || d.state === 'leave') continue;
      const a = alarmAt('deer', groundDistance({ gx: d.walker.gx, depth: d.walker.depth }, { gx, depth }), scale);
      if (a === 'bolt') {
        this.bolt(d);
        for (const f of this.deer) if (f.follows === d) this.bolt(f);
      } else if (a === 'watch') this.freezeOne(d, 3, 6);
    }
  }

  /** A sound in the night (wolves): every head comes up, and they stand stock-still a while. */
  freeze(): void {
    for (const d of this.deer) if (d.state !== 'bound' && d.state !== 'leave') this.freezeOne(d, 5, 10);
  }

  /** On a calm morning, a fawn bucks and sprints in loops round its mother. */
  frolic(): boolean {
    const fawn = this.deer.find((d) => d.kind === 'fawn' && d.follows && d.state !== 'bound' && d.state !== 'leave');
    if (!fawn) return false;
    fawn.frolic = r(4, 7);
    fawn.frolicAngle = Math.random() * Math.PI * 2;
    return true;
  }

  private freezeOne(d: Deer, min: number, max: number): void {
    if (d.state === 'alert' && d.timer < 1) return;
    d.state = 'alert';
    d.timer = 0;
    d.duration = r(min, max);
    d.frolic = 0;
  }

  /** A tap on a deer startles it (and its fawn). */
  tap(worldX: number, worldY: number): boolean {
    for (const d of this.deer) {
      const p = d.walker.point;
      const h = this.heightOf(d, p.scale);
      if (Math.abs(worldX - p.x) < h * 0.7 && worldY > p.y - h && worldY < p.y + 2) {
        this.bolt(d);
        for (const f of this.deer) if (f.follows === d) this.bolt(f);
        this.sound('deer-snort', this.viewport.worldXToStereo(p.x), 0.4 + 0.3 * (1 - p.scale));
        return true;
      }
    }
    return false;
  }

  /** Bring a deer (or a doe and fawn) out now. */
  summon(): void {
    this.spawnTimer = 0;
  }

  update(dt: number, env: Environment): void {
    const activity = deerActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.5 : 1) * (1 - env.weather.lightning);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = r(20, 60) / Math.max(0.05, activity);
      if (this.deer.length < 4 && activity > 0.05) this.spawn();
    }
    const { ambient, haze } = env.lighting;
    for (let i = this.deer.length - 1; i >= 0; i--) {
      const d = this.deer[i];
      if (this.step(d, dt)) {
        d.sprite.destroy();
        this.deer.splice(i, 1);
        continue;
      }
      const depthFraction = (d.walker.depth - this.area.minDepth) / (this.area.maxDepth - this.area.minDepth);
      this.draw(d, lerpColor(ambient, haze, Math.max(0, depthFraction) * 0.3));
    }
  }

  private spawn(): void {
    const kind: DeerKind = Math.random() < 0.3 ? 'buck' : 'doe';
    const { minDepth, maxDepth } = this.area;
    let walker: GroundWalker;
    if (Math.random() < 0.5) {
      // Up from the valley, over the brow.
      const depth = maxDepth;
      walker = this.makeWalker(r(-0.35, 0.35) * this.plane.halfWidthAt(depth), depth, -Math.PI / 2 + r(-0.6, 0.6));
    } else {
      // In from the trees at one side.
      const side = Math.random() < 0.5 ? -1 : 1;
      const depth = r(minDepth + (maxDepth - minDepth) * 0.25, maxDepth);
      walker = this.makeWalker(side * (this.plane.halfWidthAt(depth) + 30 * depth), depth, side > 0 ? Math.PI : 0);
    }
    const mother = this.create(kind, walker, null);
    if (kind === 'doe' && Math.random() < 0.45) {
      const p = mother.walker;
      this.create('fawn', this.makeWalker(p.gx - Math.cos(p.heading) * 24, p.depth, p.heading), mother);
    }
  }

  private makeWalker(gx: number, depth: number, heading: number): GroundWalker {
    // Spawning just off-screen sideways is allowed: the area's limit is only enforced while wandering.
    const walker = new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 60 * d }, gx, depth, heading);
    walker.speed = WALK_SPEED;
    walker.obstacles = this.obstacles;
    walker.steering = this.wanderTarget();
    return walker;
  }

  private create(kind: DeerKind, walker: GroundWalker, follows: Deer | null): Deer {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.container.addChild(sprite);
    const deer: Deer = {
      kind,
      walker,
      state: 'walk',
      timer: 0,
      duration: r(4, 12),
      age: 0,
      stride: Math.random() * 4,
      sprite,
      follows,
      sinking: 0,
      frolic: 0,
      frolicAngle: 0,
    };
    this.deer.push(deer);
    return deer;
  }

  /**
   * A spot somewhere on the clearing. Picked evenly by screen row rather
   * than by depth, so deer come right up close as often as they keep to the
   * far side.
   */
  private wanderTarget(): { kind: 'seek'; gx: number; depth: number } {
    const near = this.plane.project(0, this.area.minDepth).y;
    const far = this.plane.project(0, this.area.maxDepth).y;
    let depth = 1;
    let gx = 0;
    // Somewhere on open ground, not inside a trunk or a spruce's skirt.
    for (let tries = 0; tries < 20; tries++) {
      depth = this.plane.depthAtY(r(far + (near - far) * 0.05, near - (near - far) * 0.12));
      const half = this.plane.halfWidthAt(depth) * 0.85;
      gx = r(-half, half);
      if (!GroundWalker.blocked(this.obstacles, gx, depth, 6)) break;
    }
    return { kind: 'seek', gx, depth };
  }

  /** Returns true once the deer has left. */
  private step(d: Deer, dt: number): boolean {
    d.timer += dt;
    d.age += dt;
    const w = d.walker;
    // Fawns copy their mother's mood and keep close (or kick up their heels round her).
    if (d.follows && d.frolic > 0 && d.follows.state !== 'bound') {
      d.frolic -= dt;
      const m = d.follows.walker;
      d.frolicAngle += dt * 2.2;
      d.state = 'bound';
      w.steering = { kind: 'seek', gx: m.gx + Math.cos(d.frolicAngle) * 40, depth: m.depth + (Math.sin(d.frolicAngle) * 25) / 700 };
      if (d.frolic <= 0) {
        d.state = 'graze';
        d.timer = 0;
        d.duration = r(3, 6);
      }
    } else if (d.follows) {
      const m = d.follows;
      if (!this.deer.includes(m)) d.follows = null;
      else if (m.state === 'bound' && d.state !== 'bound') this.bolt(d);
      else if (d.state !== 'bound') {
        const behindX = m.walker.gx - Math.cos(m.walker.heading) * 22;
        const far = w.distanceTo(behindX, m.walker.depth) > 18;
        if (far) {
          d.state = 'walk';
          w.steering = { kind: 'seek', gx: behindX, depth: m.walker.depth };
        } else if (m.state !== 'walk' && d.state === 'walk') {
          d.state = Math.random() < 0.6 ? 'graze' : 'alert';
          d.timer = 0;
        } else if (m.state === 'leave') d.state = 'leave';
      }
    }

    w.speed = d.state === 'bound' ? (d.frolic > 0 ? BOUND_SPEED * 0.55 : BOUND_SPEED) : d.state === 'walk' || d.state === 'leave' ? WALK_SPEED * (d.kind === 'fawn' ? 1.15 : 1) : 0;
    w.update(dt);
    d.stride += w.speed * w.point.scale * dt;

    if ((d.state === 'bound' && d.frolic <= 0) || d.state === 'leave') {
      // Over the brow, it drops down the slope into the valley and out of sight.
      if (w.steering.kind === 'seek' && w.depth >= this.area.maxDepth - 0.01) d.sinking += dt;
      return w.gone || d.sinking > SINK_SECONDS;
    }
    if (!d.follows) {
      const arrived = d.state === 'walk' && w.steering.kind === 'seek' && w.distanceTo(w.steering.gx, w.steering.depth) < 6;
      // Never circle a trunk for ever: give up on a target after a while.
      if (d.state === 'walk' && d.timer > 40) d.timer = d.duration = 0;
      if (arrived || d.duration === 0 || (d.state !== 'walk' && d.timer >= d.duration)) this.decide(d);
    }
    return false;
  }

  private decide(d: Deer): void {
    d.timer = 0;
    // After a while out in the open, they drift back into the trees.
    if (d.age > r(70, 150)) {
      d.state = 'leave';
      this.exit(d);
      return;
    }
    const roll = Math.random();
    if (d.state === 'walk') d.state = roll < 0.7 ? 'graze' : 'alert';
    else if (d.state === 'graze') d.state = roll < 0.25 ? 'alert' : roll < 0.55 ? 'graze' : 'walk';
    else d.state = roll < 0.6 ? 'graze' : 'walk';
    if (d.state === 'walk') d.walker.steering = this.wanderTarget();
    d.duration = d.state === 'graze' ? r(5, 14) : r(1.5, 4);
  }

  /** Head for the nearest cover: the trees at a side, or back down into the valley. */
  private exit(d: Deer): void {
    const w = d.walker;
    const sideways = Math.abs(w.gx) / this.plane.halfWidthAt(w.depth);
    const towardsBrow = (w.depth - this.area.minDepth) / (this.area.maxDepth - this.area.minDepth);
    if (towardsBrow > sideways) w.steering = { kind: 'seek', gx: w.gx * 1.1, depth: this.area.maxDepth };
    else w.steering = { kind: 'exit', side: w.gx >= 0 ? 1 : -1 };
  }

  private bolt(d: Deer): void {
    if (d.state === 'bound' && d.frolic <= 0) return;
    d.frolic = 0;
    d.state = 'bound';
    this.exit(d);
  }

  private heightOf(d: Deer, scale: number): number {
    const k = d.kind === 'buck' ? 1.22 : d.kind === 'fawn' ? 0.68 : 1;
    // Even sizes only: sprites are generated per size, so this bounds the cache.
    return evenSize(DOE_HEIGHT * k * scale, 8);
  }

  private pose(d: Deer): DeerPose {
    switch (d.state) {
      case 'walk':
      case 'leave':
        return DEER_WALK[Math.floor(d.stride / 2.7) % DEER_WALK.length];
      case 'bound':
        return Math.floor(d.stride / 12) % 2 === 0 ? 'bound-1' : 'bound-2';
      case 'graze':
        // Cropping the grass, lifting the head every few seconds to chew and look about.
        return d.timer % 6 > 4.8 ? 'graze-3' : Math.floor(d.timer / 0.6) % 2 === 0 ? 'graze-1' : 'graze-2';
      case 'alert':
        // Head up and staring at first; then standing easy, flicking an ear and its tail now and then.
        return d.timer < 1.2 ? 'alert' : d.timer % 3.1 < 0.28 ? 'stand-flick' : 'stand';
    }
  }

  private draw(d: Deer, tint: number): void {
    const p = d.walker.point;
    const h = this.heightOf(d, p.scale);
    const bounce = d.state === 'bound' ? Math.round(Math.abs(Math.sin(d.stride / 8)) * h * 0.25) : 0;
    d.sprite.texture = this.sprites.get(d.kind, this.pose(d), h);
    d.sprite.scale.x = d.walker.facing;
    const sink = (d.sinking / SINK_SECONDS) * h;
    d.sprite.position.set(Math.round(p.x), Math.round(p.y + sink) - bounce);
    // Hidden by the brow as it goes down the far side.
    d.sprite.alpha = d.sinking > 0 ? Math.max(0, 1 - d.sinking / SINK_SECONDS) : 1;
    // Sort among the trees by where the hooves touch the ground.
    d.sprite.zIndex = p.y;
    d.sprite.tint = tint;
  }
}
