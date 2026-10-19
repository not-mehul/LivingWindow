import { Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { lerp } from '../../core/math';
import type { Viewport } from '../../core/Viewport';
import { birdActivity } from '../../audio/soundscapes/schedules';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { BEACH_HORIZON, fishColor } from '../../scene/beach/BeachScene';
import { beachPlane, BREAK_S, SHALLOWS_S, shorePoint, shoreXAtY } from '../../sim/shore';
import type { Environment } from '../../scene/Environment';
import { School } from '../../sim/boids';
import { DOLPHIN_FRAMES, DOLPHIN_LENGTH, drawDolphinSized, TurtleSprites } from '../../sprites/beachSprites';
import type { LifeSoundSink } from '../types';
import { DrawnCache } from '../../sprites/wildSprites';
import { drawGull, drawSandpiper, SANDPIPER_FLY, SANDPIPER_RUN, type GullPose, type SandpiperPose } from '../../sprites/shoreSprites';
import type { Tracks } from './Tracks';

const r = (min: number, max: number) => min + Math.random() * (max - min);
/** A gull's wingbeat. */
const GULL_FLAP: readonly GullPose[] = ['flap-up', 'glide', 'flap-down', 'glide'];

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
  /** Its run cycle, and its place in the flock when they fly. */
  stride: number;
  slot: number;
}

/** A sandpiper's height right in front of the window (it shrinks with distance). */
const PIPER_SIZE = 18;

/**
 * A little flock of sanderlings working the edge of the waves: racing down
 * after the backwash on blurring legs, stopping dead to peck and probe, and
 * scurrying back up ahead of the next wave. When a big one comes in (or
 * something startles them) they all go up together, wheel low over the
 * water flashing their wing-bars, and come down again further along.
 */
