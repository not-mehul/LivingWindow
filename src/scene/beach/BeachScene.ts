import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { channels, lerpColor, multiplyColor, pack } from '../../core/color';
import { Emitter } from '../../core/Emitter';
import { lerp } from '../../core/math';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { createRng, randomInt, randomRange } from '../../core/random';
import type { Ledge } from '../../life/types';
import { pixelHash } from '../../sprites/raster';
import { WaveModel, type BreakEvent } from '../../sim/waves';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';

export const BEACH_HORIZON = 196;
/** Where the swells break. */
export const BREAK_Y = 282;
/** The still-water line on the sand. */
export const SHORE_Y = 288;
const WATER_BOTTOM = 336;
const WATER_HEIGHT = WATER_BOTTOM - BEACH_HORIZON;
/** Rebuild the water texture at this rate (it's the heaviest per-frame work). */
const WATER_FPS = 30;
const DRY_RATE = 0.7;

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export interface BeachEvents {
  break: BreakEvent & { pan: number };
}

function drawSand(rng: () => number): PixelCanvas {
  const c = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  c.rect(0, BREAK_Y - 6, WORLD_WIDTH, WORLD_HEIGHT, '#e2c994');
  for (let y = BREAK_Y - 6; y < WORLD_HEIGHT; y++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const h = pixelHash(x, y, 17);
      if (h < 0.05) c.px(x, y, '#d0b47a');
      else if (h < 0.07) c.px(x, y, '#f0dcae');
    }
  }
  // Gentle dune rising at the bottom.
  for (let x = 0; x < WORLD_WIDTH; x++) {
    const top = 334 + Math.round(Math.sin(x * 0.012) * 6 + Math.sin(x * 0.031) * 3);
    c.vline(x, top, WORLD_HEIGHT - top, '#d6bc84');
    c.px(x, top, '#ecd6a4');
  }
  // Tide pools reflecting the sky, and scattered shells.
  for (let i = 0; i < 5; i++) {
    const px = randomInt(rng, 40, WORLD_WIDTH - 40);
    const py = randomInt(rng, 318, 328);
    const w = randomInt(rng, 8, 16);
    c.ctx.fillStyle = '#8ab8c8';
    c.ctx.beginPath();
    c.ctx.ellipse(px, py, w, 2, 0, 0, Math.PI * 2);
    c.ctx.fill();
    c.hline(px - w + 3, py - 1, Math.floor(w / 2), '#c8e4ec');
  }
  for (let i = 0; i < 40; i++) {
    c.px(randomInt(rng, 0, WORLD_WIDTH), randomInt(rng, 300, 345), rng() < 0.5 ? '#f8f0e4' : '#e8a890');
  }
  return c;
}

function drawProps(rng: () => number, ledges: Ledge[]): PixelCanvas {
  const c = new PixelCanvas(WORLD_WIDTH, WORLD_HEIGHT);
  // An old groyne: weathered posts marching into the surf.
  for (let i = 0; i < 7; i++) {
    const x = 560 + i * 22;
    const top = 286 - i * 3 + randomInt(rng, -2, 2);
    const bottom = SHORE_Y + 10 - i * 2;
    c.rect(x, top, 4, bottom - top, '#6a5a48');
    c.vline(x, top, bottom - top, '#8a7a64');
    c.vline(x + 3, top, bottom - top, '#4a3e32');
    c.hline(x, top, 4, '#a89a84');
    ledges.push({ x0: x, x1: x + 3, y: top, layer: 'mid', kind: 'post', z: 0.7 });
  }
  // Driftwood on the dry sand.
  const dx = 150;
  const dy = 318;
  c.rect(dx, dy, 46, 4, '#a8987e');
  c.hline(dx, dy, 46, '#c8bca4');
  c.hline(dx, dy + 3, 46, '#7a6c58');
  for (let i = 0; i < 10; i++) c.px(dx + 40 + i, dy - Math.round(i * 0.6), '#a8987e');
  ledges.push({ x0: dx + 3, x1: dx + 42, y: dy, layer: 'near', kind: 'log', z: 0.6 });
  return c;
}

function grassTuft(rng: () => number): PixelCanvas {
  const w = randomInt(rng, 12, 22);
  const h = randomInt(rng, 12, 20);
  const c = new PixelCanvas(w, h);
  for (let i = 0; i < randomInt(rng, 5, 9); i++) {
    const baseX = w / 2 + randomRange(rng, -3, 3);
    const lean = randomRange(rng, -0.6, 0.6);
    const len = randomRange(rng, h * 0.6, h);
    for (let t = 0; t < len; t++) {
      c.px(Math.round(baseX + lean * t + (t / len) ** 2 * lean * 4), h - 1 - t, t > len * 0.6 ? '#c8c070' : '#8a9a50');
    }
  }
  return c;
}

/**
 * Scene 3: the beach, from a weathered beach-house window. The sea's swells
 * roll in, break and wash up the sand (leaving it wet to dry slowly), with
 * a glitter path under the sun or moon.
 */
