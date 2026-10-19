import { Graphics, Sprite } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { lerp } from '../../core/math';
import type { Viewport } from '../../core/Viewport';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { glowTexture } from '../../scene/common/glow';
import type { Environment } from '../../scene/Environment';
import { NightKey } from '../../sim/nights';
import { BREAK_S, SHALLOWS_S, shorePoint } from '../../sim/shore';
import { bioluminescenceLevel, bioluminescenceNight, crabActivity, hatchlingNight, hatchlingTime, hermitActivity, pelicanActivity } from '../../sim/wildlife';
import { drawCrab, drawHatchling, drawHermitCrab, drawJellyfish, drawPelican, type PelicanPose } from '../../sprites/beachSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';
import type { FishAndGulls } from './Shoreline';
import type { Tracks } from './Tracks';
import { rand as r } from '../../core/random';
import { evenSize } from '../../sprites/kit';

/** Depths along the beach that are comfortably in view. */
const NEAR = 1.3;
const FAR = 3.2;

// --- Ghost crabs on the wet sand ----------------------------------------------

interface Crab {
  depth: number;
  /** Ground px across the shore (negative = up the sand). */
  s: number;
  /** How far above the water's edge it likes to be. */
  offset: number;
  dir: 1 | -1;
  run: number;
  pause: number;
  hidden: number;
  frame: number;
  sprite: Sprite;
}

/** A crab's width right in front of the window. */
const CRAB_SIZE = 20;

/**
 * Ghost crabs on the wet sand at the water's edge: scuttling sideways along
 * the beach in quick bursts, and ducking into their burrows when a wave
 * comes up the sand or a tap comes near.
 */
export class Crabs {
  tracks: Tracks | null = null;
  private readonly crabs: Crab[] = [];
  private readonly sprites = new DrawnCache();
  private timer = 2;

  constructor(private readonly scene: BeachScene) {}

  get count(): number {
    return this.crabs.length;
  }

  summon(n = 3): void {
    for (let i = 0; i < n; i++) this.spawn();
  }

  /** Send the crabs near a world point down their holes. */
  scare(x: number, y: number): boolean {
    let hit = false;
    for (const c of this.crabs) {
      const p = shorePoint(c.depth, c.s);
      if (Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 25) {
        c.hidden = r(3, 7);
        hit = true;
      }
    }
    return hit;
  }

  update(dt: number, env: Environment): void {
    // Ghost crabs come out in force after dark.
    const night = env.lighting.darkness > 0.55;
    const target = Math.round(crabActivity(env.lighting.hours) * (night ? 10 : 5) * (env.weather.kind === 'rain' ? 0.5 : 1));
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = r(4, 12);
      if (this.crabs.length < target) this.spawn();
      else if (this.crabs.length > target) this.crabs.pop()?.sprite.destroy();
    }
    for (const c of this.crabs) {
      const reach = this.scene.reachAt(c.depth);
      // A wave rushing up to it: down the burrow.
      if (c.hidden <= 0 && -c.s - reach < 4) c.hidden = r(2, 4);
      if (c.hidden > 0) c.hidden -= dt;
      else if (c.pause > 0) c.pause -= dt;
      else {
        // A dash sideways along the beach, then stock-still again.
        c.run -= dt;
        c.depth += c.dir * (night ? 0.2 : 0.12) * dt;
        c.frame += dt * (night ? 20 : 14);
        if (c.run <= 0 || c.depth < NEAR || c.depth > FAR) {
          if (c.depth < NEAR || c.depth > FAR) c.dir = c.depth < NEAR ? 1 : -1;
          else if (Math.random() < 0.4) c.dir = c.dir > 0 ? -1 : 1;
          c.pause = r(1, 5);
          c.run = r(0.4, 1.4);
        }
        // Keep to the wet sand just above the water's edge.
        const want = -(this.scene.wetAt(c.depth) * 0.5 + c.offset);
        c.s += Math.sign(want - c.s) * Math.min(Math.abs(want - c.s), 30 * dt);
      }
      const p = shorePoint(c.depth, c.s);
      if (c.hidden <= 0) this.tracks?.walk(c, 'crab', c.depth, c.s);
      const size = evenSize(CRAB_SIZE * p.scale, 4);
      const hidden = c.hidden > 0;
      const frame = Math.floor(c.frame) % 4;
      c.sprite.texture = this.sprites.get(`${hidden}:${frame}:${size}`, () => drawCrab(frame, size, hidden));
      c.sprite.position.set(Math.round(p.x), Math.round(p.y));
      c.sprite.zIndex = p.y;
      // Pale as the sand: they catch the moonlight.
      c.sprite.tint = lerpColor(env.lighting.ambient, 0xffffff, env.lighting.nightness * 0.35 * env.lighting.moonlight);
    }
  }

  private spawn(): void {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.scene.shoreLayer.addChild(sprite);
    const depth = r(NEAR + 0.1, FAR - 0.3);
    const offset = r(6, 30);
    this.crabs.push({ depth, s: -(this.scene.wetAt(depth) * 0.5 + offset), offset, dir: Math.random() < 0.5 ? 1 : -1, run: r(0.4, 1.2), pause: r(0.5, 3), hidden: r(1, 3), frame: 0, sprite });
  }
}

