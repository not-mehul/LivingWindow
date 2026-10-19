import { Graphics, Sprite } from 'pixi.js';
import { lerpColor, multiplyColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { BeachScene } from '../../scene/beach/BeachScene';
import type { Environment } from '../../scene/Environment';
import { BREAK_S, shorePoint } from '../../sim/shore';
import { drawEgret, drawFrigatebird, drawGull, drawJumpFish, JUMP_FRAMES, type EgretPose, type GullPose } from '../../sprites/shoreSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import type { Tracks } from './Tracks';
import { rand as r } from '../../core/random';

const daylight = (env: Environment) => env.lighting.darkness < 0.45 && env.weather.lightning < 0.3 && env.weather.precipitation < 0.5;
const GULL_FLAP: readonly GullPose[] = ['flap-up', 'glide', 'flap-down', 'glide'];
/** A standing gull's height right in front of the window, and an egret's. */
const GULL_SIZE = 26;
const EGRET_SIZE = 46;

/** The beach's view, for picking places that are on screen. */
function inView(viewport: Viewport, x: number, margin = 20): boolean {
  return x > viewport.panX + margin && x < viewport.panX + viewport.layout.visibleWorldWidth - margin;
}

// --- The little egret ----------------------------------------------------------

type EgretPhase = 'arrive' | 'walk' | 'freeze' | 'strike' | 'swallow' | 'leave';

/**
 * A little egret working the edge of the water by day: pacing slowly
 * through the swash on its black legs and yellow feet, then freezing, neck
 * drawn back, for a long moment, and striking down like a dart; a gulp,
 * and on again. It comes gliding in, and flaps off again towards evening.
 */
export class Egret {
  tracks: Tracks | null = null;
  private readonly sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
  private readonly sprites = new DrawnCache();
  private phase: EgretPhase | null = null;
  private depth = 2;
  private s = 0;
  private dir: 1 | -1 = 1;
  private t = 0;
  private hold = 0;
  private steps = 0;
  private timer = r(30, 120);
  private air = 0;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {
    this.sprite.visible = false;
    scene.shoreLayer.addChild(this.sprite);
  }

  get state(): EgretPhase | null {
    return this.phase;
  }

  /** Where it's standing or wading (shore coordinates), while it's down. */
  get spot(): { depth: number; s: number } | null {
    return this.phase && this.phase !== 'arrive' && this.phase !== 'leave' ? { depth: this.depth, s: this.s } : null;
  }

  summon(): void {
    this.timer = 0;
    if (this.phase === 'leave') this.phase = null;
  }

  update(dt: number, env: Environment): void {
    const day = daylight(env) && env.lighting.hours > 6.5 && env.lighting.hours < 18.6;
    if (!this.phase) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(200, 500);
        if (day) this.arrive();
      }
      return;
    }
    if (!day && this.phase !== 'leave' && this.phase !== 'arrive') this.go('leave');
    this.t += dt;
    const edge = () => -this.scene.reachAt(this.depth) + 4;
    let pose: EgretPose = 'stand';
    switch (this.phase) {
      case 'arrive':
        // Gliding down out of the sky onto the edge of the water.
        this.air = Math.max(0, 60 * (1 - this.t / 3));
        this.s += (edge() - this.s) * Math.min(1, dt * 2);
        pose = this.air > 2 ? (Math.floor(this.t * 3) % 2 ? 'fly-0' : 'fly-1') : 'stand';
        if (this.t > 3) this.go('walk');
        break;
      case 'walk': {
        // A slow, high step at a time.
        const step = Math.floor(this.t / 0.7);
        pose = step % 2 ? 'step-1' : 'step-0';
        this.depth += this.dir * 0.022 * dt;
        this.s += (edge() - this.s) * Math.min(1, dt * 0.6);
        this.tracks?.walk(this, 'bird', this.depth, this.s);
        if (this.t > this.hold) this.go(Math.random() < 0.7 ? 'freeze' : 'walk');
        if (this.depth < 1.3 || this.depth > 3.4) this.dir = this.depth < 1.3 ? 1 : -1;
        break;
      }
      case 'freeze':
        pose = 'crouch';
        if (this.t > this.hold) this.go(Math.random() < 0.6 ? 'strike' : 'walk');
        break;
      case 'strike':
        pose = 'strike';
        if (this.t > 0.35) {
          const p = shorePoint(this.depth, this.s + 6);
          this.scene.splash(p.x, p.y, 0.25);
          this.go('swallow');
        }
        break;
      case 'swallow':
        pose = Math.floor(this.t * 4) % 2 ? 'stand' : 'crouch';
        if (this.t > 1.4) this.go(++this.steps > 8 && Math.random() < 0.3 ? 'leave' : 'walk');
        break;
      case 'leave':
        this.air += dt * 26;
        this.depth += this.dir * 0.2 * dt;
        pose = Math.floor(this.t * 3) % 2 ? 'fly-0' : 'fly-1';
        if (this.air > 140) {
          this.phase = null;
          this.sprite.visible = false;
          return;
        }
        break;
    }
    const p = shorePoint(this.depth, this.s);
    const size = Math.max(10, Math.round(EGRET_SIZE * p.scale));
    this.sprite.texture = this.sprites.get(`${pose}:${size}`, () => drawEgret(pose, size));
    this.sprite.scale.x = this.dir > 0 ? -1 : 1;
    this.sprite.position.set(Math.round(p.x), Math.round(p.y - this.air * p.scale));
    this.sprite.zIndex = p.y;
    this.sprite.tint = lerpColor(env.lighting.ambient, 0xffffff, 0.08);
  }

  private go(phase: EgretPhase): void {
    this.phase = phase;
    this.t = 0;
    this.hold = phase === 'walk' ? r(2, 6) : phase === 'freeze' ? r(2, 7) : 0;
    if (phase === 'walk' && Math.random() < 0.25) this.dir = this.dir > 0 ? -1 : 1;
  }

  private arrive(): void {
    let depth = r(1.4, 2.8);
    for (let i = 0; i < 10 && !inView(this.viewport, shorePoint(depth, 0).x, 40); i++) depth = r(1.4, 3);
    this.depth = depth;
    this.s = -this.scene.reachAt(depth);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.steps = 0;
    this.sprite.visible = true;
    this.go('arrive');
  }
}

