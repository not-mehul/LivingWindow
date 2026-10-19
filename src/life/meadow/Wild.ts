import { Container, Graphics, Sprite } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import { FOCAL } from '../../sim/groundPlane';
import { meadowCreek, meadowPlane } from '../../sim/meadowGeometry';
import { rabbitActivity } from '../../sim/wildlife';
import { DrawnCache, drawEagleSoar, EAGLE_STOOP } from '../../sprites/wildSprites';
import { RABBIT_HOP, RabbitSprites, TOP_FISH_HEADINGS, TopFishSprites, type FishKind, type RabbitPose } from '../../sprites/meadowSprites';
import type { LifeSoundSink } from '../types';
import { rand as r } from '../../core/random';

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
  /** Frozen with a threat about: it bolts for cover once the freeze is over. */
  bolt: boolean;
  /** Chasing about at play (s left); the one it's chasing, if it's the follower. */
  play: number;
  chasing: Rabbit | null;
  /** A leap straight up, mid-play (s left). */
  binky: number;
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
      this.rabbits.push({ bush, x: bushes[bush].x, target: bushes[bush].x, state: 'hidden', timer: r(3, 20), dir: 1, groom: false, sprite, bolt: false, play: 0, chasing: null, binky: 0 });
    }
  }

  /** Scare every rabbit back under cover. */
  scare(): void {
    for (const rb of this.rabbits) if (rb.state !== 'hidden') this.dash(rb);
  }

  /** Rabbits out in the open (world px, feet). */
  get spots(): Array<{ x: number; y: number }> {
    return this.rabbits.filter((rb) => rb.state !== 'hidden').map((rb) => ({ x: rb.x, y: this.bushes[rb.bush].y }));
  }

  /**
   * Something dangerous at a world point (y NaN for overhead): a rabbit within `radius` freezes
   * (ears up) and, if it's close or `bolt` is set, dashes for cover once
   * its nerve breaks.
   */
  alarm(x: number, y: number, radius: number, bolt = false): number {
    let n = 0;
    for (const rb of this.rabbits) {
      if (rb.state === 'hidden' || rb.bolt) continue;
      // From overhead (y NaN), only how far along the field it is counts.
      const d = Math.hypot(rb.x - x, Number.isNaN(y) ? 0 : (this.bushes[rb.bush].y - y) * 2);
      if (d > radius) continue;
      n++;
      rb.play = 0;
      rb.chasing = null;
      if (d < radius * 0.35 && !bolt) {
        this.dash(rb);
        continue;
      }
      rb.state = 'freeze';
      rb.groom = false;
      rb.timer = r(0.8, 2.2);
      rb.bolt = bolt || d < radius * 0.7;
    }
    return n;
  }

  /** Golden-hour play: the two rabbits out together, one chasing the other round in quick loops, leaping straight up for joy. */
  play(): boolean {
    const out = this.rabbits.find((rb) => rb.state === 'sit' || rb.state === 'hop' || rb.state === 'peek');
    const other = this.rabbits.find((rb) => rb !== out);
    if (!out || !other || out.bolt) return false;
    if (other.state === 'hidden') {
      // Out from the same bush.
      other.bush = out.bush;
      other.x = out.x - out.dir * 6;
    }
    for (const rb of [out, other]) {
      rb.state = 'hop';
      rb.play = r(5, 9);
      rb.groom = false;
    }
    out.chasing = null;
    other.chasing = out;
    out.target = out.x;
    return true;
  }

  update(dt: number, env: Environment): void {
    const activity = rabbitActivity(env.lighting.hours) * (env.weather.kind === 'rain' ? 0.3 : 1);
    for (const rb of this.rabbits) {
      rb.timer -= dt;
      const home = this.bushes[rb.bush];
      if (rb.binky > 0) rb.binky -= dt;
      if (rb.play > 0) {
        rb.play -= dt;
        // At play: quick hops in loops round the bush, the other hard on its tail.
        if (rb.chasing) rb.target = rb.chasing.x - rb.chasing.dir * 7;
        else if (Math.abs(rb.target - rb.x) < 1) rb.target = home.x + r(-1, 1) * (home.width / 2 + 26);
        rb.target = Math.max(4, Math.min(WORLD_WIDTH - 4, rb.target));
        const dx = rb.target - rb.x;
        if (Math.abs(dx) > 0.5) rb.dir = dx > 0 ? 1 : -1;
        rb.x += Math.sign(dx) * Math.min(Math.abs(dx), (rb.chasing ? 50 : 44) * dt);
        if (rb.binky <= 0 && Math.random() < dt * 0.7) rb.binky = 0.4;
        if (rb.play <= 0) {
          rb.chasing = null;
          rb.state = 'sit';
          rb.timer = r(2, 5);
        }
      } else switch (rb.state) {
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
          if (rb.timer <= 0 && rb.bolt) {
            rb.bolt = false;
            this.dash(rb);
          } else if (rb.timer <= 0) {
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
      // A binky: straight up and down.
      const leap = rb.binky > 0 ? Math.round(Math.sin((1 - rb.binky / 0.4) * Math.PI) * 6 * meadowPlane.scaleAtY(home.y) * 2) : 0;
      rb.sprite.position.set(Math.round(rb.x), home.y - leap);
      // Sorted among the bushes and cows; just in front of its own bush while peeking out.
      rb.sprite.zIndex = home.y + 0.5;
      rb.sprite.tint = env.lighting.ambient;
    }
  }

  /** Dash for a bush (the timer marks the hop as a sprint). */
  private dash(rb: Rabbit): void {
    rb.play = 0;
    rb.chasing = null;
    rb.bolt = false;
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
  /** Rings spreading where a trout rose. */
  private readonly rings: Array<{ x: number; y: number; scale: number; age: number }> = [];
  private readonly ringGfx = new Graphics();

  constructor(container: Container) {
    container.addChild(this.ringGfx);
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

  /** A trout rises to take something off the surface here (ground px along and across the creek): a quick dart up, and a ring spreading. */
  rise(along: number, across: number): void {
    const trout = this.fish.filter((f) => f.kind === 'trout');
    const f = trout.reduce((best, t) => (Math.abs(t.along - along) < Math.abs(best.along - along) ? t : best), trout[0]);
    if (f) {
      f.dart = 0.35;
      f.speed = Math.sign(along - f.along || 1) * Math.min(220, Math.abs(along - f.along) * 3 + 40);
      f.across = across;
    }
    const p = meadowCreek.point(along / FOCAL, across);
    this.rings.push({ x: p.x, y: p.y, scale: p.scale, age: 0 });
    // A second, fainter ring a beat later.
    this.rings.push({ x: p.x, y: p.y, scale: p.scale * 0.8, age: -0.35 });
  }

  update(dt: number, env: Environment, time: number): void {
    const g = this.ringGfx;
    g.clear();
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.age += dt;
      if (ring.age > 2) {
        this.rings.splice(i, 1);
        continue;
      }
      if (ring.age < 0) continue;
      const rx = (1.5 + ring.age * 7) * Math.max(0.5, ring.scale);
      const alpha = 0.55 * (1 - ring.age / 2) * (1 - env.lighting.darkness * 0.6);
      g.ellipse(Math.round(ring.x), Math.round(ring.y), rx, Math.max(0.6, rx * 0.35)).stroke({ color: 0xeaf4f8, width: 1, alpha });
    }
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

/**
 * An eagle soaring on thermals, circling high over the field and drifting
 * with the wind; now and then it drops low over the field in a long, slow
 * pass, hunting, with a cry, before climbing back up.
 */
export class SoaringEagle {
  private readonly sprites = new DrawnCache();
  private sprite: Sprite | null = null;
  private flex = 0;
  private centre = { x: 0, y: 0 };
  private angle = 0;
  private radius = 50;
  private life = 0;
  private timer = r(20, 60);
  /** The low hunting pass: time into it (s), or negative when not stooping. */
  private stoop = -1;
  private readonly stoopLength = 11;
  private at = { x: 0, y: 0 };
  private huntOnArrival = false;

  constructor(
    private readonly container: Container,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  summon(hunt = false): void {
    this.timer = 0;
    this.huntOnArrival = hunt;
  }

  /** Drop low over the field now (if it's up). */
  hunt(): boolean {
    if (!this.sprite || this.stoop >= 0 || this.life < 0) return false;
    this.stoop = 0;
    return true;
  }

  /** Where it is, while it's low enough over the field to cast fear (world px). */
  get low(): { x: number; y: number } | null {
    if (!this.sprite || this.stoop < 0) return null;
    const k = this.stoop / this.stoopLength;
    return k > 0.2 && k < 0.85 ? { ...this.at } : null;
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
        this.stoop = this.huntOnArrival ? 0 : -1;
        this.huntOnArrival = false;
      } else if (this.timer <= 0) this.timer = 30;
      return;
    }
    this.life -= dt;
    this.angle += dt * 0.35;
    // Slowly drift with the wind while circling; drift away at the end.
    this.centre.x += env.weather.wind * 3 * dt + (this.life < 0 ? 25 * dt : 0);
    // Now and then, a low hunting pass over the field.
    if (this.stoop < 0 && this.life > 8 && Math.random() < dt / 90) this.stoop = 0;
    let drop = 0;
    let size = 10;
    // Riding the air: the wings flex now and then, tips lifting and settling.
    this.flex += dt * (0.4 + Math.abs(env.weather.wind) * 0.8);
    const sway = Math.sin(this.flex) + Math.sin(this.flex * 2.3) * 0.4;
    let frame = sway > 0.8 ? 0 : sway < -0.8 ? 2 : 1;
    if (this.stoop >= 0) {
      this.stoop += dt;
      const k = Math.min(1, this.stoop / this.stoopLength);
      const dip = Math.sin(k * Math.PI);
      drop = dip * 75;
      size = 10 + Math.round(dip * 4) * 2;
      // Wings half folded on the way down; spread wide and raised to pull out of it.
      if (k > 0.15 && k < 0.55) frame = EAGLE_STOOP;
      else if (k >= 0.55 && k < 0.8) frame = 0;
      if (this.stoop - dt < 1.2 && this.stoop >= 1.2) this.sound('eagle-cry', this.viewport.worldXToStereo(this.at.x), 1);
      if (k >= 1) this.stoop = -1;
    }
    const x = this.centre.x + Math.cos(this.angle) * this.radius;
    const y = this.centre.y + Math.sin(this.angle) * this.radius * 0.25 + drop;
    this.at = { x, y };
    this.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawEagleSoar(frame, size));
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