export class Sandpipers {
  /** Where they leave their footprints. */
  tracks: Tracks | null = null;
  private readonly pipers: Piper[] = [];
  private readonly sprites = new DrawnCache();
  private presenceTimer = 10;
  /** The flock in the air: how long it's been up, for how long, which way along the beach, and how high. */
  private flight: { t: number; dur: number; dir: number; height: number } | null = null;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    scene.on('break', ({ amplitude }) => {
      if (amplitude > 26 && Math.random() < 0.45) this.flush();
    });
  }

  get count(): number {
    return this.pipers.length;
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** The middle of the flock on the shore (null if none, or they're up). */
  get centre(): { depth: number; s: number } | null {
    if (this.flight || this.pipers.length === 0) return null;
    const n = this.pipers.length;
    return { depth: this.pipers.reduce((a, p) => a + p.depth, 0) / n, s: this.pipers.reduce((a, p) => a + p.s, 0) / n };
  }

  /** Bring a little flock in now. */
  summon(): void {
    this.leave();
    this.arrive();
  }

  /** Up they go, all together. */
  flush(): void {
    if (this.flight || this.pipers.length === 0) return;
    const mean = this.pipers.reduce((a, p) => a + p.depth, 0) / this.pipers.length;
    // Along the beach, away from whichever end they're nearer.
    this.flight = { t: 0, dur: r(2.6, 4.2), dir: mean > 2.4 ? -1 : 1, height: r(10, 22) };
    const p = this.pipers[0];
    this.sound('sandpiper-peep', this.viewport.worldXToStereo(shorePoint(p.depth, p.s).x), 0.7);
  }

  update(dt: number, env: Environment): void {
    const active = birdActivity(env.lighting.hours) > 0.2 && env.weather.lightning < 0.3 && !(env.weather.kind === 'rain' && env.weather.precipitation > 0.5);
    this.presenceTimer -= dt;
    if (this.presenceTimer <= 0) {
      this.presenceTimer = r(30, 90);
      if (active && this.pipers.length === 0) this.arrive();
      else if (!active || Math.random() < 0.15) this.leave();
      else if (Math.random() < 0.3) this.flush();
    }
    if (!active && this.pipers.length > 0) this.leave();

    const f = this.flight;
    if (f) {
      f.t += dt;
      if (f.t >= f.dur) this.flight = null;
    }
    for (const p of this.pipers) {
      let pose: SandpiperPose;
      let lift = 0;
      if (f) {
        // In the air: low over the edge of the water, the flock banking as one.
        const u = f.t / f.dur;
        p.depth = Math.max(1.3, Math.min(4.2, p.depth + f.dir * (0.35 + 0.1 * Math.sin(p.slot)) * dt));
        p.s += (-(this.scene.reachAt(p.depth) + p.offset) + 30 * Math.sin(u * Math.PI) - p.s) * Math.min(1, dt * 2);
        lift = Math.sin(u * Math.PI) * (f.height + p.slot * 1.5);
        p.stride += dt * 15;
        pose = SANDPIPER_FLY[Math.floor(p.stride + p.slot) % 4];
      } else {
        // Keep just up the sand from the water's edge, running as it rushes in and drains.
        const target = -(this.scene.reachAt(p.depth) + p.offset);
        const diff = target - p.s;
        const running = Math.abs(diff) > 3;
        p.s += Math.sign(diff) * Math.min(Math.abs(diff), 80 * dt);
        p.drift += (Math.random() - 0.5) * dt * 0.12;
        p.drift = Math.max(-0.08, Math.min(0.08, p.drift));
        p.depth = Math.max(1.35, Math.min(4, p.depth + p.drift * dt));
        if (running) {
          p.stride += dt * 16;
          pose = SANDPIPER_RUN[Math.floor(p.stride) % 4];
          p.peck = 0;
        } else {
          p.peck += dt;
          const beat = p.peck % 1.4;
          pose = beat < 0.25 ? 'peck' : beat < 0.55 && p.slot % 2 ? 'probe' : 'stand';
        }
        this.tracks?.walk(p, 'bird', p.depth, p.s);
      }
      const pt = shorePoint(p.depth, p.s);
      const size = Math.max(5, Math.round(PIPER_SIZE * pt.scale));
      p.sprite.texture = this.sprites.get(`${pose}:${size}`, () => drawSandpiper(pose, size));
      // Heading away along the beach means heading left on screen.
      const away = f ? f.dir > 0 : p.drift > 0;
      p.sprite.scale.x = away ? -1 : 1;
      p.sprite.position.set(Math.round(pt.x), Math.round(pt.y - lift * pt.scale));
      p.sprite.zIndex = pt.y;
      p.sprite.tint = env.lighting.ambient;
    }
    if (this.pipers.length > 0 && Math.random() < dt * (f ? 1.2 : 0.15)) {
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
      this.pipers.push({ depth: d, s: -(this.scene.reachAt(d) + 6), offset: r(4, 14), sprite, peck: Math.random(), drift: r(-0.04, 0.04), stride: Math.random() * 4, slot: i });
    }
  }

  private leave(): void {
    for (const p of this.pipers) p.sprite.destroy();
    this.pipers.length = 0;
    this.flight = null;
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
  private readonly gulls = new DrawnCache();

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

  /** Where the school is now (world px), for anything hunting it. */
  get schoolPoint(): { x: number; y: number; scale: number } {
    const c = this.school.centre;
    return this.toWorld(c.x, c.y);
  }

  /** Scatter the school (something plunged in among them). */
  scatterSchool(): void {
    const c = this.school.centre;
    this.school.scare(c.x, c.y);
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
    const flank = lerpColor(color, 0xb8d0d8, 0.45);
    const flash = lerpColor(color, 0xffffff, 0.75);
    const time = performance.now() / 1000;
    this.school.fish.forEach((f, i) => {
      const p = this.toWorld(f.x, f.y);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // A little fish shape: dark back, paler flank, a tail flicking behind (it faces the way it swims).
      const dir = f.vx >= 0 ? 1 : -1;
      const big = p.scale > 0.45;
      const len = big ? 3 : 2;
      for (let k = 0; k < len; k++) g.rect(x + dir * k, y, 1, 1).fill({ color, alpha });
      if (big) g.rect(x + dir, y + 1, 1, 1).fill({ color: flank, alpha: alpha * 0.8 });
      g.rect(x - dir, y + (Math.floor(time * 6 + i) % 2), 1, 1).fill({ color, alpha: alpha * 0.7 });
      // As a fish turns, its side catches the light for a moment.
      if (Math.abs(f.vy) > Math.abs(f.vx) * 0.8 || Math.sin(time * 1.7 + i * 2.3) > 0.985) g.rect(x + dir, y, 1, 1).fill({ color: flash, alpha: Math.min(1, alpha * 1.4) });
    });
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
    let pose: GullPose = 'glide';
    let tilt = 0;
    switch (h.phase) {
      case 'approach': {
        const p = Math.min(1, h.t / 4);
        h.x = lerp(h.from.x, target.x - h.dir * 30, p);
        h.y = lerp(h.from.y, 130, p);
        h.flap += dt * 6;
        pose = Math.sin(h.t * 1.5) > 0.2 ? GULL_FLAP[Math.floor(h.flap * 4) % 4] : 'glide';
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
        pose = 'glide';
        // Head down, wings half shut, falling on the fish.
        tilt = Math.atan2(target.y - h.from.y, Math.abs(target.x - h.from.x) + 1) * 0.8;
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
        pose = GULL_FLAP[Math.floor(h.flap * 4) % 4];
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
    // Sized by how far out the fish are.
    const size = Math.max(9, Math.round(30 * target.scale));
    h.sprite.texture = this.gulls.get(`${pose}:${size}`, () => drawGull(pose, size));
    h.sprite.scale.x = h.dir;
    h.sprite.rotation = tilt * h.dir;
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
const TURTLE_LENGTH = 36;
/** Crawling pace, ground px per second. */
const CRAWL = 5;

export class Turtles {
  tracks: Tracks | null = null;
  private readonly sprites = new TurtleSprites();
  private turtle: Turtle | null = null;
  private timer = r(120, 240);

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {}

  /** Where the turtle is on the shore, and whether it's resting up the beach. */
  get spot(): { depth: number; s: number; resting: boolean } | null {
    const t = this.turtle;
    return t ? { depth: t.depth, s: t.s, resting: t.phase === 'rest' } : null;
  }

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
    if (moving) this.tracks?.walk(tt, 'turtle', tt.depth, tt.s);
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

const BREACH_FRAME = 0.17;

/**
 * A pod of dolphins passing out beyond the breakers: they break the
 * surface in turn, arcing out and back in with a burst of spray, a soft
 * puff as they blow; now and then one slaps its tail down. Nearer pods are
 * bigger, further ones small on the horizon.
 */
export class Dolphins {
  private readonly sprites = new DrawnCache();
  private readonly pod: Array<Breach & { y: number; size: number; splashed: number }> = [];
  private timer = r(30, 90);
  private surfacings = 0;
  private podY = BEACH_HORIZON + 5;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
    private readonly sound?: LifeSoundSink,
  ) {}

  summon(): void {
    this.timer = 0;
  }

  /** Called with where a pod first breaks the surface (world px), for the fish and the gulls to notice. */
  onSurface: ((x: number, y: number) => void) | null = null;

  update(dt: number, env: Environment): void {
    if (this.pod.length === 0) {
      this.timer -= dt;
      if (this.timer <= 0 && env.lighting.darkness < 0.6) {
        this.timer = r(60, 180);
        this.surfacings = 2 + Math.floor(Math.random() * 3);
        // Out at sea, somewhere between the horizon and just beyond the breakers.
        this.podY = BEACH_HORIZON + 4 + Math.round(Math.random() ** 1.6 * 26);
        const seaStart = shoreXAtY(this.podY) + (SHALLOWS_S + 40) / beachPlane.depthAtY(this.podY);
        const left = Math.max(seaStart, this.viewport.panX + 10);
        const right = this.viewport.panX + this.viewport.layout.visibleWorldWidth - 40;
        if (right > left) {
          const x = r(left, right);
          this.spawnPod(x);
          this.onSurface?.(x, this.podY);
        }
      }
      return;
    }
    let done = true;
    const tint = lerpColor(env.lighting.ambient, env.lighting.skyHorizon, 0.3 * (1 - (this.podY - BEACH_HORIZON) / 40));
    for (const b of this.pod) {
      b.t += dt;
      const frame = Math.floor((b.t - b.delay) / BREACH_FRAME);
      if (frame < 0 || frame >= DOLPHIN_FRAMES) {
        b.sprite.visible = false;
        if (frame < 0) done = false;
        continue;
      }
      done = false;
      b.sprite.visible = true;
      const size = b.size;
      b.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawDolphinSized(frame, size));
      const step = (size / DOLPHIN_LENGTH) * 2;
      b.sprite.position.set(Math.round(b.x + frame * step), b.y);
      b.sprite.tint = tint;
      // Spray where it breaks the surface, and where it goes back in; a puff as it blows.
      if (frame === 1 && b.splashed === 0) {
        b.splashed = 1;
        this.scene.splash(b.x + step + size * 0.3, b.y, size / 40);
        if (this.sound && size > 18) this.sound('dolphin-blow', this.viewport.worldXToStereo(b.x), 0.25 + (size / 40) * 0.4);
      } else if (frame === 5 && b.splashed === 1) {
        b.splashed = 2;
        this.scene.splash(b.x + 5 * step + size * 0.6, b.y, size / 30);
      }
    }
    if (done) {
      const last = this.pod[0];
      const nextX = last.x + last.size * 2.2;
      for (const b of this.pod) b.sprite.destroy();
      this.pod.length = 0;
      // Now and then, a tail slapped down on the water: a smack and a fountain.
      if (Math.random() < 0.3) {
        this.scene.splash(nextX - last.size, last.y, (last.size / 24) * 1.6);
        this.sound?.('splash', this.viewport.worldXToStereo(nextX), 0.25 * (last.size / 30));
      }
      if (--this.surfacings > 0) this.spawnPod(nextX, 0.8);
    }
  }

  private spawnPod(x: number, pause = 0): void {
    const n = 2 + Math.floor(Math.random() * 2);
    // Nearer pods are bigger (and a little apart, one behind another).
    const size = Math.round(12 + (this.podY - BEACH_HORIZON - 4) * 1.1);
    for (let i = 0; i < n; i++) {
      const sprite = new Sprite({ anchor: { x: 0, y: 1 } });
      sprite.visible = false;
      this.scene.horizonLayer.addChild(sprite);
      this.pod.push({ x: x + i * size * 0.95, y: this.podY + (i % 2), size: size + (i % 2), delay: pause + i * 0.35, t: 0, sprite, splashed: 0 });
    }
  }
}
