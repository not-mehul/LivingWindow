import { Sprite, type Container } from 'pixi.js';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { foxActivity } from '../../sim/wildlife';
import { drawFox, DrawnCache, FOX_TROT, type FoxPose } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

type FoxState = 'trot' | 'sniff' | 'sit' | 'crouch' | 'pounce' | 'visit' | 'bolt' | 'leave';

/** A fox's height (world px) at depth 1. */
const FOX_HEIGHT = 22;
const TROT = 20;
const RUN = 80;

export interface FoxOptions {
  container: Container;
  plane: GroundPlane;
  area: WalkArea;
  obstacles: readonly Obstacle[];
  viewport: Viewport;
  sound: LifeSoundSink;
  /** Somewhere it's drawn to (the hen house, shut up for the night): it goes and sniffs round it, then leaves. */
  visit?: () => { gx: number; depth: number } | null;
  /** Scale the hour's activity (e.g. less in a busy farmyard by day). */
  activity?: (env: Environment) => number;
}

/**
 * A red fox: it trots in from the trees at dawn, dusk and through the night,
 * nose down along the ground, stops to sit and look about, crouches and
 * pounces on a vole in the grass, barks now and then after dark, and bolts
 * for cover when startled.
 */
export class Fox {
  private walker: GroundWalker | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private state: FoxState = 'trot';
  private timer = 0;
  private duration = 0;
  private age = 0;
  private stride = 0;
  private spawnTimer = r(20, 60);
  private barkTimer = r(20, 60);
  private visited = false;
  /** Where to head first, when called up (dev staging). */
  private toward: { gx: number; depth: number } | null = null;
  private forced = false;
  /** How long it keeps on towards a spot before giving up and doing something else. */
  private legLimit = 30;

  constructor(private readonly options: FoxOptions) {
    this.sprite.visible = false;
    options.container.addChild(this.sprite);
  }

  get present(): boolean {
    return this.walker !== null;
  }

  /** Where it is on the ground, while it's out. */
  get position(): { gx: number; depth: number } | null {
    return this.walker ? { gx: this.walker.gx, depth: this.walker.depth } : null;
  }

  get currentState(): FoxState | null {
    return this.walker ? this.state : null;
  }

  summon(toward?: { gx: number; depth: number }): void {
    this.spawnTimer = 0;
    this.toward = toward ?? null;
    this.forced = true;
  }

  /** Startle it into bolting. */
  startle(): void {
    if (this.walker && this.state !== 'bolt') this.bolt();
  }

  tap(worldX: number, worldY: number): boolean {
    const w = this.walker;
    if (!w) return false;
    const p = w.point;
    const h = FOX_HEIGHT * p.scale;
    if (Math.abs(worldX - p.x) < h && worldY > p.y - h * 1.1 && worldY < p.y + 2) {
      this.bolt();
      this.options.sound('fox-bark', this.options.viewport.worldXToStereo(p.x), 0.5);
      return true;
    }
    return false;
  }

