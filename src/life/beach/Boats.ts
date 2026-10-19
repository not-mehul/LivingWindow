import { Graphics, Sprite, type Texture } from 'pixi.js';
import { lerpColor, multiplyColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import type { BeachScene } from '../../scene/beach/BeachScene';
import { glowTexture } from '../../scene/common/glow';
import type { Environment } from '../../scene/Environment';
import { BEACH_HORIZON, shoreXAtY } from '../../sim/shore';
import { drawFishingBoat, drawSailboat } from '../../sprites/shoreSprites';
import { DrawnCache } from '../../sprites/wildSprites';
import { rand as r } from '../../core/random';
import { wrapHours } from '../../state/timeOfDay';
import { hazeTint } from '../../scene/lighting';

/** How many sailboats are out (0..1 of the most): fair-weather daytime sailors, a breeze but not a blow. */
export function sailingWeather(hours: number, wind: number, precipitation: number, lightning: number): number {
  const h = wrapHours(hours);
  if (lightning > 0.2 || precipitation > 0.3) return 0;
  const day = h >= 8.5 && h < 19 ? 1 : h >= 7 && h < 21 ? 0.4 : 0.1;
  const w = Math.abs(wind);
  const breeze = w < 0.08 ? 0.4 : w > 0.8 ? 0.2 : 1;
  return day * breeze;
}

/** How likely the fishing boat is to be going out or coming home now (relative chance): at first light, and towards evening. */
export function fishingTide(hours: number): number {
  const h = wrapHours(hours);
  if (h >= 4.5 && h < 9) return 1;
  if (h >= 16.5 && h < 21) return 0.8;
  if (h >= 21 || h < 4.5) return 0.3;
  return 0.25;
}

interface Sail {
  x: number;
  y: number;
  vx: number;
  size: number;
  sprite: Sprite;
  light: Sprite;
  phase: number;
}

interface Fisher {
  x: number;
  y: number;
  vx: number;
  size: number;
  sprite: Sprite;
  lights: Sprite[];
  phase: number;
  /** Its wake: points dropped behind the stern, spreading and fading. */
  wake: Array<{ x: number; y: number; age: number }>;
  dropTimer: number;
}

/**
 * Far out on the horizon, now and then, a sign of people, but no more: a
 * sailboat or two drifting along, heeled in the breeze, their sails taking
 * the low sun pink and gold, a mast light pricking the dark if one is still
 * out at night; and once in a while a fishing boat chugging across, its
 * wake trailing white behind it and a cloud of gulls wheeling over its
 * stern, lit up with its deck lights after dark.
 */
export class Boats {
  private readonly sails: Sail[] = [];
  private fisher: Fisher | null = null;
  private readonly sprites = new DrawnCache();
  private readonly wakeGfx = new Graphics();
  private readonly gullGfx = new Graphics();
  private readonly lightTexture: Texture;
  private readonly lampTexture: Texture;
  private sailTimer = 2;
  private fisherTimer = r(60, 300);
  private started = false;

  constructor(
    private readonly scene: BeachScene,
    private readonly viewport: Viewport,
  ) {
    scene.horizonLayer.addChild(this.wakeGfx);
    this.lightTexture = glowTexture(3, 0xfff4d8, 0.9, true);
    this.lampTexture = glowTexture(4, 0xffd890, 0.8, false);
  }

  get sailCount(): number {
    return this.sails.length;
  }

  get fishing(): boolean {
    return this.fisher !== null;
  }

  /** The fishing boat's stern, where the gulls are (world px), while it's out. */
  get fisherAt(): { x: number; y: number; dir: 1 | -1 } | null {
    const f = this.fisher;
    if (!f) return null;
    const dir = f.vx >= 0 ? 1 : -1;
    return { x: f.x - (dir * f.size) / 2, y: f.y - f.size * 0.4, dir };
  }

  summonFisher(): void {
    if (!this.fisher) this.spawnFisher();
  }

  summonSail(): void {
    this.spawnSail(true);
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    const wind = weather.wind ?? 0;
    const want = Math.round(sailingWeather(lighting.hours, wind, weather.precipitation, weather.lightning) * 2);
    // When the scene first opens, whoever's out is already out there.
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < want; i++) this.spawnSail(true);
    }
    this.sailTimer -= dt;
    if (this.sailTimer <= 0) {
      this.sailTimer = r(40, 120);
      if (this.sails.length < want) this.spawnSail(false);
    }
    const night = lighting.darkness > 0.6;
    // Low sun catches the sails: warm, rosy.
    const lowSun = lighting.sun.visible ? Math.max(0, 1 - lighting.sun.elevation * 4) : 0;
    const sailTint = lerpColor(lerpColor(lighting.ambient, 0xffffff, 0.15), lerpColor(lighting.sun.color, 0xffd8c0, 0.4), lowSun * 0.45);
    const heel = Math.abs(wind) > 0.5 ? 2 : Math.abs(wind) > 0.2 ? 1 : 0;
    for (let i = this.sails.length - 1; i >= 0; i--) {
      const b = this.sails[i];
      b.phase += dt;
      b.x += b.vx * dt * (0.6 + Math.abs(wind));
      // Clear of the land: it goes about.
      if (b.x < shoreXAtY(b.y) + 6 && b.vx < 0) b.vx = -b.vx;
      const rock = Math.sin(b.phase * 0.9) > 0.6 ? 1 : 0;
      const frame = Math.min(2, heel + (heel > 0 ? rock : 0));
      b.sprite.texture = this.sprites.get(`sail:${frame}:${b.size}`, () => drawSailboat(frame, b.size));
      b.sprite.scale.x = b.vx >= 0 ? 1 : -1;
      b.sprite.position.set(Math.round(b.x), b.y + (Math.sin(b.phase * 1.3) > 0.7 ? 1 : 0));
      b.sprite.tint = sailTint;
      b.light.visible = night;
      b.light.position.set(Math.round(b.x + (b.vx >= 0 ? -1 : 1) * b.size * 0.06), b.y - b.size + 1);
      const out = !this.viewport.inView(b.x, -80);
      if (out && (want < this.sails.length || Math.random() < dt * 0.02)) {
        b.sprite.destroy();
        b.light.destroy();
        this.sails.splice(i, 1);
      }
    }
    this.updateFisher(dt, env, night);
  }

  private updateFisher(dt: number, env: Environment, night: boolean): void {
    if (!this.fisher) {
      this.fisherTimer -= dt;
      if (this.fisherTimer <= 0) {
        this.fisherTimer = r(600, 1800);
        if (Math.random() < fishingTide(env.lighting.hours) && env.weather.lightning < 0.2) this.spawnFisher();
      }
      this.wakeGfx.clear();
      this.gullGfx.clear();
      return;
    }
    const f = this.fisher;
    f.phase += dt;
    f.x += f.vx * dt;
    const frame = Math.sin(f.phase * 1.6) > 0.3 ? 1 : 0;
    f.sprite.texture = this.sprites.get(`fish:${frame}:${f.size}`, () => drawFishingBoat(frame, f.size));
    f.sprite.scale.x = f.vx >= 0 ? 1 : -1;
    f.sprite.position.set(Math.round(f.x), f.y);
    const tint = hazeTint(env.lighting, 0.3);
    f.sprite.tint = tint;
    // Deck lights after dark: the wheelhouse, the masthead, a work lamp aft.
    const dir = f.vx >= 0 ? 1 : -1;
    const spots = [
      [0.17, 0.3],
      [-0.05, 0.62],
      [-0.33, 0.2],
    ];
    f.lights.forEach((l, k) => {
      l.visible = night;
      l.position.set(Math.round(f.x + dir * spots[k][0] * f.size), Math.round(f.y - spots[k][1] * f.size * 0.62));
    });
    // The wake: dropped off the stern, spreading out into a V and fading.
    const stern = f.x - (dir * f.size) / 2;
    f.dropTimer -= dt;
    if (f.dropTimer <= 0) {
      f.dropTimer = 0.25;
      f.wake.push({ x: stern, y: f.y, age: 0 });
    }
    const g = this.wakeGfx;
    g.clear();
    const foam = lerpColor(multiplyColor(0xeef4f6, env.lighting.ambient), env.lighting.haze, 0.3);
    for (let i = f.wake.length - 1; i >= 0; i--) {
      const w = f.wake[i];
      w.age += dt;
      if (w.age > 9) {
        f.wake.splice(i, 1);
        continue;
      }
      const spread = w.age * 0.45;
      const a = Math.max(0, 0.75 - w.age * 0.08);
      g.rect(Math.round(w.x - spread * dir * 0.3), Math.round(w.y - 1), 1, 1).fill({ color: foam, alpha: a });
      if (w.age > 0.6) g.rect(Math.round(w.x + spread * dir * 0.2), Math.round(w.y - 1 + Math.min(2, spread * 0.4)), 1, 1).fill({ color: foam, alpha: a * 0.7 });
    }
    // The gulls following it, by day: specks wheeling over the stern.
    const gg = this.gullGfx;
    gg.clear();
    if (!night) {
      const white = lerpColor(env.lighting.ambient, 0xffffff, 0.4);
      for (let k = 0; k < 7; k++) {
        const a = f.phase * (0.9 + k * 0.13) + k * 1.7;
        const gx = stern + Math.cos(a) * (4 + (k % 3) * 3) - dir * 3;
        const gy = f.y - f.size * 0.5 - 3 - Math.abs(Math.sin(a * 0.7)) * 8 - (k % 2) * 3;
        gg.rect(Math.round(gx), Math.round(gy), Math.sin(a * 3) > 0 ? 2 : 1, 1).fill({ color: white, alpha: 0.9 });
      }
    }
    if (!this.viewport.inView(f.x, -120)) {
      f.sprite.destroy();
      for (const l of f.lights) l.destroy();
      this.fisher = null;
    }
  }

  private spawnSail(inView: boolean): void {
    const y = BEACH_HORIZON + 1 + Math.floor(Math.random() * 5);
    const size = Math.round(6 + (y - BEACH_HORIZON - 1) * 1.5 + Math.random() * 2);
    const sea = shoreXAtY(y) + 20;
    const left = Math.max(sea, this.viewport.panX);
    const right = this.viewport.visibleRight;
    const fromRight = Math.random() < 0.5;
    const x = inView ? r(left, Math.max(left + 1, right - 10)) : fromRight ? right + 40 : left - 40;
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    const light = new Sprite({ texture: this.lightTexture, anchor: 0.5, blendMode: 'add' });
    light.visible = false;
    this.scene.horizonLayer.addChild(sprite, light);
    this.sails.push({ x, y, vx: (fromRight ? -1 : 1) * r(1.2, 3), size, sprite, light, phase: Math.random() * 6 });
  }

  private spawnFisher(): void {
    const y = BEACH_HORIZON + 4 + Math.floor(Math.random() * 8);
    const size = Math.round(14 + (y - BEACH_HORIZON - 4) * 1.1);
    const right = this.viewport.visibleRight;
    const fromRight = Math.random() < 0.6;
    const x = fromRight ? right + 60 : Math.max(shoreXAtY(y) + 30, this.viewport.panX) - 60;
    const sprite = new Sprite({ anchor: { x: 0.5, y: 1 } });
    const lights = [0, 1, 2].map(() => {
      const l = new Sprite({ texture: this.lampTexture, anchor: 0.5, blendMode: 'add' });
      l.visible = false;
      return l;
    });
    this.scene.horizonLayer.addChild(sprite, ...lights, this.gullGfx);
    this.fisher = { x, y, vx: (fromRight ? -1 : 1) * r(3.5, 6), size, sprite, lights, phase: 0, wake: [], dropTimer: 0 };
  }
}
