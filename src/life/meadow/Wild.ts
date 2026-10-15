import { Container, Graphics, Sprite } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { WATER_BOTTOM, WATER_TOP } from '../../scene/meadow/MeadowScene';
import { fireflyLevel, rabbitActivity } from '../../sim/wildlife';
import { BirdSpriteCache } from '../../sprites/birdSprites';
import { RabbitSprites, StreamFishSprites, type FishKind, type RabbitPose } from '../../sprites/meadowSprites';
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
  sprite: Sprite;
}

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
      this.rabbits.push({ bush, x: bushes[bush].x, target: bushes[bush].x, state: 'hidden', timer: r(3, 20), dir: 1, sprite });
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
              rb.timer = r(1.5, 5);
            }
          }
          break;
        case 'hop': {
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
      const pose: RabbitPose = rb.state === 'peek' ? 'peek' : rb.state === 'hop' ? (Math.floor(rb.x / 4) % 2 === 0 ? 'hop-1' : 'hop-2') : 'sit';
      rb.sprite.texture = this.sprites.get(pose);
      rb.sprite.scale.x = rb.dir;
      rb.sprite.position.set(Math.round(rb.x), home.y);
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

// --- Fish in the stream ---------------------------------------------------

interface StreamFish {
  kind: FishKind;
  x: number;
  y: number;
  home: number;
  vx: number;
  dart: number;
  dir: 1 | -1;
  sprite: Sprite;
}

/** Fish holding station against the current, now and then darting off. */
export class StreamFishes {
  private readonly fish: StreamFish[] = [];
  private readonly sprites = new StreamFishSprites();

  constructor(container: Container) {
    for (let i = 0; i < 7; i++) {
      const kind: FishKind = i < 3 ? 'trout' : 'minnow';
      const sprite = new Sprite({ anchor: 0.5 });
      container.addChild(sprite);
      const x = r(40, WORLD_WIDTH - 40);
      this.fish.push({ kind, x, y: r(WATER_TOP + 6, WATER_BOTTOM - 6), home: x, vx: 0, dart: 0, dir: -1, sprite });
    }
  }

  /** Startle the fish near a point. */
  scatter(x: number, y: number): boolean {
    let hit = false;
    for (const f of this.fish) {
      if (Math.abs(f.x - x) < 40 && Math.abs(f.y - y) < 20) {
        f.dart = 0.6;
        f.vx = (f.x > x ? 1 : -1) * r(60, 90);
        hit = true;
      }
    }
    return hit;
  }

  update(dt: number, env: Environment, time: number): void {
    for (const f of this.fish) {
      if (f.dart > 0) {
        f.dart -= dt;
        f.x += f.vx * dt;
        f.vx *= Math.exp(-3 * dt);
        if (f.dart <= 0) f.home = f.x;
      } else {
        // Facing upstream (the current flows to the right), finning gently.
        f.x += (f.home - f.x) * dt * 0.8 + Math.sin(time * 1.3 + f.home) * 3 * dt;
        f.y += Math.sin(time * 0.7 + f.home * 0.1) * 2 * dt;
        if (Math.random() < dt * 0.04) {
          f.dart = r(0.3, 0.7);
          f.vx = (Math.random() < 0.7 ? -1 : 1) * r(30, 70);
        }
      }
      f.x = Math.max(6, Math.min(WORLD_WIDTH - 6, f.x));
      f.y = Math.max(WATER_TOP + 4, Math.min(WATER_BOTTOM - 4, f.y));
      f.dir = f.dart > 0 ? (f.vx >= 0 ? 1 : -1) : -1;
      f.sprite.texture = this.sprites.get(f.kind, Math.floor(time * (f.dart > 0 ? 12 : 4) + f.home) % 2 === 0 ? 0 : 1);
      f.sprite.scale.x = -f.dir;
      f.sprite.position.set(Math.round(f.x), Math.round(f.y));
      f.sprite.alpha = 0.85 * (1 - env.lighting.darkness * 0.8);
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

// --- Fireflies ------------------------------------------------------------

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  on: number;
  off: number;
}

export class Fireflies {
  private readonly flies: Firefly[] = [];

  constructor(private readonly graphics: Graphics) {
    graphics.blendMode = 'add';
    for (let i = 0; i < 34; i++) {
      this.flies.push({ x: r(0, WORLD_WIDTH), y: r(262, 330), vx: r(-3, 3), vy: r(-1, 1), phase: Math.random() * 4, on: r(0.3, 0.6), off: r(1, 4) });
    }
  }

  update(dt: number, env: Environment): void {
    const g = this.graphics;
    g.clear();
    const level = fireflyLevel(env.lighting.hours, env.lighting.darkness, env.weather.kind === 'rain' && env.weather.precipitation > 0.05);
    if (level <= 0) return;
    const count = Math.round(this.flies.length * level);
    for (let i = 0; i < count; i++) {
      const f = this.flies[i];
      f.phase += dt;
      if (f.phase > f.on + f.off) f.phase = 0;
      f.vx += r(-6, 6) * dt;
      f.vy += r(-4, 4) * dt;
      f.vx = Math.max(-5, Math.min(5, f.vx));
      f.vy = Math.max(-2, Math.min(2, f.vy));
      f.x = (f.x + f.vx * dt + WORLD_WIDTH) % WORLD_WIDTH;
      f.y = Math.max(255, Math.min(334, f.y + f.vy * dt));
      if (f.phase > f.on) continue;
      // Glow swells and fades within each flash.
      const glow = Math.sin((f.phase / f.on) * Math.PI);
      const x = Math.round(f.x);
      const y = Math.round(f.y);
      g.rect(x - 1, y - 1, 3, 3).fill({ color: 0x8ac83a, alpha: glow * 0.3 });
      g.rect(x - 1, y, 3, 1).fill({ color: 0xc8f05a, alpha: glow * 0.6 });
      g.rect(x, y - 1, 1, 3).fill({ color: 0xc8f05a, alpha: glow * 0.6 });
      g.rect(x, y, 1, 1).fill({ color: 0xf4ffa0, alpha: glow });
    }
  }
}