// --- Gulls on the water, in the wind, and squabbling ------------------------------

interface Floater {
  depth: number;
  s: number;
  sprite: Sprite;
  phase: number;
  dip: number;
  /** Coming in to land (> 0, falling) or taking off (< 0, rising), in the air this high. */
  air: number;
  leaving: boolean;
  dir: 1 | -1;
  flap: number;
  /** Down beside something (the pelican) for a while, then off again (s left). */
  visit?: number;
}

interface Wheeler {
  sprite: Sprite;
  angle: number;
  radius: number;
  speed: number;
  y: number;
}

interface Squabble {
  depth: number;
  s: number;
  t: number;
  dur: number;
  a: Sprite;
  b: Sprite;
  scrap: Graphics;
  /** After the tug: which one got it (flying off with it), and how far it's gone. */
  winner: 0 | 1 | null;
  away: number;
}

/**
 * The gulls' lives between hunts: a few riding the swell out beyond the
 * breakers, heads dipping under now and then, coming in to land and taking
 * off again; on a windy day one hanging motionless over the beach on the
 * wind, flexing its wingtips; and now and then two of them on the sand in
 * a tug-of-war over a scrap, until one wins and flies off with it.
 */
export class Gulls {
  tracks: Tracks | null = null;
  private readonly sprites = new DrawnCache();
  private readonly floaters: Floater[] = [];
  private floatTimer = 3;
  private hover: { x: number; y: number; t: number; dur: number; sprite: Sprite; frame: number; next: number; leaving: number } | null = null;
  private hoverTimer = r(20, 60);
  private squabble: Squabble | null = null;
  private squabbleTimer = r(90, 240);
  /** A little cloud of gulls wheeling over something in the water (feeding dolphins). */
  private wheel: { x: number; y: number; t: number; dur: number; birds: Wheeler[] } | null = null;
  private wind = 0;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  get floating(): number {
    return this.floaters.filter((f) => f.air === 0).length;
  }

  get hovering(): boolean {
    return this.hover !== null;
  }

  get squabbling(): boolean {
    return this.squabble !== null;
  }

  summonSquabble(): void {
    this.squabbleTimer = 0;
  }

  summonHover(): void {
    this.hoverTimer = 0;
  }