export class BeachScene extends Emitter<BeachEvents> implements WorldScene {
  readonly container = new Container({ label: 'beach-scene' });
  readonly sky = new Sky({ horizonY: BEACH_HORIZON, seed: 909 });
  readonly horizonY = BEACH_HORIZON;
  readonly groundY = [SHORE_Y + 4, 335] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  /** Fish under the shallows, dolphins at the horizon, splashes. */
  readonly fishLayer = new Graphics();
  readonly horizonLayer = new Container({ label: 'horizon-life' });
  readonly splashLayer = new Graphics();
  /** Turtles and shorebirds on the sand. */
  readonly shoreLayer = new Container({ label: 'shore-life' });
  readonly ledges: Ledge[] = [];
  readonly waves: WaveModel;

  private readonly sand: Sprite;
  private readonly props: Sprite;
  private readonly water: Sprite;
  private readonly waterCanvas = new PixelCanvas(WORLD_WIDTH, WATER_HEIGHT);
  private readonly waterImage: ImageData;
  private readonly waterTexture: Texture;
  private readonly wetLine = new Float32Array(WORLD_WIDTH).fill(SHORE_Y);
  private readonly grass: SwayMesh[] = [];
  private readonly grassLayer = new Container();
  private waterTimer = 0;
  private tick = 0;
  private readonly splashes: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

  constructor() {
    super();
    const rng = createRng(2718);
    this.waves = new WaveModel(createRng(31));
    this.sand = new Sprite(createNearestTexture(drawSand(rng).canvas));
    this.props = new Sprite(createNearestTexture(drawProps(rng, this.ledges).canvas));
    this.ledges.push({ x0: 0, x1: WORLD_WIDTH - 1, y: 316, layer: 'near', kind: 'sand', z: 0.66 });

    this.waterImage = this.waterCanvas.ctx.createImageData(WORLD_WIDTH, WATER_HEIGHT);
    this.waterTexture = createNearestTexture(this.waterCanvas.canvas);
    this.water = new Sprite(this.waterTexture);
    this.water.y = BEACH_HORIZON;

    for (let x = 0; x < WORLD_WIDTH; x += randomInt(rng, 26, 60)) {
      const tuft = grassTuft(rng);
      const sway = new SwayMesh(tuft.toTexture(), { anchor: 'bottom', amplitude: 3, frequency: 1.6 });
      sway.mesh.position.set(x, WORLD_HEIGHT - tuft.height - randomInt(rng, 0, 8));
      this.grass.push(sway);
      this.grassLayer.addChild(sway.mesh);
    }

    this.container.addChild(
      this.sky.container,
      this.sand,
      this.water,
      this.fishLayer,
      this.horizonLayer,
      this.birdsFar,
      this.props,
      this.birdsMid,
      this.splashLayer,
      this.shoreLayer,
      this.weatherBack,
      this.birdsNear,
      this.grassLayer,
      this.weatherFront,
    );
  }

  /** Where the water's edge is right now at column x (world y). */
  waterlineAt(x: number): number {
    return SHORE_Y + this.waves.runUp(Math.round(x));
  }

  /** How far up the sand is still wet at column x (world y). */
  wetLineAt(x: number): number {
    const i = Math.max(0, Math.min(WORLD_WIDTH - 1, Math.round(x)));
    return this.wetLine[i];
  }

  /** A burst of spray (a diving gull, a breaching dolphin). */
  splash(x: number, y: number, size = 1): void {
    for (let i = 0; i < 10 * size; i++) {
      this.splashes.push({ x, y, vx: (Math.random() - 0.5) * 30 * size, vy: -20 - Math.random() * 30 * size, life: 0.6 + Math.random() * 0.4 });
    }
  }

  update(dt: number, env: Environment): void {
    const { lighting, weather, time } = env;
    this.sky.update(dt, env);
    this.sand.tint = lighting.ambient;
    this.props.tint = lighting.ambient;
    this.grassLayer.tint = lighting.ambient;
    for (const g of this.grass) g.update(time * 1.2, weather.wind);

    const energy = Math.min(1, Math.abs(weather.wind) * 0.8 + weather.lightning * 0.6 + (weather.kind === 'rain' ? 0.15 : 0));
    for (const event of this.waves.update(dt, energy)) {
      this.emit('break', { ...event, pan: (Math.random() - 0.5) * 0.8 });
    }
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const reach = SHORE_Y + this.waves.runUp(x);
      this.wetLine[x] = Math.max(SHORE_Y, Math.max(reach, this.wetLine[x] - DRY_RATE * dt));
    }

