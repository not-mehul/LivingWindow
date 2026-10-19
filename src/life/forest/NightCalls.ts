import { Container, Sprite, type Texture } from 'pixi.js';
import { PixelBuffer } from '../../core/pixelBuffer';
import { lerpColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { Environment } from '../../scene/Environment';
import type { Trunk } from '../../scene/forest/forestGenerator';
import type { GroundPlane } from '../../sim/groundPlane';
import { GroundWalker, type Obstacle, type WalkArea } from '../../sim/groundWalker';
import { ravenActivity, stagRut, wolfActivity } from '../../sim/wildlife';
import { BirdSpriteCache, FLAP_CYCLE } from '../../sprites/birdSprites';
import { drawDeerSized, type DeerPose } from '../../sprites/forestSprites';
import { DrawnCache, drawWolf, WOLF_WALK, type WolfPose } from '../../sprites/wildSprites';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);
const WOLF_HEIGHT = 30;
const STAG_HEIGHT = 58;

interface Wolf {
  walker: GroundWalker;
  sprite: Sprite;
  stride: number;
  /** Seconds before it sets off (the second follows the first). */
  delay: number;
  /** Where along the brow it stops to sit (world x), whether it has, and how long it sits. */
  stopX: number;
  sat: boolean;
  sit: number;
  /** Seconds until its next howl, how long the current one has left, and how many it's given. */
  nextHowl: number;
  howling: number;
  howls: number;
}

interface Raven {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  flap: number;
  glide: number;
}

interface EyePair {
  sprite: Sprite;
  x: number;
  y: number;
  life: number;
  age: number;
  blink: number;
}

/**
 * The forest's callers: on moonlit nights a pair of wolves comes along the
 * brow, sits against the misty valley, lifts their muzzles and howls, and
 * goes; in the autumn rut a stag steps out on the brow in the first light
 * and bugles; by day ravens cross high over the wood, croaking; and in the
 * deepest dark, eyes catch the light high up among the trunks (an owl, a
 * marten), blink, and are gone.
 */
export class NightCalls {
  private readonly wolves: Wolf[] = [];
  private readonly wolfSprites = new DrawnCache();
  private wolfTimer = r(120, 400);
  private forceWolves = false;
  private stag: { walker: GroundWalker; sprite: Sprite; stride: number; stand: number; bugled: boolean } | null = null;
  private stagTimer = r(60, 300);
  private readonly stagSprites = new DrawnCache();
  private readonly ravens: Raven[] = [];
  private readonly birdSprites = new BirdSpriteCache();
  private ravenTimer = r(60, 240);
  private readonly eyes: EyePair[] = [];
  private eyeTimer = 5;

