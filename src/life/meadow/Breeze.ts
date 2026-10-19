import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import type { Environment } from '../../scene/Environment';
import { bayer } from '../../scene/common/paint';
import { FOCAL } from '../../sim/groundPlane';
import { meadowPlane } from '../../sim/meadowGeometry';
import { rand as r } from '../../core/random';

const LEAVES = [0xc8762a, 0xd8a040, 0x9a5a2a, 0xb84a2a];

/** The pasture rows the gusts run over (world y), from the far field to the flower bank. */
const TOP = 196;
const BOTTOM = 304;
/** Gust wavelength across the grass (ground px). */
const WAVELENGTH = 210;
const FPS = 12;
/** The light a crest adds (RGBA bytes, little-endian: a faint green lift, opaque for the additive blend). */
const GUST_PIXEL = (255 << 24) | (12 << 16) | (34 << 8) | 26;

/**
 * How bright the gust crests are at a point (0..1): bands of wind running
 * across the grass with the wind, the blades bent over showing their pale
 * undersides. `along` is ground px across the view, `z` ground px away.
 */
export function gustLevel(along: number, z: number, time: number, wind: number): number {
  const crest = Math.max(0, Math.sin((gustBase(along, z) - gustPhase(time, wind)) * Math.PI * 2)) ** 6;
  // Gusts come and go: patches of the field catch it while others lie still.
  const patch = 0.55 + 0.45 * Math.sin(along / 1300 + z / 700 - time * 0.11 * (wind < 0 ? -1 : 1));
  return crest * patch;
}

/** The part of a point's gust phase (in waves) that stays put: where it lies, with the bands bending across the field. */
function gustBase(along: number, z: number): number {
  return along / WAVELENGTH + 0.9 * Math.sin(z / 260) + 0.4 * Math.sin(z / 97 + along / 900);
}

/** How far the bands have travelled by `time` (in waves), downwind. */
function gustPhase(time: number, wind: number): number {
  const speed = 40 + Math.min(1.2, Math.abs(wind)) * 220;
  return (wind < 0 ? -1 : 1) * ((time * speed) / WAVELENGTH);
}

/** sin(2π·t) for t in waves, from a table: the gusts are redrawn a dozen times a second over a whole field. */
const SIN_STEPS = 1024;
const SIN_TABLE = Float32Array.from({ length: SIN_STEPS }, (_, i) => Math.sin((i / SIN_STEPS) * Math.PI * 2));
const sinWaves = (t: number) => SIN_TABLE[Math.floor(t * SIN_STEPS) & (SIN_STEPS - 1)];

interface Mote {
  x: number;
  y: number;
  vx: number;
  phase: number;
  color: number;
  life: number;
}

/**
 * Wind through the meadow: gusts rolling over the grass as soft bands of
 * light that travel with the wind (strong and quick in a blow, slow swells
 * on a still day), and on breezy days seed fluff and petals drifting past in
 * front of the window in spring and summer, leaves in the autumn.
 */
export class Breeze {
  private readonly canvas: PixelCanvas;
  private readonly image: ImageData;
  private readonly texture: Texture;
  readonly sprite: Sprite;
  /** Each pixel's fixed gust phase, and its patchiness phase (both in waves). */
  private readonly base: Float32Array;
  private readonly patch: Float32Array;
  private readonly dither: Float32Array;
  private timer = 0;
  private readonly motes: Mote[] = [];
  private readonly moteGfx = new Graphics();
  private moteTimer = 0;
  private strength = 0;