  update(dt: number, env: Environment): void {
    const activity = (this.options.activity?.(env) ?? 1) * foxActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.5 : 1);
    if (!this.walker) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = r(60, 180) / Math.max(0.05, activity);
        if (activity > 0.05 || this.forced) this.spawn();
        this.forced = false;
      }
      return;
    }
    if (this.step(dt, env)) {
      this.walker = null;
      this.sprite.visible = false;
      return;
    }
    this.draw(env);
  }

  private spawn(): void {
    const { plane, area, obstacles } = this.options;
    // Called up towards somewhere: in from the nearer side, at about its depth.
    const side = this.toward ? -1 : Math.random() < 0.5 ? -1 : 1;
    const depth = this.toward ? Math.min(area.maxDepth, Math.max(area.minDepth, this.toward.depth)) : r(area.minDepth + (area.maxDepth - area.minDepth) * 0.3, area.maxDepth);
    const w = new GroundWalker(plane, { ...area, halfWidth: (d) => plane.halfWidthAt(d) + 60 * d }, side * (plane.halfWidthAt(depth) + 30 * depth), depth, side > 0 ? Math.PI : 0);
    w.obstacles = obstacles;
    w.speed = TROT;
    w.steering = this.toward ? { kind: 'seek', ...this.toward } : this.wanderTarget();
    this.legLimit = this.toward ? 80 : 30;
    this.toward = null;
    this.walker = w;
    this.state = 'trot';
    this.timer = 0;
    this.age = 0;
    this.visited = false;
    this.sprite.visible = true;
  }

  private wanderTarget(): { kind: 'seek'; gx: number; depth: number } {
    const { plane, area, obstacles } = this.options;
    let gx = 0;
    let depth = 1;
    for (let i = 0; i < 20; i++) {
      depth = r(area.minDepth + (area.maxDepth - area.minDepth) * 0.15, area.maxDepth);
      const half = plane.halfWidthAt(depth) * 0.85;
      gx = r(-half, half);
      if (!GroundWalker.blocked(obstacles, gx, depth, 6)) break;
    }
    return { kind: 'seek', gx, depth };
  }

  /** Returns true once it has gone. */
  private step(dt: number, env: Environment): boolean {
    const w = this.walker!;
    this.timer += dt;
    this.age += dt;
    const speeds: Record<FoxState, number> = { trot: TROT, visit: TROT * 0.8, leave: TROT, bolt: RUN, sniff: 0, sit: 0, crouch: 0, pounce: 34 };
    w.speed = speeds[this.state];
    w.update(dt);
    this.stride += w.speed * w.point.scale * dt;
    // A sharp bark into the night, now and then.
    if (env.lighting.darkness > 0.5) {
      this.barkTimer -= dt;
      if (this.barkTimer <= 0) {
        this.barkTimer = r(25, 80);
        this.options.sound('fox-bark', this.options.viewport.worldXToStereo(w.point.x), 0.45 + 0.3 * (1 - w.point.scale));
      }
    }
    if (this.state === 'bolt' || this.state === 'leave') return w.gone || (w.steering.kind === 'seek' && w.depth >= this.options.area.maxDepth - 0.01 && this.timer > 3);
    const arrived = w.steering.kind === 'seek' && w.distanceTo(w.steering.gx, w.steering.depth) < 5;
    switch (this.state) {
      case 'trot':
      case 'visit':
        if (arrived || this.timer > this.legLimit) {
          this.legLimit = 30;
          this.decide();
        }
        break;
      case 'crouch':
        // Tensed, then the spring.
        if (this.timer > this.duration) {
          this.state = 'pounce';
          this.timer = 0;
          w.steering = { kind: 'seek', gx: w.gx + Math.cos(w.heading) * 22, depth: w.depth + (Math.sin(w.heading) * 22) / 700 };
        }
        break;
      case 'pounce':
        if (this.timer > 0.45) {
          this.state = 'sniff';
          this.timer = 0;
          this.duration = r(1.5, 3);
        }
        break;
      default:
        if (this.timer > this.duration) this.decide();
    }
    return false;
  }

  private decide(): void {
    const w = this.walker!;
    this.timer = 0;
    if (this.age > r(80, 160)) {
      this.state = 'leave';
      w.steering = { kind: 'exit', side: w.gx >= 0 ? 1 : -1 };
      return;
    }
    // Drawn to somewhere (the hen house), once.
    const visit = this.options.visit?.();
    if (visit && !this.visited && Math.random() < 0.6) {
      this.visited = true;
      this.state = 'visit';
      w.steering = { kind: 'seek', ...visit };
      return;
    }
    const roll = Math.random();
    if (this.state === 'visit') {
      this.state = 'sniff';
      this.duration = r(4, 8);
    } else if (roll < 0.3) {
      this.state = 'sniff';
      this.duration = r(1.5, 4);
    } else if (roll < 0.5) {
      this.state = 'sit';
      this.duration = r(3, 8);
    } else if (roll < 0.68) {
      this.state = 'crouch';
      this.duration = r(0.8, 2);
    } else {
      this.state = 'trot';
      w.steering = this.wanderTarget();
    }
  }

  private bolt(): void {
    const w = this.walker!;
    this.state = 'bolt';
    this.timer = 0;
    w.steering = { kind: 'exit', side: w.gx >= 0 ? 1 : -1 };
  }

  private pose(): FoxPose {
    switch (this.state) {
      case 'trot':
      case 'visit':
      case 'leave':
        return FOX_TROT[Math.floor(this.stride / 3) % 4];
      case 'bolt':
        return Math.floor(this.stride / 6) % 2 === 0 ? 'run-1' : 'run-2';
      case 'sniff':
        return 'sniff';
      case 'sit':
        return 'sit';
      case 'crouch':
        return 'crouch';
      case 'pounce':
        return 'pounce';
    }
  }

  private draw(env: Environment): void {
    const w = this.walker!;
    const p = w.point;
    const h = evenSize(FOX_HEIGHT * p.scale, 6);
    const pose = this.pose();
    this.sprite.texture = this.sprites.get(`${pose}:${h}`, () => drawFox(pose, h));
    this.sprite.scale.x = w.facing;
    const hop = this.state === 'pounce' ? Math.round(Math.sin((this.timer / 0.45) * Math.PI) * h * 0.4) : 0;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y) - hop);
    this.sprite.zIndex = p.y;
    this.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.08);
  }
}