    this.waterTimer -= dt;
    if (this.waterTimer <= 0) {
      this.waterTimer = 1 / WATER_FPS;
      this.tick++;
      this.drawWater(env);
    }
    this.updateSplashes(dt, lighting.ambient);
  }

  private drawWater(env: Environment): void {
    const { lighting } = env;
    const amb = lighting.ambient;
    const seaFar = lerpColor(lighting.skyHorizon, multiplyColor(0x245a92, amb), 0.65);
    const seaNear = lerpColor(lighting.skyHorizon, multiplyColor(0x2c7896, amb), 0.25);
    const shallow = multiplyColor(0x52aab0, amb);
    const crest = lerpColor(seaNear, multiplyColor(0xd8eef2, amb), 0.55);
    const foam = lerpColor(multiplyColor(0xf6f8f6, amb), 0xffffff, 0.15 + 0.2 * (1 - lighting.darkness));
    const sheet = lerpColor(multiplyColor(0xd8c08a, amb), multiplyColor(0x9ad4d4, amb), 0.55);
    const wet = multiplyColor(0xa8885a, amb);

    // Glitter path under the sun (or the moon, faintly).
    const body = lighting.sun.visible && lighting.sun.elevation > 0.02 ? lighting.sun : lighting.moon.visible ? lighting.moon : null;
    const glintX = body ? lerp(70, WORLD_WIDTH - 70, body.progress) : -999;
    const glintStrength = body === lighting.sun ? body.glow * 1.2 + 0.2 : body ? body.glow * 0.6 : 0;
    const glint = body ? lerpColor(body.color, 0xffffff, 0.3) : 0xffffff;

    const swells = this.waves.swells();
    const breakers = this.waves.breakers();
    const data = this.waterImage.data;
    data.fill(0);
    const put = (x: number, row: number, color: number, alpha = 255) => {
      const k = (row * WORLD_WIDTH + x) * 4;
      const [r, g, b] = channels(color);
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = alpha;
    };

    for (let x = 0; x < WORLD_WIDTH; x++) {
      const reach = SHORE_Y + this.waves.runUp(x);
      const wetTo = this.wetLine[x];
      for (let y = BEACH_HORIZON; y < WATER_BOTTOM; y++) {
        const row = y - BEACH_HORIZON;
        const dither = (BAYER[y & 3][x & 3] + 0.5) / 16;
        if (y < SHORE_Y) {
          // Open sea, banded and dithered from the horizon to the shallows.
          // Banded colour steps with ordered dithering between them.
          const t = (y - BEACH_HORIZON) / (SHORE_Y - BEACH_HORIZON);
          const level = t ** 0.8 * 5;
          const step = Math.floor(level) + (level % 1 > dither ? 1 : 0);
          let color = lerpColor(seaFar, seaNear, Math.min(5, step) / 5);
          if (y > BREAK_Y - 10) color = lerpColor(color, shallow, (y - (BREAK_Y - 10)) / (SHORE_Y - BREAK_Y + 10));
          // Swell crests rolling in.
          for (const p of swells) {
            const sy = lerp(BEACH_HORIZON + 14, BREAK_Y, p ** 1.6) + Math.sin(x * 0.02 + p * 9) * 1.5;
            if (Math.abs(y - sy) < 0.5 + p) color = crest;
            else if (y - sy > 0 && y - sy < 1.5 + p) color = lerpColor(color, seaFar, 0.3);
          }
          // Breaking waves churn into foam.
          for (const b of breakers) {
            const fy = lerp(BREAK_Y, SHORE_Y + 2, b.progress);
            const thick = 2.5 * (1 - b.progress) + 1;
            if (Math.abs(y - fy) < thick && pixelHash(x, y + this.tick, Math.floor(b.seed)) > 0.25) color = foam;
          }
          // Sun or moon glitter: short horizontal sparkles fanning out towards the shore.
          if (glintStrength > 0.05 && y > BEACH_HORIZON + 1) {
            const half = 5 + (y - BEACH_HORIZON) * 0.45;
            const off = Math.abs(x - glintX);
            if (off < half && pixelHash(Math.floor(x / 3), y, this.tick) > 1 - 0.07 * glintStrength * (1 - off / half)) {
              color = glint;
            }
          }
          put(x, row, color);
        } else if (y < reach) {
          // The thin sheet of a wave washing up the sand, edged with lacy foam.
          const atEdge = reach - y < 2;
          put(x, row, atEdge && pixelHash(x, y, this.tick >> 1) > 0.3 ? foam : sheet, atEdge ? 255 : 220);
        } else if (y < wetTo) {
          // Darker wet sand, drying back from its top edge.
          const fade = (wetTo - y) / Math.max(1, wetTo - SHORE_Y);
          if (fade > dither * 0.5) put(x, row, wet, 235);
        }
      }
    }
    this.waterCanvas.ctx.putImageData(this.waterImage, 0, 0);
    this.waterTexture.source.update();
  }

  private updateSplashes(dt: number, tint: number): void {
    const g = this.splashLayer;
    g.clear();
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
        continue;
      }
      s.vy += 120 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill({ color: lerpColor(tint, 0xffffff, 0.5), alpha: Math.min(1, s.life * 2) });
    }
  }
}

/** Shared helper for the darker-than-water fish colour. */
export function fishColor(ambient: number): number {
  const [r, g, b] = channels(multiplyColor(0x1e4a5a, ambient));
  return pack(r, g, b);
}