  constructor(groundFx: Container, front: Container) {
    const w = WORLD_WIDTH;
    const h = BOTTOM - TOP;
    this.canvas = new PixelCanvas(w, h);
    this.image = this.canvas.ctx.createImageData(w, h);
    this.texture = createNearestTexture(this.canvas.canvas);
    this.sprite = new Sprite({ texture: this.texture, blendMode: 'add' });
    this.sprite.position.set(0, TOP);
    groundFx.addChild(this.sprite);
    front.addChild(this.moteGfx);
    this.base = new Float32Array(w * h);
    this.patch = new Float32Array(w * h);
    this.dither = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const depth = meadowPlane.depthAtY(TOP + y + 0.5);
      const z = depth * FOCAL;
      for (let x = 0; x < w; x++) {
        const along = (x + 0.5 - meadowPlane.vanishX) * depth;
        this.base[y * w + x] = gustBase(along, z);
        this.patch[y * w + x] = (along / 1300 + z / 700) / (Math.PI * 2);
        this.dither[y * w + x] = bayer(x, y) * 0.9 + 0.08;
      }
    }
  }

  update(dt: number, env: Environment): void {
    const { weather, lighting } = env;
    const wind = weather.wind ?? 0.2;
    // Calm in the snow (it lies on the grass), and the bands fade out in the dark.
    const want = weather.kind === 'snow' ? 0 : Math.min(1, 0.35 + Math.abs(wind) * 0.9);
    this.strength += (want - this.strength) * Math.min(1, dt * 0.5);
    this.sprite.tint = lerpColor(0x000000, lighting.ambient, 0.25 + 0.75 * (1 - lighting.nightness));
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 1 / (FPS * Math.max(0.5, quality.scale));
      this.draw(env.time, wind);
    }
    this.updateMotes(dt, env, wind);
  }

  private draw(time: number, wind: number): void {
    const data = new Uint32Array(this.image.data.buffer);
    const w = WORLD_WIDTH;
    const h = BOTTOM - TOP;
    const phase = gustPhase(time, wind);
    const drift = (time * 0.11 * (wind < 0 ? -1 : 1)) / (Math.PI * 2);
    const { base, patch, dither } = this;
    for (let y = 0; y < h; y++) {
      // Nearer rows show the bands stronger (the grass is right there); far off they're a faint shimmer.
      const amp = this.strength * (0.35 + 0.65 * (y / h));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let lit = false;
        const c = sinWaves(base[i] - phase);
        if (c > 0) {
          const c2 = c * c;
          const level = c2 * c2 * c2 * amp;
          // Only work out the patchiness where a crest could show.
          if (level > dither[i]) lit = level * (0.55 + 0.45 * sinWaves(patch[i] - drift)) > dither[i];
        }
        data[i] = lit ? GUST_PIXEL : 0;
      }
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  private updateMotes(dt: number, env: Environment, wind: number): void {
    const month = new Date().getMonth();
    const season = month >= 3 && month <= 10;
    const autumn = month >= 9;
    const day = env.lighting.nightness < 0.4 && env.weather.precipitation < 0.2;
    if (season && day && Math.abs(wind) > 0.12) {
      this.moteTimer -= dt;
      if (this.moteTimer <= 0) {
        this.moteTimer = r(0.6, 2.4) / Math.min(1.5, Math.abs(wind) * 2);
        const dir = wind < 0 ? -1 : 1;
        // Blossom petals in the spring, dandelion clocks into the summer, thistledown late in it.
        // In the autumn, leaves off the oaks instead.
        const color = autumn
          ? LEAVES[Math.floor(Math.random() * LEAVES.length)]
          : month <= 4 && Math.random() < 0.6
            ? Math.random() < 0.5
              ? 0xf8e0e8
              : 0xffffff
            : month >= 7 && Math.random() < 0.5
              ? 0xf0ece0
              : 0xffffff;
        this.motes.push({ x: dir > 0 ? -4 : WORLD_WIDTH + 4, y: r(200, 320), vx: dir * r(14, 30) * (0.5 + Math.abs(wind)), phase: Math.random() * 6, color, life: 0 });
      }
    }
    const g = this.moteGfx;
    g.clear();
    for (let k = this.motes.length - 1; k >= 0; k--) {
      const m = this.motes[k];
      m.life += dt;
      m.x += m.vx * dt;
      m.y += Math.sin(m.life * 1.6 + m.phase) * dt * 4 - dt * 0.6;
      if (m.x < -10 || m.x > WORLD_WIDTH + 10 || m.life > 80) {
        this.motes.splice(k, 1);
        continue;
      }
      // Nearer the window they're bigger and quicker.
      const size = m.y > 290 ? 2 : 1;
      g.rect(Math.round(m.x), Math.round(m.y), size, size).fill({ color: m.color, alpha: 0.85 });
    }
    g.tint = lerpColor(env.lighting.ambient, 0xffffff, 0.3);
  }
}
