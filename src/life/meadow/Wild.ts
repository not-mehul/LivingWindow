import { Container, Sprite } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { FOCAL } from '../../sim/groundPlane';
import { meadowCreek, meadowPlane } from '../../sim/meadowGeometry';
import { rabbitActivity } from '../../sim/wildlife';
import { BirdSpriteCache } from '../../sprites/birdSprites';
import { RABBIT_HOP, RabbitSprites, TOP_FISH_HEADINGS, TopFishSprites, type FishKind, type RabbitPose } from '../../sprites/meadowSprites';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);

// --- Rabbits darting between bushes --------------------------------------

type RabbitState = 'hidden' | 'peek' | 'sit' | 'hop' | 'freeze';

interface Rabbit {
  bush: number;
  x: number;
  target: number;
  state: RabbitState;
  timer: number;
  dir: 1 | -1;
  /** Washing its face while it sits. */
  groom: boolean;
  sprite: Sprite;
}

/** A sitting rabbit's height at depth 1. */
const RABBIT_HEIGHT = 18;

export class Rabbits {
  private readonly rabbits: Rabbit[] = [];
  private readonly sprites = new RabbitSprites();

  constructor(
    private readonly bushes: Array<{ x: number; y: number; width: number }>,
    container: Container,
  ) {
    for (let i = 0; i < 2; i++) {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      container.addChild(sprite);
      const bush = i % bushes.length;
      this.rabbits.push({ bush, x: bushes[bush].x, target: bushes[bush].x, state: 'hidden', timer: r(3, 20), dir: 1, groom: false, sprite });
    }
  }

  /** Scare every rabbit back under cover. */
  scare(): void {
    for (const rb of this.rabbits) if (rb.state !== 'hidden') this.dash(rb);
  }

  update(dt: number, env: Environment): void {
    const activity = rabbitActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.3 : 1);
    for (const rb of this.rabbits) {
      rb.timer -= dt;
      const home = this.bushes[rb.bush];
      switch (rb.state) {
        case 'hidden':
          if (rb.timer <= 0) {
            if (Math.random() < activity) {
              rb.state = 'peek';
              rb.timer = r(1, 3);
              rb.dir = Math.random() < 0.5 ? 1 : -1;
              rb.x = home.x + rb.dir * (home.width / 2 - 3);
            } else rb.timer = r(5, 20);
          }
          break;
        case 'peek':
          if (rb.timer <= 0) {
            rb.state = 'hop';
            rb.target = rb.x + rb.dir * r(8, 30);
          }
          break;
        case 'sit':
        case 'freeze':
          if (rb.timer <= 0) {
            const roll = Math.random();
            if (roll < 0.3) this.dash(rb);
            else if (roll < 0.6) {
              rb.state = 'hop';
              rb.target = rb.x + (Math.random() < 0.5 ? -1 : 1) * r(6, 20);
            } else {
              rb.state = Math.random() < 0.3 ? 'freeze' : 'sit';
              rb.groom = rb.state === 'sit' && Math.random() < 0.35;
              rb.timer = r(1.5, 5);
            }
          }
          break;
        case 'hop': {
          // Never aim past the edge of the world (it could never get there).
          rb.target = Math.max(4, Math.min(WORLD_WIDTH - 4, rb.target));
          const dx = rb.target - rb.x;
          rb.dir = dx >= 0 ? 1 : -1;
          rb.x += Math.sign(dx) * Math.min(Math.abs(dx), (rb.timer < -5 ? 60 : 22) * dt);
          if (Math.abs(dx) < 0.5) {
            const atBush = this.bushes.findIndex((b) => Math.abs(b.x - rb.x) < b.width / 2 - 4);
            if (atBush >= 0 && rb.timer < -5) {
              rb.bush = atBush;
              rb.state = 'hidden';
              rb.timer = r(6, 30);
            } else {
              rb.state = 'sit';
              rb.timer = r(2, 6);
            }
          }
          break;
        }
      }
      rb.x = Math.max(4, Math.min(WORLD_WIDTH - 4, rb.x));
      rb.sprite.visible = rb.state !== 'hidden';
      const pose: RabbitPose = rb.state === 'peek' ? 'peek' : rb.state === 'hop' ? RABBIT_HOP[Math.floor(Math.abs(rb.x) / 3) % 3] : rb.state === 'freeze' ? 'alert' : rb.groom ? 'groom' : 'sit';
      // Sized for how far off its bush stands.
      rb.sprite.texture = this.sprites.get(pose, Math.max(6, Math.min(16, RABBIT_HEIGHT * meadowPlane.scaleAtY(home.y))));
      rb.sprite.scale.x = rb.dir;
      rb.sprite.position.set(Math.round(rb.x), home.y);
      // Sorted among the bushes and cows; just in front of its own bush while peeking out.
      rb.sprite.zIndex = home.y + 0.5;
      rb.sprite.tint = env.lighting.ambient;
    }
  }

  /** Dash for a bush (the timer marks the hop as a sprint). */
  private dash(rb: Rabbit): void {
    const nearest = this.bushes.reduce((best, b, i) => (Math.abs(b.x - rb.x) < Math.abs(this.bushes[best].x - rb.x) ? i : best), 0);
    rb.state = 'hop';
    rb.target = this.bushes[nearest].x;
    rb.timer = -10;
  }
}

// --- Fish in the creek, seen from above ---------------------------------

interface CreekFish {
  kind: FishKind;
  /** Ground px along the creek (depth × focal length) and across it. */
  along: number;
  across: number;
  home: number;
  /** Darting speed along the creek (ground px/s; positive = away, upstream). */
  speed: number;
  dart: number;
  sprite: Sprite;
  /** Its shadow on the creek bed. */
  shadow: Sprite;
}

