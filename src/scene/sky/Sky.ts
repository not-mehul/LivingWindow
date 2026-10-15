import { Container, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { channels } from '../../core/color';
import { lerp } from '../../core/math';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Environment } from '../Environment';
import type { CelestialBody } from '../lighting';

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** Number of flat colour steps in the sky gradient (dithered between). */
const SKY_STEPS = 9;
const CLOUD_COUNT = 16;
const TWINKLE_GROUPS = 3;

export interface SkyOptions {
  /** World y of the horizon (where the horizon colour is reached). */
  horizonY: number;
  seed?: number;
}

/**
 * The gradient sky is only 4 px wide: the 4×4 Bayer dither pattern repeats
 * horizontally, so a tiling sprite covers the whole panorama and the texture
 * is cheap enough to rebuild every frame as the light changes.
 */
class SkyGradient {
  readonly sprite: TilingSprite;
  private readonly canvas = new PixelCanvas(4, WORLD_HEIGHT);
  private readonly image: ImageData;
  private readonly texture: Texture;
  private lastTop = -1;
  private lastHorizon = -1;

  constructor(private readonly horizonY: number) {
    this.image = this.canvas.ctx.createImageData(4, WORLD_HEIGHT);
    this.texture = createNearestTexture(this.canvas.canvas);
    this.sprite = new TilingSprite({ texture: this.texture, width: WORLD_WIDTH, height: WORLD_HEIGHT });
  }

  update(top: number, horizon: number): void {
    if (top === this.lastTop && horizon === this.lastHorizon) return;
    this.lastTop = top;
    this.lastHorizon = horizon;
    const [tr, tg, tb] = channels(top);
    const [hr, hg, hb] = channels(horizon);
    const data = this.image.data;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      // Ease so the zenith colour holds longer and the horizon glow is a band.
      const t = Math.min(1, y / this.horizonY) ** 1.7 * (SKY_STEPS - 1);
      const base = Math.floor(t);
      const frac = t - base;
      for (let x = 0; x < 4; x++) {
        const step = frac > (BAYER_4[y & 3][x] + 0.5) / 16 ? Math.min(base + 1, SKY_STEPS - 1) : base;
        const k = step / (SKY_STEPS - 1);
        const i = (y * 4 + x) * 4;
        data[i] = tr + (hr - tr) * k;
        data[i + 1] = tg + (hg - tg) * k;
        data[i + 2] = tb + (hb - tb) * k;
        data[i + 3] = 255;
      }
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}

function createStarTextures(horizonY: number, rng: () => number): { fixed: Texture; twinkle: Texture[] } {
  const colors = ['#ffffff', '#dfe8ff', '#fff2d6', '#cfd8ff'];
  const fixed = new PixelCanvas(WORLD_WIDTH, horizonY);
  const twinkle = Array.from({ length: TWINKLE_GROUPS }, () => new PixelCanvas(WORLD_WIDTH, horizonY));
  for (let i = 0; i < 220; i++) {
    const x = randomInt(rng, 0, WORLD_WIDTH - 1);
    // Fewer stars near the horizon where the sky is brighter and hazier.
    const y = Math.floor(rng() ** 1.6 * (horizonY - 30));
    const color = colors[randomInt(rng, 0, colors.length - 1)];
    const target = rng() < 0.25 ? twinkle[i % TWINKLE_GROUPS] : fixed;
    target.px(x, y, color);
  }
  // A handful of bright stars with a pixel cross.
  for (let i = 0; i < 9; i++) {
    const x = randomInt(rng, 4, WORLD_WIDTH - 5);
    const y = randomInt(rng, 4, Math.floor(horizonY * 0.55));
    const c = twinkle[i % TWINKLE_GROUPS];
    c.px(x, y, '#ffffff');
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      c.px(x + dx, y + dy, '#9fb0e0');
    }
  }
  return { fixed: fixed.toTexture(), twinkle: twinkle.map((c) => c.toTexture()) };
}

function createDiscTexture(radius: number, craters: boolean): Texture {
  const size = radius * 2 + 1;
  const c = new PixelCanvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - radius, y - radius);
      if (d > radius + 0.2) continue;
      // Authored in greys so the lighting tint supplies the hue.
      const rim = d > radius - 1.2;
      c.px(x, y, rim ? '#e6e6e6' : '#ffffff');
    }
  }
  if (craters) {
    for (const [x, y, r] of [
      [radius - 3, radius - 2, 1.6],
      [radius + 3, radius + 1, 1.2],
      [radius - 1, radius + 4, 1],
      [radius + 2, radius - 4, 0.8],
    ]) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.hypot(dx, dy) <= r) c.px(x + dx, y + dy, '#c8c8cc');
        }
      }
    }
  }
  return c.toTexture();
}

/** Soft halo made of dithered rings so it stays pixel art (drawn additively). */
function createGlowTexture(radius: number): Texture {
  const size = radius * 2;
  const c = new PixelCanvas(size, size);
  const image = c.ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - radius + 0.5, y - radius + 0.5) / radius;
      if (d >= 1) continue;
      const level = (1 - d) ** 2 * 4;
      const step = Math.floor(level) + (level % 1 > (BAYER_4[y & 3][x & 3] + 0.5) / 16 ? 1 : 0);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.min(4, step) * 48;
    }
  }
  c.ctx.putImageData(image, 0, 0);
  return c.toTexture();
}

