import { Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { lerp } from '../../core/math';
import type { Viewport } from '../../core/Viewport';
import { birdActivity } from '../../audio/soundscapes/schedules';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { BEACH_HORIZON, fishColor } from '../../scene/beach/BeachScene';
import { BREAK_S, shorePoint, shoreXAtY } from '../../sim/shore';
import type { Environment } from '../../scene/Environment';
import { School } from '../../sim/boids';
import { BirdSpriteCache, FLAP_CYCLE, type BirdPose } from '../../sprites/birdSprites';
import { DolphinSprites, TurtleSprites } from '../../sprites/beachSprites';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);

// --- Sandpipers: chasing the waves up and down the wet sand ---------------

interface Piper {
  /** How far along the beach (ground-plane depth). */
  depth: number;
  /** Ground px across the shore from the still waterline (negative = up the sand). */
  s: number;
  /** How far up from the water's edge it likes to stay. */
  offset: number;
  sprite: Sprite;
  peck: number;
  /** Drift along the beach (depth per second). */
  drift: number;
}

/** A sandpiper's height right in front of the window (it shrinks with distance). */
const PIPER_SIZE = 12;

export class Sandpipers {
  private readonly pipers: Piper[] = [];
  private readonly sprites = new BirdSpriteCache();
  private presenceTimer = 10;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  /** Bring a little flock in now. */
  summon(): void {
    this.leave();
    this.arrive();
  }

  update(dt: number, env: Environment): void {
    const active = birdActivity(env.lighting.hours) > 0.2 && env.weather.lightning < 0.3 && !(env.weather.kind === 'rain' && env.weather.precipitation > 0.5);
    this.presenceTimer -= dt;
    if (this.presenceTimer <= 0) {
      this.presenceTimer = r(30, 90);
      if (active && this.pipers.length === 0) this.arrive();
      else if (!active || Math.random() < 0.15) this.leave();
    }
    if (!active && this.pipers.length > 0) this.leave();

    for (const p of this.pipers) {
      // Keep just up the sand from the water's edge, running as it rushes in and drains.
      const target = -(this.scene.reachAt(p.depth) + p.offset);
      const diff = target - p.s;
      const running = Math.abs(diff) > 3;
      p.s += Math.sign(diff) * Math.min(Math.abs(diff), 80 * dt);
      p.drift += (Math.random() - 0.5) * dt * 0.12;
      p.drift = Math.max(-0.08, Math.min(0.08, p.drift));
      p.depth = Math.max(1.35, Math.min(4, p.depth + p.drift * dt));
      const pt = shorePoint(p.depth, p.s);
      let pose: BirdPose;
      if (running) {
        pose = Math.floor(performance.now() / 70) % 2 === 0 ? 'idle' : 'hop';
        p.peck = 0;
      } else {
        p.peck += dt;
        pose = p.peck % 0.6 < 0.2 ? 'peck-down' : p.peck % 0.6 < 0.3 ? 'peck-reach' : 'idle';
      }
      p.sprite.texture = this.sprites.get('sandpiper', pose, Math.max(4, Math.round(PIPER_SIZE * pt.scale)));
      // Heading away along the beach means heading left on screen.
      p.sprite.scale.x = p.drift > 0 ? -1 : 1;
      p.sprite.position.set(Math.round(pt.x), Math.round(pt.y));
      p.sprite.zIndex = pt.y;
      p.sprite.tint = env.lighting.ambient;
    }
    if (this.pipers.length > 0 && Math.random() < dt * 0.15) {
      const p = this.pipers[Math.floor(Math.random() * this.pipers.length)];
      this.sound('sandpiper-peep', this.viewport.worldXToStereo(shorePoint(p.depth, p.s).x), 0.6);
    }
  }

  private arrive(): void {
    // Somewhere along the shore that's in view.
    const right = this.viewport.panX + this.viewport.layout.visibleWorldWidth - 20;
    let depth = r(1.5, 3.2);
    for (let i = 0; i < 10 && shorePoint(depth, 0).x > right; i++) depth = r(1.5, 3.4);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      this.scene.shoreLayer.addChild(sprite);
      const d = depth + r(-0.15, 0.15);
      this.pipers.push({ depth: d, s: -(this.scene.reachAt(d) + 6), offset: r(4, 14), sprite, peck: Math.random(), drift: r(-0.04, 0.04) });
    }
  }

  private leave(): void {
    for (const p of this.pipers) p.sprite.destroy();
    this.pipers.length = 0;
  }
}

// --- A gull hunting the school ---------------------------------------------

/** The school's patch of shallows: this far along the beach... */
const SCHOOL_DEPTH0 = 1.7;
const SCHOOL_DEPTHS = 1.6;
const SCHOOL_U = 400;
/** ...and this far out beyond the breakers (ground px). */
const SCHOOL_V = 60;

type HuntPhase = 'approach' | 'circle' | 'dive' | 'rise';

interface Hunter {
  x: number;
  y: number;
  phase: HuntPhase;
  t: number;
  from: { x: number; y: number };
  sprite: Sprite;
  flap: number;
  dir: 1 | -1;
}

