import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import { bayer, valueNoise } from '../common/paint';
import type { Environment } from '../Environment';
import type { Placed } from './forestGenerator';
import { wrapHours } from '../../state/timeOfDay';

/** How thick the mist lies (0..1) at an hour: heavy at dawn, lingering into the night, burnt off by midday. */
export function mistDensity(hours: number, damp: number): number {
  const h = wrapHours(hours);
  let d: number;
  if (h < 4) d = 0.6;
  else if (h < 6.5) d = 0.6 + ((h - 4) / 2.5) * 0.4;
  else if (h < 9) d = 1 - ((h - 6.5) / 2.5) * 0.7;
  else if (h < 16) d = 0.3 - Math.sin(((h - 9) / 7) * Math.PI) * 0.12;
  else if (h < 20) d = 0.3 + ((h - 16) / 4) * 0.3;
  else d = 0.6;
  return Math.min(1, d + damp * 0.35);
}

interface Band {
  sprite: Sprite;
  canvas: PixelCanvas;
  image: ImageData;
  texture: Texture;
  /** World row of the band's top, and where it lies thickest (its foot). */
  top: number;
  foot: number;
  /** Drift speed (px/s at full wind) and how much of the density it carries. */
  drift: number;
  weight: number;
  offset: number;
  /** A tileable noise field the band scrolls across (0..1 per pixel). */
  noise: Float32Array;
  noiseWidth: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  ray: number;
}

/**
 * The wood's air: banks of mist lying between the rows of trunks (one
 * along the brow veiling the valley, others low among the trees), drifting
 * with the wind, thick at dawn and after rain, thin by midday; motes of
 * dust and pollen glinting where shafts of sun come through the canopy;
 * and on clear mornings, dew sparkling on the ferns.
 */
export class ForestAtmosphere {
  private readonly bands: Band[] = [];
  private readonly motes: Mote[] = [];
  readonly moteGfx = new Graphics();
  readonly dewGfx = new Graphics();
  private readonly dew: Array<{ x: number; y: number; phase: number }> = [];
  private timer = 0;
  private density = 0.5;