  constructor(
    private readonly midground: Container,
    private readonly sky: Container,
    private readonly nightLayer: Container,
    private readonly plane: GroundPlane,
    private readonly area: WalkArea,
    private readonly obstacles: readonly Obstacle[],
    private readonly trunks: readonly Trunk[],
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {}

  /** Called with the howling wolf's world x as each howl begins, for the wood to hear. */
  onHowl: ((x: number) => void) | null = null;

  get wolvesOut(): number {
    return this.wolves.length;
  }

  /** Where the wolves are on the ground. */
  get wolfSpots(): Array<{ gx: number; depth: number }> {
    return this.wolves.map((w) => ({ gx: w.walker.gx, depth: w.walker.depth }));
  }

  /** Bring the wolves now (for the debug view). */
  callWolves(): void {
    this.wolfTimer = 0;
    this.forceWolves = true;
  }

  update(dt: number, env: Environment): void {
    this.updateWolves(dt, env);
    this.updateStag(dt, env);
    this.updateRavens(dt, env);
    this.updateEyes(dt, env);
  }

  private spawnWalker(depthFraction: number): GroundWalker {
    const side = Math.random() < 0.5 ? -1 : 1;
    const depth = this.area.maxDepth - depthFraction * (this.area.maxDepth - this.area.minDepth);
    const w = new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 80 * d }, side * (this.plane.halfWidthAt(depth) + 40 * depth), depth, side > 0 ? Math.PI : 0);
    w.obstacles = this.obstacles;
    w.steering = { kind: 'exit', side: side > 0 ? -1 : 1 };
    return w;
  }

  private updateWolves(dt: number, env: Environment): void {
    if (!this.wolves.length) {
      this.wolfTimer -= dt;
      if (this.wolfTimer > 0) return;
      this.wolfTimer = r(600, 1500);
      if (!this.forceWolves && wolfActivity(env.lighting.hours, env.lighting.moonlight) < 0.2) return;
      this.forceWolves = false;
      this.spawnWolves();
    }
    const tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.25);
    for (let i = this.wolves.length - 1; i >= 0; i--) {
      const wolf = this.wolves[i];
      const w = wolf.walker;
      const p = w.point;
      // They stop on the brow where the valley opens behind them, sit, and howl (the second joining in).
      if (!wolf.sat && Math.abs(p.x - wolf.stopX) < 4) {
        wolf.sat = true;
        wolf.sit = r(16, 26);
        wolf.nextHowl = 2 + i * 1.6;
      }
      if (wolf.sit > 0) {
        wolf.sit -= dt;
        w.speed = 0;
        wolf.nextHowl -= dt;
        if (wolf.howling > 0) wolf.howling -= dt;
        else if (wolf.nextHowl <= 0 && wolf.howls < 2) {
          wolf.howling = r(3, 3.8);
          wolf.howls++;
          wolf.nextHowl = r(7, 11);
          this.sound('wolf-howl', this.viewport.worldXToStereo(p.x), 0.55);
          this.onHowl?.(p.x);
        }
      } else if (wolf.delay > 0) {
        wolf.delay -= dt;
        w.speed = 0;
      } else w.speed = 26;
      w.update(dt);
      wolf.stride += w.speed * p.scale * dt;
      if (w.gone) {
        wolf.sprite.destroy();
        this.wolves.splice(i, 1);
        continue;
      }
      const h = Math.max(6, Math.round((WOLF_HEIGHT * p.scale) / 2) * 2);
      const pose: WolfPose = wolf.sit > 0 ? (wolf.howling > 0 ? 'howl' : 'sit') : WOLF_WALK[Math.floor(wolf.stride / 2.2) % 4];
      wolf.sprite.texture = this.wolfSprites.get(`${pose}:${h}`, () => drawWolf(pose, h));
      wolf.sprite.scale.x = w.facing;
      wolf.sprite.position.set(Math.round(p.x), Math.round(p.y));
      wolf.sprite.zIndex = p.y;
      wolf.sprite.tint = tint;
    }
  }

  private spawnWolves(): void {
    const lead = this.spawnWalker(0.06);
    const side = lead.gx > 0 ? 1 : -1;
    for (let k = 0; k < 2; k++) {
      // The second comes along the same way a little behind the first.
      const w = k === 0 ? lead : new GroundWalker(this.plane, { ...this.area, halfWidth: (d) => this.plane.halfWidthAt(d) + 80 * d }, lead.gx, lead.depth - 0.04, side > 0 ? Math.PI : 0);
      w.obstacles = this.obstacles;
      w.steering = { kind: 'exit', side: side > 0 ? -1 : 1 };
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      this.midground.addChild(sprite);
      this.wolves.push({ walker: w, sprite, stride: Math.random() * 4, delay: k * 2.6, stopX: 420 + side * (k ? 26 : -4), sat: false, sit: 0, nextHowl: 0, howling: 0, howls: 0 });
    }
  }

  private updateStag(dt: number, env: Environment): void {
    const rut = stagRut(new Date().getMonth(), env.lighting.hours);
    if (!this.stag) {
      this.stagTimer -= dt;
      if (this.stagTimer > 0) return;
      this.stagTimer = r(500, 1100);
      if (!rut) return;
      const walker = this.spawnWalker(0.04);
      const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
      this.midground.addChild(sprite);
      this.stag = { walker, sprite, stride: 0, stand: 0, bugled: false };
    }
    const st = this.stag;
    const w = st.walker;
    const p = w.point;
    if (!st.bugled && Math.abs(p.x - 300) < 140 && Math.random() < dt * 0.3) {
      st.stand = r(6, 10);
      st.bugled = true;
      this.sound('elk-bugle', this.viewport.worldXToStereo(p.x), 0.55);
    }
    if (st.stand > 0) {
      st.stand -= dt;
      w.speed = 0;
    } else w.speed = 14;
    w.update(dt);
    st.stride += w.speed * p.scale * dt;
    if (w.gone) {
      st.sprite.destroy();
      this.stag = null;
      return;
    }
    const h = Math.max(8, Math.round((STAG_HEIGHT * p.scale) / 2) * 2);
    const pose: DeerPose = st.stand > 0 ? (st.stand > 3 ? 'alert' : 'stand') : (['walk-1', 'walk-2', 'walk-3', 'walk-4', 'walk-5', 'walk-6'] as const)[Math.floor(st.stride / 2.7) % 6];
    st.sprite.texture = this.stagSprites.get(`${pose}:${h}`, () => drawDeerSized('elk', pose, h));
    st.sprite.scale.x = w.facing;
    st.sprite.position.set(Math.round(p.x), Math.round(p.y));
    st.sprite.zIndex = p.y;
    st.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.3);
  }

  private updateRavens(dt: number, env: Environment): void {
    this.ravenTimer -= dt;
    if (this.ravenTimer <= 0) {
      this.ravenTimer = r(180, 480);
      if (ravenActivity(env.lighting.hours) > 0 && env.weather.precipitation < 0.5) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = r(40, 110);
        for (let k = 0; k < 2; k++) {
          const sprite = new Sprite({ anchor: 0.5 });
          this.sky.addChild(sprite);
          this.ravens.push({ sprite, x: dir > 0 ? -20 - k * 26 : 860 + k * 26, y: y + k * 6, vx: dir * r(30, 38), flap: Math.random(), glide: 0 });
        }
        this.sound('raven-croak', dir > 0 ? -0.6 : 0.6, 0.4);
      }
    }
    for (let i = this.ravens.length - 1; i >= 0; i--) {
      const rv = this.ravens[i];
      rv.x += rv.vx * dt;
      rv.y += Math.sin(rv.x * 0.02) * dt * 2;
      if (rv.glide > 0) rv.glide -= dt;
      else if (Math.random() < dt * 0.3) rv.glide = r(0.8, 2);
      rv.flap += dt * 3.2;
      const pose = rv.glide > 0 ? 'glide' : FLAP_CYCLE[Math.floor(rv.flap * 4) % 4];
      rv.sprite.texture = this.birdSprites.get('crow', pose, 14);
      rv.sprite.scale.x = rv.vx > 0 ? 1 : -1;
      rv.sprite.position.set(Math.round(rv.x), Math.round(rv.y));
      rv.sprite.tint = lerpColor(env.lighting.ambient, env.lighting.haze, 0.35);
      if (Math.random() < dt * 0.04) this.sound('raven-croak', this.viewport.worldXToStereo(rv.x), 0.3);
      if (rv.x < -60 || rv.x > 900) {
        rv.sprite.destroy();
        this.ravens.splice(i, 1);
      }
    }
  }

  private updateEyes(dt: number, env: Environment): void {
    const dark = env.lighting.darkness;
    this.eyeTimer -= dt;
    if (dark > 0.78 && this.eyeTimer <= 0 && this.eyes.length < 2) {
      this.eyeTimer = r(15, 50);
      const trunks = this.trunks.filter((t) => t.layer === 'mid' && t.bottom - t.top > 60);
      const t = trunks[Math.floor(Math.random() * trunks.length)];
      if (t) {
        const sprite = new Sprite({ texture: eyesTexture(), blendMode: 'add' });
        this.nightLayer.addChild(sprite);
        const side = Math.random() < 0.5 ? -1 : 1;
        this.eyes.push({ sprite, x: Math.round(t.x + side * (t.width / 2 + 1)), y: Math.round(r(t.top + 10, t.bottom - 40)), life: r(5, 12), age: 0, blink: r(1, 3) });
      }
    }
    for (let i = this.eyes.length - 1; i >= 0; i--) {
      const e = this.eyes[i];
      e.age += dt;
      e.blink -= dt;
      if (e.blink < -0.15) e.blink = r(1.5, 4);
      const open = e.blink > 0;
      const a = Math.min(1, e.age / 1.5) * Math.min(1, Math.max(0, e.life - e.age) / 1.5) * Math.min(1, (dark - 0.7) * 4);
      e.sprite.alpha = open ? a : 0;
      e.sprite.position.set(e.x - 1, e.y);
      if (e.age >= e.life) {
        e.sprite.destroy();
        this.eyes.splice(i, 1);
      }
    }
  }
}

let eyes: Texture | null = null;
/** A pair of eyes catching the light: two amber pixels, a pixel apart. */
function eyesTexture(): Texture {
  if (!eyes) {
    const p = new PixelBuffer(4, 1);
    p.set(0, 0, 0xf0c060);
    p.set(3, 0, 0xf0c060);
    eyes = p.toTexture();
  }
  return eyes;
}