export class FishAndGulls {
  readonly school: School;
  private hunter: Hunter | null = null;
  private huntTimer = r(25, 50);
  private readonly sprites = new BirdSpriteCache();

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    // The school swims in shore coordinates: u along the beach, v out from the breakers.
    this.school = new School(26, { x0: 0, x1: SCHOOL_U, y0: 0, y1: SCHOOL_V });
  }

  /** World position of a point in the school's (u, v) space. */
  private toWorld(u: number, v: number): { x: number; y: number; scale: number } {
    return shorePoint(SCHOOL_DEPTH0 + (u / SCHOOL_U) * SCHOOL_DEPTHS, BREAK_S + 6 + v);
  }

  /** Send a gull after the fish now. */
  summonHunter(): void {
    this.huntTimer = 0;
  }

  update(dt: number, env: Environment): void {
    this.school.update(dt);
    this.drawFish(env);

    this.huntTimer -= dt;
    const daylight = env.lighting.darkness < 0.5 && env.weather.lightning < 0.3;
    if (!this.hunter && this.huntTimer <= 0) {
      this.huntTimer = r(30, 75);
      if (daylight) this.startHunt();
    }
    if (this.hunter) this.stepHunter(this.hunter, dt, env);
  }

  private drawFish(env: Environment): void {
    const g = this.scene.fishLayer;
    g.clear();
    const alpha = 0.6 * (1 - env.lighting.darkness * 0.85);
    if (alpha < 0.05) return;
    const color = fishColor(env.lighting.ambient);
    for (const f of this.school.fish) {
      const p = this.toWorld(f.x, f.y);
      g.rect(Math.round(p.x), Math.round(p.y), p.scale > 0.45 ? 2 : 1, 1).fill({ color, alpha });
    }
  }

  private startHunt(): void {
    const fromLeft = Math.random() < 0.5;
    const sprite = new Sprite({ anchor: 0.5 });
    this.scene.birdsMid.addChild(sprite);
    const x = this.viewport.panX + (fromLeft ? -30 : this.viewport.layout.visibleWorldWidth + 30);
    const y = r(110, 160);
    this.hunter = { x, y, phase: 'approach', t: 0, from: { x, y }, sprite, flap: 0, dir: fromLeft ? 1 : -1 };
  }

  private stepHunter(h: Hunter, dt: number, env: Environment): void {
    h.t += dt;
    const centre = this.school.centre;
    const target = this.toWorld(centre.x, centre.y);
    let pose: BirdPose = 'glide';
    switch (h.phase) {
      case 'approach': {
        const p = Math.min(1, h.t / 4);
        h.x = lerp(h.from.x, target.x - h.dir * 30, p);
        h.y = lerp(h.from.y, 130, p);
        h.flap += dt * 6;
        pose = Math.sin(h.t * 1.5) > 0.2 ? FLAP_CYCLE[Math.floor(h.flap * 4) % 4] : 'glide';
        if (p >= 1) {
          h.phase = 'circle';
          h.t = 0;
          this.sound('gull-cry', this.viewport.worldXToStereo(h.x), 0.6);
        }
        break;
      }
      case 'circle':
        h.x += h.dir * 22 * dt;
        h.y = 130 + Math.sin(h.t * 2) * 6;
        if (h.t > 2.4) {
          h.phase = 'dive';
          h.t = 0;
          h.from = { x: h.x, y: h.y };
        }
        break;
      case 'dive': {
        const p = Math.min(1, h.t / 0.7);
        h.x = lerp(h.from.x, target.x, p);
        h.y = lerp(h.from.y, target.y, p * p);
        pose = 'fly-down';
        if (p >= 1) {
          this.scene.splash(h.x, target.y, 1.4);
          this.school.scare(centre.x, centre.y);
          this.sound('splash', this.viewport.worldXToStereo(h.x), 0.65);
          h.phase = 'rise';
          h.t = 0;
          h.from = { x: h.x, y: h.y };
        }
        break;
      }
      case 'rise': {
        h.flap += dt * 7;
        pose = FLAP_CYCLE[Math.floor(h.flap * 4) % 4];
        h.x += h.dir * 45 * dt;
        h.y -= 40 * dt;
        if (h.y < -20) {
          h.sprite.destroy();
          this.hunter = null;
          return;
        }
        break;
      }
    }
    h.sprite.texture = this.sprites.get('seagull', pose, 12);
    h.sprite.scale.x = h.dir;
    h.sprite.position.set(Math.round(h.x), Math.round(h.y));
    h.sprite.tint = env.lighting.ambient;
  }
}

// --- Turtles hauling out ---------------------------------------------------

type TurtlePhase = 'emerge' | 'crawl-up' | 'rest' | 'crawl-down' | 'submerge';

interface Turtle {
  depth: number;
  /** Ground px across the shore (positive = in the water). */
  s: number;
  /** How far up the sand it will nest/rest. */
  target: number;
  phase: TurtlePhase;
  t: number;
  sprite: Sprite;
}

/** A turtle's length right in front of the window (it shrinks with distance). */
const TURTLE_LENGTH = 30;
/** Crawling pace, ground px per second. */
const CRAWL = 5;