  /** A gull flies in and lands on the water at this shore spot, staying `stay` seconds (beside the pelican, hoping for scraps). */
  landAt(depth: number, s: number, stay: number): void {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.scene.seaLife.addChild(sprite);
    this.floaters.push({ depth, s, sprite, phase: Math.random() * 6, dip: 0, air: 50, leaving: false, dir: Math.random() < 0.5 ? 1 : -1, flap: 0, visit: stay });
  }

  /** Gulls gather over a spot out at sea (world px) and wheel about it, calling, for a while. */
  wheelOver(x: number, y: number, seconds: number): void {
    if (this.wheel) return;
    const birds: Wheeler[] = [];
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const sprite = new Sprite({ anchor: 0.5 });
      sprite.alpha = 0;
      this.scene.birdsFar.addChild(sprite);
      birds.push({ sprite, angle: Math.random() * Math.PI * 2, radius: r(8, 22), speed: r(0.6, 1.1) * (Math.random() < 0.5 ? 1 : -1), y: r(-14, -4) });
    }
    this.wheel = { x, y, t: 0, dur: seconds, birds };
  }

  /** Something out there worth following (the fishing boat's stern): gulls on the water lift off and head that way. */
  headFor(x: number): void {
    for (const f of this.floaters) {
      if (f.leaving || Math.random() < 0.4) continue;
      f.leaving = true;
      f.dir = x > shorePoint(f.depth, f.s).x ? 1 : -1;
    }
    if (this.hover && this.hover.leaving === 0) this.hover.dur = this.hover.t;
  }

  /** A big swell: one of the gulls riding it gets up. */
  bigWave(): void {
    const f = this.floaters.find((g) => !g.leaving && g.air === 0);
    if (f && Math.random() < 0.6) {
      f.leaving = true;
      f.dir = Math.random() < 0.5 ? 1 : -1;
    }
  }

  update(dt: number, env: Environment): void {
    const day = daylight(env);
    this.wind = env.weather.wind ?? 0;
    this.updateFloaters(dt, env, day);
    this.updateHover(dt, env, day);
    this.updateSquabble(dt, env, day);
    this.updateWheel(dt, env);
  }

  private updateWheel(dt: number, env: Environment): void {
    const w = this.wheel;
    if (!w) return;
    w.t += dt;
    const fade = Math.min(1, w.t / 2, Math.max(0, w.dur - w.t) / 2);
    for (const b of w.birds) {
      b.angle += b.speed * dt;
      const x = w.x + Math.cos(b.angle) * b.radius;
      const y = w.y + b.y + Math.sin(b.angle) * b.radius * 0.3;
      const pose: GullPose = Math.floor(w.t * 2 + b.radius) % 3 === 0 ? GULL_FLAP[Math.floor(w.t * 9 + b.radius) % 4] : 'glide';
      b.sprite.texture = this.gull(pose, 7);
      b.sprite.scale.x = Math.sin(b.angle) * Math.sign(b.speed) > 0 ? -1 : 1;
      b.sprite.position.set(Math.round(x), Math.round(y));
      b.sprite.alpha = fade;
      b.sprite.tint = env.lighting.ambient;
    }
    if (Math.random() < dt * 0.6) this.sound('gull-cry', this.viewport.worldXToStereo(w.x), 0.25);
    if (w.t > w.dur) {
      for (const b of w.birds) b.sprite.destroy();
      this.wheel = null;
    }
  }

  private gull(pose: GullPose, size: number) {
    return this.sprites.get(`${pose}:${size}`, () => drawGull(pose, size));
  }

  private updateFloaters(dt: number, env: Environment, day: boolean): void {
    this.floatTimer -= dt;
    const want = day ? 3 : 1;
    if (this.floatTimer <= 0) {
      this.floatTimer = r(20, 60);
      const settled = this.floaters.filter((f) => !f.leaving);
      if (settled.length < want) this.land();
      else if (settled.length > 0 && Math.random() < 0.4) {
        const f = settled[Math.floor(Math.random() * settled.length)];
        f.leaving = true;
        f.dir = Math.random() < 0.5 ? 1 : -1;
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.phase += dt;
      let pose: GullPose;
      if (f.leaving) {
        // Running a few steps over the water, then up and away.
        f.air += dt * 22;
        f.depth += f.dir * 0.12 * dt;
        f.flap += dt * 9;
        pose = GULL_FLAP[Math.floor(f.flap) % 4];
        if (f.air > 120) {
          f.sprite.destroy();
          this.floaters.splice(i, 1);
          continue;
        }
      } else if (f.air > 0) {
        // Gliding down, feet out, onto the water.
        f.air = Math.max(0, f.air - dt * 18);
        pose = f.air > 4 ? 'glide' : 'hover-1';
        if (f.air === 0) this.scene.splash(shorePoint(f.depth, f.s).x, shorePoint(f.depth, f.s).y, 0.2);
      } else {
        // Riding the swell, drifting; a head dipped under now and then. In a breeze they all swing round to face into it, and drift back on it.
        f.s += Math.sin(f.phase * 0.05) * dt * 0.8;
        if (Math.abs(this.wind) > 0.35) {
          f.dir = this.wind > 0 ? -1 : 1;
          f.depth += this.wind * 0.01 * dt;
        }
        if (f.dip > 0) f.dip -= dt;
        else if (Math.random() < dt * 0.06) f.dip = r(0.6, 1.4);
        pose = f.dip > 0 ? 'float-dip' : 'float';
        if (f.visit !== undefined) {
          f.visit -= dt;
          if (f.visit <= 0) {
            f.visit = undefined;
            f.leaving = true;
          }
        }
      }
      const p = shorePoint(f.depth, f.s);
      const bob = f.air > 0 ? 0 : Math.sin(f.phase * 1.3 + f.depth * 5) * 1.3 * p.scale + Math.sin(f.phase * 0.47) * 0.6 * p.scale;
      const size = Math.max(6, Math.round(GULL_SIZE * p.scale));
      f.sprite.texture = this.gull(pose, size);
      f.sprite.scale.x = f.leaving ? f.dir : f.dir;
      f.sprite.position.set(Math.round(p.x), Math.round(p.y + bob - f.air * p.scale));
      f.sprite.tint = env.lighting.ambient;
    }
  }

  private land(): void {
    let depth = r(1.5, 3.6);
    let s = r(BREAK_S + 40, 260);
    for (let i = 0; i < 10 && !inView(this.viewport, shorePoint(depth, s).x); i++) {
      depth = r(1.5, 3.6);
      s = r(BREAK_S + 40, 240);
    }
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.scene.seaLife.addChild(sprite);
    this.floaters.push({ depth, s, sprite, phase: Math.random() * 6, dip: 0, air: 60, leaving: false, dir: Math.random() < 0.5 ? 1 : -1, flap: 0 });
  }

  private updateHover(dt: number, env: Environment, day: boolean): void {
    const wind = env.weather.wind ?? 0;
    if (!this.hover) {
      this.hoverTimer -= dt;
      if (this.hoverTimer <= 0) {
        this.hoverTimer = r(60, 200);
        if (day && Math.abs(wind) > 0.3) {
          const sprite = new Sprite({ anchor: 0.5 });
          this.scene.birdsMid.addChild(sprite);
          this.hover = { x: this.viewport.panX + r(0.25, 0.75) * this.viewport.layout.visibleWorldWidth, y: r(120, 190), t: 0, dur: r(18, 40), sprite, frame: 0, next: 0.5, leaving: 0 };
        }
      }
      return;
    }
    const h = this.hover;
    h.t += dt;
    // Holding station: tiny slips and corrections, wingtips flexing as the gusts hit.
    h.next -= dt;
    if (h.next <= 0) {
      h.frame = 1 - h.frame;
      h.next = r(0.25, 1.1) / (0.5 + Math.abs(wind));
    }
    const dir = wind >= 0 ? -1 : 1;
    if (h.t > h.dur || Math.abs(wind) < 0.15) {
      // Peeling off downwind.
      h.leaving += dt;
      h.x -= dir * (30 + h.leaving * 40) * dt;
      h.y += 6 * dt;
    }
    const x = h.x + Math.sin(h.t * 0.7) * 1.5 + Math.sin(h.t * 2.3) * 0.5;
    const y = h.y + Math.sin(h.t * 0.9 + 1) * 1.2;
    const pose: GullPose = h.leaving > 0 ? 'glide' : h.frame ? 'hover-1' : 'hover-0';
    h.sprite.texture = this.gull(pose, 16);
    h.sprite.scale.x = h.leaving > 0 ? -dir : dir;
    h.sprite.position.set(Math.round(x), Math.round(y));
    h.sprite.tint = env.lighting.ambient;
    if (!inView(this.viewport, h.x, -40)) {
      h.sprite.destroy();
      this.hover = null;
    }
  }

  private updateSquabble(dt: number, env: Environment, day: boolean): void {
    if (!this.squabble) {
      this.squabbleTimer -= dt;
      if (this.squabbleTimer <= 0) {
        this.squabbleTimer = r(180, 480);
        if (day) this.startSquabble();
      }
      return;
    }
    const q = this.squabble;
    q.t += dt;
    const p = shorePoint(q.depth, q.s);
    const size = Math.max(8, Math.round(GULL_SIZE * p.scale));
    const gap = size * 1.05;
    let poseA: GullPose;
    let poseB: GullPose;
    let shove = 0;
    if (q.winner === null) {
      // The tug: each braces and heaves in turn, the scrap jerking between them.
      const beat = Math.floor(q.t * 3.2);
      poseA = beat % 2 ? 'tug-0' : 'tug-1';
      poseB = beat % 2 ? 'tug-1' : 'tug-0';
      shove = beat % 2 ? 1 : -1;
      if (Math.floor(q.t * 0.7) % 4 === 3) poseB = 'call';
      if (Math.random() < dt * 0.5) this.sound('gull-cry', this.viewport.worldXToStereo(p.x), 0.55);
      if (q.t > q.dur) {
        q.winner = Math.random() < 0.5 ? 0 : 1;
        q.t = 0;
      }
    } else {
      // One has it and is off; the other calls after it.
      q.away += dt;
      // The loser stands its ground, and in a stiff wind hunkers down, feathers ruffled.
      const left = Math.abs(this.wind) > 0.6 && Math.floor(q.away * 1.5) % 2 === 1 ? 'stretch' : 'stand';
      poseA = q.winner === 0 ? GULL_FLAP[Math.floor(q.away * 9) % 4] : q.away < 1.5 ? 'call' : left;
      poseB = q.winner === 1 ? GULL_FLAP[Math.floor(q.away * 9) % 4] : q.away < 1.5 ? 'call' : left;
      if (q.away > 5) {
        q.a.destroy();
        q.b.destroy();
        q.scrap.destroy();
        this.squabble = null;
        return;
      }
    }
    const lift = q.winner === null ? 0 : q.away * 30;
    const place = (sprite: Sprite, pose: GullPose, side: -1 | 1, flying: boolean) => {
      sprite.texture = this.gull(pose, size);
      // A faces right (towards B); B faces left.
      sprite.scale.x = side < 0 ? 1 : -1;
      const x = p.x + side * (gap / 2) + (q.winner === null ? side * shove * 0.5 : 0) + (flying ? -side * q.away * 25 : 0);
      sprite.position.set(Math.round(x), Math.round(p.y - (flying ? lift * p.scale : 0)));
      sprite.zIndex = p.y;
      sprite.tint = env.lighting.ambient;
    };
    place(q.a, poseA, -1, q.winner === 0);
    place(q.b, poseB, 1, q.winner === 1);
    // The scrap: in the middle while they fight, then in the winner's bill.
    const g = q.scrap;
    g.clear();
    const holder = q.winner === null ? null : q.winner === 0 ? q.a : q.b;
    const sx = holder ? holder.x + holder.scale.x * size * 0.65 : p.x + shove * 0.5;
    const sy = holder ? holder.y - size * 0.55 : p.y - size * 0.42;
    const c = multiplyColor(0xc86a3a, env.lighting.ambient);
    g.rect(Math.round(sx) - 1, Math.round(sy), Math.max(2, Math.round(size / 8)), 1).fill({ color: c });
    g.zIndex = p.y + 0.1;
    if (q.winner === null) this.tracks?.walk(q.a, 'bird', q.depth + shove * 0.003, q.s - 2);
  }

  private startSquabble(): void {
    let depth = r(1.4, 2.6);
    for (let i = 0; i < 10 && !inView(this.viewport, shorePoint(depth, -60).x, 40); i++) depth = r(1.4, 2.8);
    const s = -this.scene.wetAt(depth) - r(8, 40);
    const a = new Sprite({ anchor: { x: 0.5, y: 1 } });
    const b = new Sprite({ anchor: { x: 0.5, y: 1 } });
    const scrap = new Graphics();
    this.scene.shoreLayer.addChild(a, b, scrap);
    this.squabble = { depth, s, t: 0, dur: r(7, 15), a, b, scrap, winner: null, away: 0 };
  }
}