function createCloudTexture(rng: () => number, scale: number): Texture {
  const w = Math.round(randomInt(rng, 34, 70) * scale);
  const h = Math.max(8, Math.round(16 * scale));
  const c = new PixelCanvas(w, h);
  const puffs = randomInt(rng, 3, 6);
  for (let i = 0; i < puffs; i++) {
    const cx = ((i + 0.5) / puffs) * w + randomRange(rng, -3, 3);
    const r = randomRange(rng, 0.3, 0.48) * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / (r * 1.7);
        const dy = (y - (h - r - 1)) / r;
        if (dx * dx + dy * dy > 1) continue;
        // Lit tops, shaded undersides; tint supplies the colour of the light.
        const shade = y > h - r * 0.6 ? '#c9cede' : y > h - r * 1.2 ? '#e6e9f2' : '#ffffff';
        c.px(x, y, shade);
      }
    }
  }
  c.hline(2, h - 1, w - 4, '#b3b9cc');
  return c.toTexture();
}

interface Cloud {
  sprite: Sprite;
  speed: number;
  maxAlpha: number;
}

export class Sky {
  readonly container = new Container({ label: 'sky' });
  /** Lightning bolts draw here: in front of the sky, behind clouds and the skyline. */
  readonly boltLayer = new Container({ label: 'bolts' });

  private readonly gradient: SkyGradient;
  private readonly stars: Sprite;
  private readonly twinkles: Sprite[];
  private readonly sun: Sprite;
  private readonly sunGlow: Sprite;
  private readonly moon: Sprite;
  private readonly moonGlow: Sprite;
  private readonly clouds: Cloud[] = [];
  private readonly horizonY: number;
  private cloudsSettled = false;

  constructor(options: SkyOptions) {
    this.horizonY = options.horizonY;
    const rng = createRng(options.seed ?? 4242);
    this.gradient = new SkyGradient(options.horizonY);

    const starTextures = createStarTextures(options.horizonY, rng);
    this.stars = new Sprite(starTextures.fixed);
    this.twinkles = starTextures.twinkle.map((t) => new Sprite(t));

    const glow = createGlowTexture(56);
    this.sunGlow = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add' });
    this.moonGlow = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add', scale: 0.6 });
    this.sun = new Sprite({ texture: createDiscTexture(9, false), anchor: 0.5 });
    this.moon = new Sprite({ texture: createDiscTexture(7, true), anchor: 0.5 });

    const cloudLayer = new Container({ label: 'clouds' });
    for (let i = 0; i < CLOUD_COUNT; i++) {
      // Higher clouds are further away: smaller and slower.
      const height = rng();
      const sprite = new Sprite(createCloudTexture(rng, 0.6 + 0.6 * height));
      sprite.position.set(randomRange(rng, -60, WORLD_WIDTH), Math.round(20 + height * 150));
      sprite.alpha = 0;
      this.clouds.push({ sprite, speed: 1.2 + height * 3.5, maxAlpha: randomRange(rng, 0.75, 1) });
      cloudLayer.addChild(sprite);
    }
    // Visible cloud order is shuffled so overcast skies fill in evenly.
    this.clouds.sort(() => rng() - 0.5);

    this.container.addChild(
      this.gradient.sprite,
      this.stars,
      ...this.twinkles,
      this.moonGlow,
      this.moon,
      this.sunGlow,
      this.sun,
      this.boltLayer,
      cloudLayer,
    );
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.gradient.update(lighting.skyTop, lighting.skyHorizon);

    this.stars.alpha = lighting.stars;
    this.twinkles.forEach((sprite, i) => {
      sprite.alpha = lighting.stars * (0.55 + 0.45 * Math.sin(time * (0.9 + i * 0.37) + i * 2.1));
    });

    this.placeBody(this.sun, this.sunGlow, lighting.sun, 205);
    this.sun.alpha = lighting.sun.visible ? 1 - weather.cloudCover * 0.85 : 0;
    this.sunGlow.alpha = lighting.sun.glow;
    this.placeBody(this.moon, this.moonGlow, lighting.moon, 170);
    this.moon.alpha = lighting.moon.visible ? lighting.moon.glow : 0;
    this.moonGlow.alpha = lighting.moon.glow * 0.35;

    this.updateClouds(dt, env);
  }

  private placeBody(body: Sprite, glow: Sprite, state: CelestialBody, arcHeight: number): void {
    body.visible = glow.visible = state.visible;
    if (!state.visible) return;
    const x = Math.round(lerp(70, WORLD_WIDTH - 70, state.progress));
    const y = Math.round(this.horizonY + 8 - state.elevation * arcHeight);
    body.position.set(x, y);
    glow.position.set(x, y);
    body.tint = state.color;
    glow.tint = state.color;
  }

  private updateClouds(dt: number, env: Environment): void {
    const { weather, lighting } = env;
    const visibleCount = Math.round(3 + (CLOUD_COUNT - 3) * weather.cloudCover);
    const drift = (weather.wind >= 0 ? 1 : -1) * (0.35 + 2.2 * Math.abs(weather.wind));
    // Fade clouds in and out slowly, except on the very first frame.
    const fade = this.cloudsSettled ? Math.min(1, dt * 0.25) : 1;
    this.cloudsSettled = true;
    this.clouds.forEach((cloud, i) => {
      const { sprite } = cloud;
      const target = i < visibleCount ? cloud.maxAlpha : 0;
      sprite.alpha += (target - sprite.alpha) * fade;
      sprite.tint = lighting.cloudTint;
      sprite.x += cloud.speed * drift * dt;
      if (sprite.x > WORLD_WIDTH + 20) sprite.x = -sprite.width - 20;
      else if (sprite.x < -sprite.width - 20) sprite.x = WORLD_WIDTH + 20;
    });
  }
}