export class Turtles {
  private readonly sprites = new TurtleSprites();
  private turtle: Turtle | null = null;
  private timer = r(120, 240);

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {}

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (!this.turtle) {
      // Sea turtles mostly come ashore at night.
      this.timer -= dt * (env.lighting.darkness > 0.5 ? 2 : 1);
      if (this.timer <= 0) {
        this.timer = r(300, 600);
        const right = this.viewport.panX + this.viewport.layout.visibleWorldWidth - 30;
        let depth = r(1.5, 2.6);
        for (let i = 0; i < 10 && shorePoint(depth, 0).x > right; i++) depth = r(1.6, 3);
        const sprite = new Sprite({ anchor: { x: 0.5, y: 1 }, alpha: 0 });
        this.scene.shoreLayer.addChild(sprite);
        this.turtle = { depth, s: 10, target: -r(110, 170), phase: 'emerge', t: 0, sprite };
      }
      return;
    }
    const tt = this.turtle;
    tt.t += dt;
    switch (tt.phase) {
      case 'emerge':
        tt.sprite.alpha = Math.min(1, tt.t / 2);
        tt.s -= CRAWL * 0.5 * dt;
        if (tt.t > 2) [tt.phase, tt.t] = ['crawl-up', 0];
        break;
      case 'crawl-up':
        tt.s -= CRAWL * dt;
        if (tt.s <= tt.target) [tt.phase, tt.t] = ['rest', 0];
        break;
      case 'rest':
        if (tt.t > r(25, 50)) [tt.phase, tt.t] = ['crawl-down', 0];
        break;
      case 'crawl-down':
        tt.s += CRAWL * dt;
        if (tt.s >= -this.scene.reachAt(tt.depth)) [tt.phase, tt.t] = ['submerge', 0];
        break;
      case 'submerge':
        tt.sprite.alpha = Math.max(0, 1 - tt.t / 2);
        tt.s += CRAWL * 0.5 * dt;
        if (tt.t > 2) {
          tt.sprite.destroy();
          this.turtle = null;
          return;
        }
        break;
    }
    const moving = tt.phase === 'crawl-up' || tt.phase === 'crawl-down';
    const p = shorePoint(tt.depth, tt.s);
    tt.sprite.texture = this.sprites.frame(moving ? Math.floor(tt.t * 2.5) : 0, TURTLE_LENGTH * p.scale);
    // Up the sand is leftwards on screen; back to the sea is rightwards.
    tt.sprite.scale.x = tt.phase === 'crawl-down' || tt.phase === 'submerge' ? 1 : -1;
    tt.sprite.position.set(Math.round(p.x), Math.round(p.y));
    tt.sprite.zIndex = p.y;
    tt.sprite.tint = env.lighting.ambient;
  }
}

// --- Dolphins breaching near the horizon ---------------------------------

interface Breach {
  x: number;
  delay: number;
  t: number;
  sprite: Sprite;
}

const BREACH_FRAME = 0.22;

export class Dolphins {
  private readonly sprites = new DolphinSprites();
  private readonly pod: Breach[] = [];
  private timer = r(30, 90);
  private surfacings = 0;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {}

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (this.pod.length === 0) {
      this.timer -= dt;
      if (this.timer <= 0 && env.lighting.darkness < 0.6) {
        this.timer = r(60, 180);
        this.surfacings = 2 + Math.floor(Math.random() * 3);
        // Out at sea: right of where the shore meets the horizon, and in view.
        const seaStart = shoreXAtY(BEACH_HORIZON + 4) + 20;
        const left = Math.max(seaStart, this.viewport.panX + 10);
        const right = this.viewport.panX + this.viewport.layout.visibleWorldWidth - 40;
        this.spawnPod(right > left ? r(left, right) : seaStart);
      }
      return;
    }
    let done = true;
    const tint = lerpColor(env.lighting.ambient, env.lighting.skyHorizon, 0.3);
    for (const b of this.pod) {
      b.t += dt;
      const frame = Math.floor((b.t - b.delay) / BREACH_FRAME);
      if (frame < 0 || frame > 3) {
        b.sprite.visible = false;
        if (frame < 0) done = false;
        continue;
      }
      done = false;
      b.sprite.visible = true;
      b.sprite.texture = this.sprites.frames[frame];
      b.sprite.position.set(Math.round(b.x + frame * 2), BEACH_HORIZON + 5);
      b.sprite.tint = frame === 3 ? lerpColor(tint, 0xffffff, 0.5) : tint;
    }
    if (done) {
      const nextX = this.pod[0].x + 26;
      for (const b of this.pod) b.sprite.destroy();
      this.pod.length = 0;
      if (--this.surfacings > 0) this.spawnPod(nextX, 0.8);
    }
  }

  private spawnPod(x: number, pause = 0): void {
    const size = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < size; i++) {
      const sprite = new Sprite({ anchor: { x: 0, y: 1 } });
      sprite.visible = false;
      this.scene.horizonLayer.addChild(sprite);
      this.pod.push({ x: x + i * 11, delay: pause + i * 0.35, t: 0, sprite });
    }
  }
}