  constructor(
    midground: Container,
    ferns: readonly Placed[],
    private readonly rays: () => Array<{ x: number; alpha: number; mirrored: boolean; width: number }>,
  ) {
    // Bands sit between the rows of trunks (sorted with them by their foot), so nearer trunks stand out of the mist.
    for (const [i, b] of [
      { top: 196, foot: 266, drift: 3, weight: 1 },
      { top: 248, foot: 292, drift: 5, weight: 0.75 },
      { top: 286, foot: 318, drift: 7, weight: 0.55 },
      { top: 310, foot: 342, drift: 9, weight: 0.4 },
    ].entries()) {
      const h = b.foot - b.top + 6;
      const canvas = new PixelCanvas(WORLD_WIDTH, h);
      const image = canvas.ctx.createImageData(WORLD_WIDTH, h);
      const texture = createNearestTexture(canvas.canvas);
      const sprite = new Sprite(texture);
      sprite.position.set(0, b.top);
      sprite.zIndex = b.foot - 0.5;
      midground.addChild(sprite);
      const noiseWidth = 1024;
      const noise = new Float32Array(noiseWidth * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < noiseWidth; x++) {
          // Two octaves, tileable across the width: long soft wisps.
          const a = tile(x, y, noiseWidth, 90, 11, 70 + i);
          const c = tile(x, y, noiseWidth, 30, 5, 80 + i);
          noise[y * noiseWidth + x] = a * 0.7 + c * 0.3;
        }
      }
      this.bands.push({ sprite, canvas, image, texture, ...b, offset: Math.random() * noiseWidth, noise, noiseWidth });
    }
    // Dew: points on the front ferns' fronds.
    for (const f of ferns) {
      for (let k = 0; k < 4; k++) {
        const x = Math.floor(Math.random() * f.art.width);
        const y = Math.floor(Math.random() * f.art.height * 0.6);
        if (f.art.isSet(x, y)) this.dew.push({ x: Math.round(f.x + x), y: Math.round(f.y + y), phase: Math.random() * 6 });
      }
    }
  }

  get mist(): number {
    return this.density;
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather } = env;
    const damp = Math.min(1, weather.precipitation * 1.5 + Math.max(0, weather.cloudCover - 0.6));
    const want = mistDensity(lighting.hours, damp);
    this.density += (want - this.density) * Math.min(1, dt * 0.2);
    // The mist takes the light: pale by day, glowing pink at dawn, blue under the moon.
    const tint = lerpColor(lerpColor(0xffffff, lighting.haze, 0.4), lighting.ambient, 0.4);
    const wind = weather.wind ?? 0.2;
    for (const b of this.bands) {
      b.offset += dt * b.drift * (0.25 + Math.abs(wind)) * (wind < 0 ? -1 : 1);
      b.sprite.tint = tint;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1 / (10 * Math.max(0.5, quality.scale));
      for (const b of this.bands) this.draw(b, env.time);
    }
    this.updateMotes(dt, env);
    this.updateDew(env);
  }

  private draw(b: Band, time: number): void {
    const data = new Uint32Array(b.image.data.buffer);
    const w = WORLD_WIDTH;
    const h = b.canvas.height;
    const level = this.density * b.weight;
    const off = Math.floor(((b.offset % b.noiseWidth) + b.noiseWidth) % b.noiseWidth);
    const breathe = 0.9 + 0.1 * Math.sin(time * 0.15 + b.foot);
    for (let y = 0; y < h; y++) {
      // Thickest at the band's foot, thinning upwards into wisps.
      const u = y / h;
      const profile = u ** 1.15 * (1 - Math.max(0, u - 0.92) * 8);
      const k = level * breathe * profile * 6.5;
      const rowOut = y * w;
      // Too thin to show anywhere on this row.
      if (k * 1.7 < 1) {
        data.fill(0, rowOut, rowOut + w);
        continue;
      }
      const row = y * b.noiseWidth;
      const dith = DITHER_ROWS[y & 3];
      const mask = b.noiseWidth - 1;
      for (let x = 0; x < w; x++) {
        // Soft, in a few stepped shades of veil (like painted fog), with a touch of dither on the steps' edges.
        const step = Math.floor(k * (0.45 + b.noise[row + ((x + off) & mask)] * 1.25) + dith[x & 3]);
        data[rowOut + x] = MIST_STEPS[step > 6 ? 6 : step];
      }
    }
    b.canvas.ctx.putImageData(b.image, 0, 0);
    b.texture.source.update();
  }

  private updateMotes(dt: number, env: Environment): void {
    const rays = this.rays();
    const lit = rays.some((r) => r.alpha > 0.05);
    if (lit && this.motes.length < 60 && Math.random() < dt * 14) {
      const k = Math.floor(Math.random() * rays.length);
      const r = rays[k];
      if (r.alpha > 0.05) {
        const y = 40 + Math.random() * 200;
        // Inside the shaft: it slants with the sun.
        const x = r.x + (r.mirrored ? -1 : 1) * (y - 10) * 0.55 + (r.mirrored ? -1 : 1) * Math.random() * r.width;
        this.motes.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.6) * 1.2, phase: Math.random() * 6, ray: k });
      }
    }
    const g = this.moteGfx;
    g.clear();
    const wind = env.weather.wind ?? 0.2;
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.phase += dt;
      m.x += (m.vx + wind * 2 + Math.sin(m.phase * 0.8) * 1.5) * dt;
      m.y += (m.vy + Math.cos(m.phase * 0.6) * 0.8) * dt;
      const r = rays[m.ray];
      const life = Math.min(1, m.phase / 2) * Math.min(1, Math.max(0, 14 - m.phase) / 3);
      if (m.phase > 14 || !r) {
        this.motes.splice(i, 1);
        continue;
      }
      // They glint as they turn in the light.
      const glint = 0.5 + 0.5 * Math.sin(m.phase * 5 + i);
      g.rect(Math.round(m.x), Math.round(m.y), 1, 1).fill({ color: 0xfff4d0, alpha: r.alpha * life * (0.35 + glint * 0.65) });
    }
  }

  private updateDew(env: Environment): void {
    const g = this.dewGfx;
    g.clear();
    const h = env.lighting.hours;
    const morning = h > 5.5 && h < 9.5 ? Math.min(1, (h - 5.5) * 2) * Math.min(1, (9.5 - h) * 1.5) : 0;
    const sun = env.lighting.sun.visible ? 1 - env.weather.cloudCover * 0.8 : 0;
    const level = morning * sun * (env.weather.precipitation > 0.1 ? 0 : 1);
    if (level <= 0.02) return;
    for (const d of this.dew) {
      const s = Math.sin(env.time * 2.2 + d.phase * 7);
      if (s < 0.75) continue;
      g.rect(d.x, d.y, 1, 1).fill({ color: 0xffffff, alpha: level * (s - 0.75) * 4 });
    }
  }
}

/** The 4×4 ordered-dither thresholds, scaled to nudge a mist step up. */
const DITHER_ROWS = [0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => bayer(x, y) * 0.6));

/** Mist pixels by thickness (RGBA little-endian): ever more opaque veils of pale grey-green. */
const MIST_STEPS = [0, 40, 74, 106, 136, 164, 190].map((a) => ((a << 24) | (0xec << 16) | (0xf0 << 8) | 0xe8) >>> 0);

/** Value noise that wraps across `width`, for a band of mist to scroll through seamlessly. */
function tile(x: number, y: number, width: number, cellX: number, cellY: number, seed: number): number {
  const a = valueNoise(x, y * (cellX / cellY), cellX, seed);
  const b = valueNoise(x - width, y * (cellX / cellY), cellX, seed);
  const t = x / width;
  return a * (1 - t) + b * t;
}
