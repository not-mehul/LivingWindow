import { Container, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { channels, lerpColor } from '../../core/color';
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
  /** The moon's phase in this landscape's sky. */
  moonPhase?: 'full' | 'crescent';
  /** Faint lines joining the stars of a few constellations. */
  constellations?: boolean;
  /** A dusting of the Milky Way across the sky. */
  milkyWay?: boolean;
  /** This landscape's own night-sky colours (zenith, horizon), blended in as night falls. */
  nightColors?: readonly [top: number, horizon: number];
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

function createStarTextures(horizonY: number, rng: () => number, options: SkyOptions): { fixed: Texture; twinkle: Texture[] } {
  const colors = ['#ffffff', '#dfe8ff', '#fff2d6', '#cfd8ff'];
  const fixed = new PixelCanvas(WORLD_WIDTH, horizonY);
  const twinkle = Array.from({ length: TWINKLE_GROUPS }, () => new PixelCanvas(WORLD_WIDTH, horizonY));
  if (options.milkyWay) {
    // A band of faint stars and glow sweeping diagonally across the sky.
    for (let i = 0; i < 1400; i++) {
      const t = rng();
      const across = (rng() + rng() + rng() - 1.5) * 26;
      const x = Math.round(t * WORLD_WIDTH);
      const y = Math.round(horizonY * 0.75 - t * horizonY * 0.65 + across);
      if (y < 0 || y >= horizonY - 20) continue;
      fixed.px(x, y, rng() < 0.3 ? '#8a94c8' : rng() < 0.6 ? '#5c6698' : '#c8d0f0');
    }
  }
  if (options.constellations) {
    // A few patterns of brighter stars, joined by faint lines.
    const shapes = [
      [[0, 0], [14, -3], [26, 2], [36, 0], [40, 12], [56, 14], [58, 2]],
      [[0, 10], [10, 0], [22, 4], [30, -6], [42, 2]],
      [[0, 0], [8, 10], [20, 12], [26, 2], [12, -4]],
    ];
    shapes.forEach((shape, k) => {
      const ox = 120 + k * 230 + randomInt(rng, -30, 30);
      const oy = 22 + randomInt(rng, 0, Math.max(1, Math.floor(horizonY * 0.3)));
      for (let i = 1; i < shape.length; i++) {
        const [x0, y0] = shape[i - 1];
        const [x1, y1] = shape[i];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let s = 1; s < steps; s++) {
          if (s % 2) continue;
          fixed.px(Math.round(ox + x0 + ((x1 - x0) * s) / steps), Math.round(oy + y0 + ((y1 - y0) * s) / steps), '#3c4a7a');
        }
      }
      for (const [x, y] of shape) {
        fixed.px(ox + x, oy + y, '#ffffff');
        fixed.px(ox + x + 1, oy + y, '#a8b4e8');
      }
    });
  }
  for (let i = 0; i < 480; i++) {
    const x = randomInt(rng, 0, WORLD_WIDTH - 1);
    // Fewer stars near the horizon where the sky is brighter and hazier.
    const y = Math.floor(rng() ** 1.6 * (horizonY - 30));
    const color = colors[randomInt(rng, 0, colors.length - 1)];
    const target = rng() < 0.25 ? twinkle[i % TWINKLE_GROUPS] : fixed;
    // Most are faint; some read a little brighter.
    target.px(x, y, rng() < 0.55 ? color : '#8a92b8');
  }
  // A handful of bright stars with a pixel cross.
  for (let i = 0; i < 16; i++) {
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

function createDiscTexture(radius: number, craters: boolean, crescent = false): Texture {
  const size = radius * 2 + 1;
  const c = new PixelCanvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - radius, y - radius);
      if (d > radius + 0.2) continue;
      // A crescent: the disc with an offset disc taken out of it.
      if (crescent && Math.hypot(x - radius - radius * 0.55, y - radius + radius * 0.25) < radius * 0.95) continue;
      // Authored in greys so the lighting tint supplies the hue.
      const rim = d > radius - 1.2;
      c.px(x, y, rim ? '#e6e6e6' : '#ffffff');
    }
  }
  if (craters && !crescent) {
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
  private readonly moonHaloStrength: number;
  private readonly nightColors?: readonly [number, number];
  private cloudsSettled = false;

  constructor(options: SkyOptions) {
    this.horizonY = options.horizonY;
    const rng = createRng(options.seed ?? 4242);
    this.gradient = new SkyGradient(options.horizonY);

    const starTextures = createStarTextures(options.horizonY, rng, options);
    this.stars = new Sprite(starTextures.fixed);
    this.twinkles = starTextures.twinkle.map((t) => new Sprite(t));

    const glow = createGlowTexture(56);
    // The sun's own wider glow, for when it sits low in a dusk sky.
    this.sunGlow = new Sprite({ texture: createGlowTexture(96), anchor: 0.5, blendMode: 'add' });
    this.nightColors = options.nightColors;
    const crescent = options.moonPhase === 'crescent';
    // The moon's halo: wide and bright at full moon, as in the night drawings.
    this.moonGlow = new Sprite({ texture: glow, anchor: 0.5, blendMode: 'add', scale: crescent ? 0.6 : 1 });
    this.sun = new Sprite({ texture: createDiscTexture(9, false), anchor: 0.5 });
    this.moon = new Sprite({ texture: createDiscTexture(crescent ? 8 : 10, true, crescent), anchor: 0.5 });
    this.moonHaloStrength = crescent ? 0.35 : 0.6;

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
    const night = this.nightColors ? lighting.nightness : 0;
    this.gradient.update(
      night > 0 && this.nightColors ? lerpColor(lighting.skyTop, this.nightColors[0], night) : lighting.skyTop,
      night > 0 && this.nightColors ? lerpColor(lighting.skyHorizon, this.nightColors[1], night) : lighting.skyHorizon,
    );

    this.stars.alpha = lighting.stars;
    this.twinkles.forEach((sprite, i) => {
      sprite.alpha = lighting.stars * (0.55 + 0.45 * Math.sin(time * (0.9 + i * 0.37) + i * 2.1));
    });

    // The sun rises and sets well inside the panorama, as in the dusk drawings,
    // and looks bigger near the horizon, in a wide glow.
    this.placeBody(this.sun, this.sunGlow, lighting.sun, 205, 150);
    const low = 1 - lighting.sun.elevation;
    this.sun.scale.set(low > 0.8 ? 2 : 1);
    this.sun.alpha = lighting.sun.visible ? 1 - weather.cloudCover * 0.85 : 0;
    this.sunGlow.alpha = lighting.sun.glow * (0.45 + 0.55 * low * low);
    this.placeBody(this.moon, this.moonGlow, lighting.moon, 170);
    this.moon.alpha = lighting.moon.visible ? lighting.moon.glow : 0;
    this.moonGlow.alpha = lighting.moon.glow * this.moonHaloStrength;

    this.updateClouds(dt, env);
  }

  private placeBody(body: Sprite, glow: Sprite, state: CelestialBody, arcHeight: number, inset = 70): void {
    body.visible = glow.visible = state.visible;
    if (!state.visible) return;
    const x = Math.round(lerp(inset, WORLD_WIDTH - inset, state.progress));
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