/** The creek's flow comes towards the viewer: fish face upstream, away from us. */
const MIN_ALONG = 1.5 * FOCAL;
const MAX_ALONG = 3.6 * FOCAL;

/**
 * Trout and minnows in the creek, seen from above as dark shapes with a glint
 * off their backs: they hold station against the current, finning, and now
 * and then dart off. A tap nearby scatters them.
 */
export class StreamFishes {
  private readonly fish: CreekFish[] = [];
  private readonly sprites = new TopFishSprites();

  constructor(container: Container) {
    for (let i = 0; i < 8; i++) {
      const kind: FishKind = i < 3 ? 'trout' : 'minnow';
      const sprite = new Sprite({ anchor: 0.5 });
      const shadow = new Sprite({ anchor: 0.5 });
      container.addChild(shadow, sprite);
      const along = r(MIN_ALONG, MAX_ALONG);
      this.fish.push({ kind, along, across: r(-0.5, 0.5) * meadowCreek.halfWidth, home: along, speed: 0, dart: 0, sprite, shadow });
    }
  }

  /** Startle the fish near a world point. */
  scatter(x: number, y: number): boolean {
    let hit = false;
    for (const f of this.fish) {
      const p = f.sprite.position;
      if (Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 18) {
        f.dart = 0.6;
        f.speed = (Math.random() < 0.6 ? 1 : -1) * r(160, 240);
        hit = true;
      }
    }
    return hit;
  }

  update(dt: number, env: Environment, time: number): void {
    const half = meadowCreek.halfWidth * 0.7;
    for (const f of this.fish) {
      if (f.dart > 0) {
        f.dart -= dt;
        f.along += f.speed * dt;
        f.speed *= Math.exp(-3 * dt);
        if (f.dart <= 0) f.home = f.along;
      } else {
        // Holding against the current, drifting a little and finning.
        f.along += (f.home - f.along) * dt * 0.8 + Math.sin(time * 1.3 + f.home) * 6 * dt;
        f.across += Math.sin(time * 0.7 + f.home * 0.1) * 3 * dt;
        if (Math.random() < dt * 0.04) {
          f.dart = r(0.3, 0.7);
          f.speed = (Math.random() < 0.7 ? 1 : -1) * r(80, 160);
        }
      }
      f.along = Math.max(MIN_ALONG, Math.min(MAX_ALONG, f.along));
      f.across = Math.max(-half, Math.min(half, f.across));
      const depth = f.along / FOCAL;
      const p = meadowCreek.point(depth, f.across);
      // Facing upstream, or the way it darts.
      let angle = meadowCreek.screenAngle(depth);
      if (f.dart > 0 && f.speed < 0) angle += Math.PI;
      const heading = Math.round((angle / (Math.PI * 2)) * TOP_FISH_HEADINGS);
      const frame = Math.floor(time * (f.dart > 0 ? 12 : 4) + f.home) % 2 === 0 ? 0 : 1;
      f.sprite.texture = this.sprites.get(f.kind, heading, frame);
      f.sprite.position.set(Math.round(p.x), Math.round(p.y));
      // Its shadow falls on the bed below, a little down and to the side.
      f.shadow.texture = this.sprites.get(f.kind, heading, frame, true);
      f.shadow.position.set(Math.round(p.x) + 1, Math.round(p.y) + 2);
      // Harder to see at night.
      f.sprite.alpha = 0.9 * (1 - env.lighting.darkness * 0.85);
      f.shadow.alpha = 0.22 * (1 - env.lighting.darkness);
    }
  }
}

// --- An eagle soaring on thermals -------------------------------------------

export class SoaringEagle {
  private readonly sprites = new BirdSpriteCache();
  private sprite: Sprite | null = null;
  private centre = { x: 0, y: 0 };
  private angle = 0;
  private radius = 50;
  private life = 0;
  private timer = r(20, 60);

  constructor(
    private readonly container: Container,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (!this.sprite) {
      this.timer -= dt;
      if (this.timer <= 0 && env.lighting.darkness < 0.4 && env.weather.precipitation < 0.2) {
        this.sprite = new Sprite({ anchor: 0.5 });
        this.container.addChild(this.sprite);
        this.centre = { x: this.viewport.panX + this.viewport.layout.visibleWorldWidth * r(0.25, 0.75), y: r(60, 110) };
        this.radius = r(35, 65);
        this.life = r(40, 80);
        this.angle = Math.random() * Math.PI * 2;
      } else if (this.timer <= 0) this.timer = 30;
      return;
    }
    this.life -= dt;
    this.angle += dt * 0.35;
    // Slowly drift with the wind while circling; drift away at the end.
    this.centre.x += env.weather.wind * 3 * dt + (this.life < 0 ? 25 * dt : 0);
    const x = this.centre.x + Math.cos(this.angle) * this.radius;
    const y = this.centre.y + Math.sin(this.angle) * this.radius * 0.25;
    this.sprite.texture = this.sprites.get('eagle', 'glide', 10);
    this.sprite.scale.x = Math.sin(this.angle) > 0 ? -1 : 1;
    this.sprite.position.set(Math.round(x), Math.round(y));
    this.sprite.tint = env.lighting.ambient;
    if (Math.random() < dt * 0.03) this.sound('eagle-cry', this.viewport.worldXToStereo(x), 0.9);
    if (this.life < -20) {
      this.sprite.destroy();
      this.sprite = null;
      this.timer = r(90, 200);
    }
  }
}