// --- Hermit crabs on the dry sand --------------------------------------------------

interface Hermit {
  depth: number;
  s: number;
  heading: number;
  withdrawn: number;
  frame: number;
  sprite: Sprite;
}

const HERMIT_SIZE = 17;

/** Hermit crabs trundling about the dry sand in their borrowed shells, and pulling in at a tap. */
export class HermitCrabs {
  tracks: Tracks | null = null;
  private readonly hermits: Hermit[] = [];
  private readonly sprites = new DrawnCache();
  private timer = 3;

  constructor(private readonly scene: BeachScene) {}

  get count(): number {
    return this.hermits.length;
  }

  summon(n = 2): void {
    for (let i = 0; i < n; i++) this.spawn();
  }

  /** A thump nearby (a coconut falling): hermits within `radius` pull into their shells. */
  scare(x: number, y: number, radius: number): void {
    for (const h of this.hermits) {
      const p = shorePoint(h.depth, h.s);
      if (Math.hypot(p.x - x, (p.y - y) * 2) < radius) h.withdrawn = Math.max(h.withdrawn, r(4, 8));
    }
  }

  tap(x: number, y: number): boolean {
    for (const h of this.hermits) {
      const p = shorePoint(h.depth, h.s);
      if (Math.abs(p.x - x) < 12 && Math.abs(p.y - 4 - y) < 10) {
        h.withdrawn = r(4, 9);
        return true;
      }
    }
    return false;
  }

  update(dt: number, env: Environment): void {
    const target = Math.round(hermitActivity(env.lighting.hours, env.weather.cloudCover) * 3);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = r(8, 20);
      if (this.hermits.length < target) this.spawn();
      else if (this.hermits.length > target) this.hermits.pop()?.sprite.destroy();
    }
    for (const h of this.hermits) {
      if (h.withdrawn > 0) h.withdrawn -= dt;
      else {
        // A slow, meandering trundle over the dry sand.
        h.heading += (Math.random() - 0.5) * dt * 2;
        h.depth = Math.max(NEAR, Math.min(FAR, h.depth + Math.sin(h.heading) * 0.012 * dt));
        h.s = Math.max(-150, Math.min(-55, h.s + Math.cos(h.heading) * 3 * dt));
        h.frame += dt * 3;
      }
      const p = shorePoint(h.depth, h.s);
      this.tracks?.walk(h, 'hermit', h.depth, h.s);
      const size = evenSize(HERMIT_SIZE * p.scale, 4);
      const tucked = h.withdrawn > 0;
      const frame = Math.floor(h.frame) % 2;
      h.sprite.texture = this.sprites.get(`${tucked}:${frame}:${size}`, () => drawHermitCrab(frame, size, tucked));
      h.sprite.scale.x = Math.cos(h.heading) >= 0 ? 1 : -1;
      h.sprite.position.set(Math.round(p.x), Math.round(p.y));
      h.sprite.zIndex = p.y;
      h.sprite.tint = env.lighting.ambient;
    }
  }

  private spawn(): void {
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    this.scene.shoreLayer.addChild(sprite);
    this.hermits.push({ depth: r(NEAR + 0.1, FAR - 0.4), s: r(-140, -65), heading: Math.random() * Math.PI * 2, withdrawn: 0, frame: 0, sprite });
  }
}