// --- A frigatebird, very high ---------------------------------------------------

/** Now and then, very high over the sea, a frigatebird drifting across on still, crooked wings, circling. */
export class Frigatebird {
  private readonly sprite = new Sprite({ anchor: 0.5 });
  private readonly sprites = new DrawnCache();
  private flight: { x: number; y: number; t: number; dir: 1 | -1 } | null = null;
  private timer = r(120, 400);

  constructor(
    scene: BeachScene,
    private readonly viewport: Viewport,
  ) {
    this.sprite.visible = false;
    scene.birdsFar.addChild(this.sprite);
  }

  get present(): boolean {
    return this.flight !== null;
  }

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (!this.flight) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(500, 1400);
        if (daylight(env) && env.weather.cloudCover < 0.6) {
          const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
          this.flight = { x: this.viewport.panX + (dir > 0 ? -20 : this.viewport.layout.visibleWorldWidth + 20), y: r(30, 80), t: 0, dir };
          this.sprite.visible = true;
        }
      }
      return;
    }
    const f = this.flight;
    f.t += dt;
    // Drifting downwind in long, slow circles.
    f.x += f.dir * 5 * dt;
    const x = f.x + Math.cos(f.t * 0.16) * 34;
    const y = f.y + Math.sin(f.t * 0.16) * 9;
    const frame = Math.floor(f.t / 2.6) % 2;
    this.sprite.texture = this.sprites.get(`${frame}`, () => drawFrigatebird(frame, 15));
    this.sprite.position.set(Math.round(x), Math.round(y));
    this.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.skyTop, 0.35);
    if (!inView(this.viewport, f.x, -80)) {
      this.flight = null;
      this.sprite.visible = false;
    }
  }
}