// --- A pelican fishing --------------------------------------------------------------

type PelicanPhase = 'glide' | 'dive' | 'float' | 'leave';

/**
 * A brown pelican cruising low over the swell on slow, heavy wingbeats,
 * then folding up and plunging bill-first into the school, bobbing on the
 * water a while with its catch, and labouring off again.
 */
export class Pelican {
  private readonly sprite = new Sprite({ anchor: 0.5 });
  private readonly sprites = new DrawnCache();
  private phase: PelicanPhase | null = null;
  private x = 0;
  private y = 0;
  private dir: 1 | -1 = 1;
  private t = 0;
  private from = { x: 0, y: 0 };
  private timer = r(60, 160);

  constructor(
    private readonly scene: BeachScene,
    private readonly sea: FishAndGulls,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    this.sprite.visible = false;
    scene.birdsMid.addChild(this.sprite);
  }

  get present(): boolean {
    return this.phase !== null;
  }

  /** Where it sits on the water after a catch (world px), while it's there. */
  get floatingAt(): { x: number; y: number } | null {
    return this.phase === 'float' ? { x: this.x, y: this.y } : null;
  }

  /** A gull's come down beside it after its catch: it shakes its pouch at it again, and stays put a little longer. */
  bothered(): void {
    if (this.phase === 'float' && this.t > 2.2) this.t = 0.3;
  }

  summon(): void {
    this.timer = 0;
  }

  update(dt: number, env: Environment): void {
    if (!this.phase) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = r(120, 300);
        if (pelicanActivity(env.lighting.hours) > 0 && env.weather.lightning < 0.3) this.start();
      }
      return;
    }
    this.t += dt;
    const target = this.sea.schoolPoint;
    let pose: PelicanPose = 'glide';
    let size = 34;
    switch (this.phase) {
      case 'glide': {
        // Low over the water towards the fish: a few slow beats, then a long glide.
        this.x += this.dir * 32 * dt;
        this.y = lerp(this.from.y, target.y - 34, Math.min(1, this.t / 5)) + Math.sin(this.t * 1.3) * 2;
        const beat = this.t % 3.2;
        if (beat < 1.2) pose = (['flap-up', 'flap-mid', 'flap-down', 'flap-mid'] as const)[Math.floor(beat * 5) % 4];
        if ((this.dir > 0 ? this.x > target.x - 18 : this.x < target.x + 18) && this.t > 3) {
          this.phase = 'dive';
          this.t = 0;
          this.from = { x: this.x, y: this.y };
        }
        break;
      }
      case 'dive': {
        const p = Math.min(1, this.t / 0.55);
        this.x = lerp(this.from.x, target.x, p);
        this.y = lerp(this.from.y, target.y, p * p);
        pose = 'dive';
        if (p >= 1) {
          this.scene.splash(this.x, target.y, 2);
          this.sea.scatterSchool();
          this.sound('splash', this.viewport.worldXToStereo(this.x), 0.75);
          this.phase = 'float';
          this.t = 0;
        }
        break;
      }
      case 'float':
        // Bobbing on the swell: first shaking the water out of its pouch, then swallowing.
        pose = this.t < 2.2 ? (Math.floor(this.t * 5) % 2 ? 'pouch-0' : 'pouch-1') : 'float';
        size = Math.max(16, Math.round(46 * target.scale));
        this.y = target.y - 1 + Math.sin(this.t * 2.2) * 1;
        if (this.t > r(4, 7)) {
          this.phase = 'leave';
          this.t = 0;
          this.from = { x: this.x, y: this.y };
        }
        break;
      case 'leave':
        this.x += this.dir * 30 * dt;
        this.y -= 18 * dt;
        pose = (['flap-up', 'flap-mid', 'flap-down', 'flap-mid'] as const)[Math.floor(this.t * 5) % 4];
        if (this.y < -40 || this.x < this.viewport.panX - 80 || this.x > this.viewport.visibleRight + 80) {
          this.phase = null;
          this.sprite.visible = false;
          return;
        }
        break;
    }
    this.sprite.texture = this.sprites.get(`${pose}:${size}`, () => drawPelican(pose, size));
    this.sprite.scale.x = this.dir;
    this.sprite.position.set(Math.round(this.x), Math.round(this.y));
    this.sprite.tint = env.lighting.ambient;
  }

  private start(): void {
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.x = this.viewport.panX + (this.dir > 0 ? -40 : this.viewport.layout.visibleWorldWidth + 40);
    this.y = r(140, 175);
    this.from = { x: this.x, y: this.y };
    this.phase = 'glide';
    this.t = 0;
    this.sprite.visible = true;
  }
}

// --- Jellyfish in the shallows ------------------------------------------------------

interface Jelly {
  depth: number;
  s: number;
  phase: number;
  drift: number;
  sprite: Sprite;
  glow: Sprite;
}

/** Moon jellyfish drifting in the shallows, pulsing; faint by day, glowing softly in the dark. */
export class Jellyfish {
  private readonly jellies: Jelly[] = [];
  private readonly sprites = new DrawnCache();

  constructor(scene: BeachScene, count = 5) {
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite({ anchor: 0.5 });
      const glow = new Sprite({ texture: glowTexture(4, 0x8a7aff, 1, false), anchor: 0.5, blendMode: 'add' });
      scene.seaLife.addChild(glow, sprite);
      this.jellies.push({ depth: r(NEAR, FAR - 0.6), s: r(BREAK_S + 25, SHALLOWS_S - 10), phase: Math.random() * 6, drift: r(-0.02, 0.02), sprite, glow });
    }
  }

  update(dt: number, env: Environment): void {
    const dark = env.lighting.darkness;
    for (const j of this.jellies) {
      j.phase += dt * 1.3;
      j.depth += j.drift * dt;
      if (j.depth < NEAR || j.depth > FAR - 0.4) j.drift = -j.drift;
      j.s += Math.sin(j.phase * 0.3) * 1.5 * dt;
      const p = shorePoint(j.depth, j.s);
      const size = Math.max(3, Math.round(9 * p.scale));
      const frame = Math.floor(j.phase) % 3;
      j.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawJellyfish(frame, size));
      j.sprite.position.set(Math.round(p.x), Math.round(p.y));
      // Translucent under the water by day; a soft glow by night.
      j.sprite.alpha = 0.35 + 0.35 * dark;
      j.sprite.tint = lerpColor(env.lighting.ambient, 0xb0a8ff, dark * 0.6);
      j.glow.position.set(Math.round(p.x), Math.round(p.y));
      j.glow.alpha = Math.max(0, dark - 0.5) * (0.6 + 0.4 * Math.sin(j.phase * 2.1));
      j.glow.visible = j.glow.alpha > 0.02;
    }
  }
}

// --- Turtle hatchlings ------------------------------------------------------------

interface Hatchling {
  depth: number;
  s: number;
  wobble: number;
  delay: number;
  frame: number;
  speed: number;
  fade: number;
  sprite: Sprite;
}

/** The nest: up the sand at the foot of the dunes. */
const NEST = { depth: 1.65, s: -128 };

/**
 * On some nights a nest at the foot of the dunes hatches: the sand stirs,
 * and a stream of hatchlings digs out and scrambles down the moonlit beach
 * to the sea, vanishing one by one into the surf.
 */
export class Hatchlings {
  tracks: Tracks | null = null;
  private readonly young: Hatchling[] = [];
  private readonly sprites = new DrawnCache();
  private readonly nest = new Graphics();
  private readonly night = new NightKey();
  private hatchedKey = '';
  private forced = false;
  private stir = 0;

  constructor(private readonly scene: BeachScene) {
    scene.shoreLayer.addChild(this.nest);
  }

  get count(): number {
    return this.young.length;
  }