// --- Fish leaping ------------------------------------------------------------------

interface Leap {
  x: number;
  y: number;
  size: number;
  t: number;
  sprite: Sprite;
  rings: number;
}

/** Now and then out on the water, a fish leaps: a silver flick, a splash, a spreading ring. Mullet go two or three times in a row. */
export class JumpingFish {
  private readonly sprites = new DrawnCache();
  private readonly leaps: Leap[] = [];
  private readonly rings = new Graphics();
  private timer = r(10, 40);

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {
    scene.seaLife.addChild(this.rings);
  }

  get count(): number {
    return this.leaps.length;
  }

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = r(15, 50);
      if (env.lighting.darkness < 0.7) {
        let depth = r(1.3, 3.6);
        let s = r(BREAK_S + 30, 320);
        for (let i = 0; i < 10 && !inView(this.viewport, shorePoint(depth, s).x); i++) {
          depth = r(1.3, 3.6);
          s = r(BREAK_S + 30, 320);
        }
        const hops = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 2) : 1;
        for (let k = 0; k < hops; k++) this.leap(depth + k * 0.03, s - k * 8, -k * 0.7);
      }
    }
    const g = this.rings;
    g.clear();
    const ring = lerpColor(multiplyColor(0xd8ecf0, env.lighting.ambient), env.lighting.skyHorizon, 0.3);
    for (let i = this.leaps.length - 1; i >= 0; i--) {
      const l = this.leaps[i];
      l.t += dt;
      if (l.t < 0) continue;
      const frame = Math.floor(l.t / 0.11);
      if (frame < JUMP_FRAMES) {
        l.sprite.visible = true;
        const size = l.size;
        l.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawJumpFish(frame, size));
        l.sprite.position.set(Math.round(l.x), Math.round(l.y));
        l.sprite.tint = lerpColor(env.lighting.ambient, 0xffffff, 0.25);
      } else l.sprite.visible = false;
      // The ring spreading out from where it went back in.
      const age = l.t - 0.25;
      if (age > 0) {
        const rx = 1 + age * l.size * 0.9;
        g.ellipse(Math.round(l.x + l.size * 0.3), Math.round(l.y), rx, Math.max(0.6, rx * 0.3)).stroke({ color: ring, width: 1, alpha: Math.max(0, 0.7 - age * 0.45) });
      }
      if (l.t > 1.8) {
        l.sprite.destroy();
        this.leaps.splice(i, 1);
      }
    }
  }

  private leap(depth: number, s: number, delay: number): void {
    const p = shorePoint(depth, s);
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    sprite.visible = false;
    this.scene.seaLife.addChild(sprite);
    this.leaps.push({ x: p.x, y: p.y, size: Math.max(3, Math.round(9 * p.scale)), t: delay, sprite, rings: 0 });
  }
}