  summon(): void {
    this.forced = true;
  }

  update(dt: number, env: Environment): void {
    const key = this.night.update(env.lighting.hours);
    const due = this.forced || (hatchlingNight(key) && hatchlingTime(env.lighting.hours));
    if (due && this.hatchedKey !== key) {
      this.hatchedKey = key;
      this.forced = false;
      this.hatch();
    }
    const np = shorePoint(NEST.depth, NEST.s);
    this.nest.clear();
    if (this.stir > 0) {
      // The nest's hollow, with sand flicked up round it.
      this.stir -= dt;
      const tint = lerpColor(0x8a7458, env.lighting.ambient, 0.4);
      this.nest.ellipse(Math.round(np.x), Math.round(np.y), 5, 1.6).fill({ color: tint, alpha: Math.min(1, this.stir / 10) });
      for (let k = 0; k < 3; k++) if (Math.random() < 0.3) this.nest.rect(Math.round(np.x + r(-5, 5)), Math.round(np.y - r(1, 4)), 1, 1).fill({ color: 0xd8c8a0, alpha: 0.8 });
    }
    this.nest.zIndex = np.y - 0.5;
    for (let i = this.young.length - 1; i >= 0; i--) {
      const h = this.young[i];
      if (h.delay > 0) {
        h.delay -= dt;
        h.sprite.visible = false;
        continue;
      }
      h.sprite.visible = true;
      // Down the beach towards the water, weaving.
      const water = -this.scene.reachAt(h.depth);
      if (h.s < water) {
        h.s += h.speed * dt;
        h.wobble += dt * 3;
        h.depth += Math.sin(h.wobble) * 0.01 * dt;
        h.frame += dt * 8;
      } else {
        // Into the surf.
        h.fade -= dt;
        h.s += 4 * dt;
        if (h.fade <= 0) {
          h.sprite.destroy();
          this.young.splice(i, 1);
          continue;
        }
      }
      const p = shorePoint(h.depth, h.s);
      if (h.fade >= 1.2) this.tracks?.walk(h, 'hatchling', h.depth, h.s);
      const ahead = shorePoint(h.depth + Math.sin(h.wobble) * 0.01, h.s + 4);
      const size = Math.max(3, Math.round(7 * p.scale));
      const frame = Math.floor(h.frame) % 2;
      h.sprite.texture = this.sprites.get(`${frame}:${size}`, () => drawHatchling(frame, size));
      h.sprite.rotation = Math.atan2(ahead.y - p.y, ahead.x - p.x) + Math.PI / 2;
      h.sprite.position.set(Math.round(p.x), Math.round(p.y));
      h.sprite.zIndex = p.y;
      h.sprite.alpha = Math.min(1, h.fade);
      h.sprite.tint = env.lighting.ambient;
    }
  }

  private hatch(): void {
    this.stir = 60;
    const n = 10 + Math.floor(Math.random() * 11);
    for (let i = 0; i < n; i++) {
      const sprite = new Sprite({ anchor: 0.5 });
      this.scene.shoreLayer.addChild(sprite);
      this.young.push({ depth: NEST.depth + r(-0.02, 0.02), s: NEST.s + r(-2, 2), wobble: Math.random() * 6, delay: i * r(1.5, 3.5), frame: Math.random() * 2, speed: r(5, 8), fade: 1.2, sprite });
    }
  }
}

// --- The glowing sea ----------------------------------------------------------------

/** Decides, night by night, whether the surf glows blue, and how brightly. */
export class Bioluminescence {
  private readonly night = new NightKey();
  private forced = false;

  constructor(private readonly scene: BeachScene) {}

  /** Make tonight a glowing night (for demos and tests). */
  summon(): void {
    this.forced = true;
  }

  get level(): number {
    return this.scene.bioluminescence;
  }

  update(env: Environment): void {
    const key = this.night.update(env.lighting.hours);
    const tonight = this.forced || bioluminescenceNight(key);
    this.scene.bioluminescence = tonight ? bioluminescenceLevel(env.lighting.darkness, env.lighting.moonlight) : 0;
  }
}

