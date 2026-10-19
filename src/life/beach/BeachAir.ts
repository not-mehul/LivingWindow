import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { lerpColor, multiplyColor } from '../../core/color';
import type { Viewport } from '../../core/Viewport';
import { PixelBuffer } from '../../core/pixelBuffer';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import type { Environment } from '../../scene/Environment';
import { bayer, valueNoise } from '../../scene/common/paint';
import { BEACH_HORIZON, beachPlane, BREAK_S, shoreCoords, shorePoint, shoreXAtY } from '../../sim/shore';
import { pixelHash } from '../../sprites/raster';
import type { LifeSoundSink } from '../types';

const r = (min: number, max: number) => min + Math.random() * (max - min);

/** How hard the sand is blowing (0..1): only in a real wind, and not once rain has wet it. */
export function sandDrift(wind: number, precipitation: number): number {
  const blow = Math.max(0, Math.min(1, (Math.abs(wind) - 0.2) / 0.35));
  return precipitation > 0.08 ? 0 : blow;
}

/** How thick the spray hangs over the surf (0..1): with the size of the sea and the wind off it. */
export function sprayHaze(energy: number, wind: number): number {
  return Math.min(1, 0.18 + energy * 0.6 + Math.abs(wind) * 0.3);
}

/** How strongly the far sand shimmers in the heat (0..1): the middle of a hot, clear, still day. */
export function heatShimmer(hours: number, cloudCover: number, precipitation: number, wind: number): number {
  const noon = Math.max(0, 1 - Math.abs(hours - 13.5) / 3);
  return noon * Math.max(0, 1 - cloudCover * 1.6) * (precipitation > 0.02 ? 0 : 1) * (1 - Math.min(1, Math.abs(wind)) * 0.6);
}

/** The rows the blowing sand runs over, and those the spray hangs over. */
const SAND_TOP = BEACH_HORIZON + 34;
const SAND_BOTTOM = 344;
const SAND_FPS = 15;
const SPRAY_FPS = 8;
/** Rows of the far sand that shimmer in the heat. */
const SHIMMER_TOP = BEACH_HORIZON + 1;
const SHIMMER_ROWS = 22;

/** sin(2π·t) for t in waves, from a table. */
const SIN_STEPS = 1024;
const SIN_TABLE = Float32Array.from({ length: SIN_STEPS }, (_, i) => Math.sin((i / SIN_STEPS) * Math.PI * 2));
const sinWaves = (t: number) => SIN_TABLE[Math.floor(t * SIN_STEPS) & (SIN_STEPS - 1)];

/** Blown sand, pale, in a few steps of thickness (RGBA little-endian). */
const SAND_STEPS = [0, 120, 180, 230].map((a) => ((a << 24) | (0xdc << 16) | (0xf2 << 8) | 0xfc) >>> 0);
/** Spray haze, in steps of veil (pale blue-white). */
const SPRAY_STEPS = [0, 26, 48, 72, 96].map((a) => ((a << 24) | (0xf4 << 16) | (0xf4 << 8) | 0xec) >>> 0);

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ground: number;
  hops: number;
}

interface Drifter {
  x: number;
  y: number;
  vx: number;
  phase: number;
  color: number;
  size: number;
  life: number;
}

interface Coconut {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ground: number;
  bounces: number;
  rest: number;
  pan: number;
}

/** What the air needs from the beach. */
export interface AirShore {
  readonly sandFx: Container;
  readonly airLayer: Container;
  readonly shimmerLayer: Container;
  readonly palmLayer: Container;
  readonly seaEnergy: number;
  /** The crowns of the near palms right now, and the ground under them. */
  palmCrowns(): Array<{ x: number; y: number; ground: number; scale: number }>;
  /** The far sand and scrub, as painted (for the shimmer to bend). */
  readonly farGround: PixelBuffer;
}

/**
 * The beach's air: on a blowy day, streamers of sand snaking low over the
 * dry beach downwind and grains hopping along it, a scrap of feather or
 * weed fluff bowling past; a haze of salt spray hanging over the breakers,
 * thicker in a big sea; now and then a coconut dropping out of a palm with a
 * thud; and in the heat of a still, clear afternoon, the far sand shimmering.
 */
export class BeachAir {
  private readonly sandCanvas: PixelCanvas;
  private readonly sandImage: ImageData;
  private readonly sandTexture: Texture;
  private readonly sandSprite: Sprite;
  /** The open dry sand's pixels (canvas index), each one's fixed streamer phase and its lane. */
  private readonly sandIndex: Uint32Array;
  private readonly sandPhase: Float32Array;
  private readonly sandLane: Float32Array;
  private readonly sandDither: Float32Array;
  private readonly sprayCanvas: PixelCanvas;
  private readonly sprayImage: ImageData;
  private readonly sprayTexture: Texture;
  private readonly spraySprite: Sprite;
  private readonly sprayTop: number;
  private readonly shimmerCanvas: PixelCanvas;
  private readonly shimmerImage: ImageData;
  private readonly shimmerTexture: Texture;
  private readonly shimmerSprite: Sprite;
  private readonly far: Uint32Array;
  private readonly grains: Grain[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly gfx = new Graphics();
  private readonly nutTexture: Texture[] = [];
  private readonly coconuts: Coconut[] = [];
  private sandTimer = 0;
  private sprayTimer = 0;
  private shimmerTimer = 0;
  private drift = 0;
  private coconutTimer = r(120, 400);
  private drifterTimer = 8;
  private shimmer = 0;

  constructor(
    private readonly shore: AirShore,
    private readonly viewport: Viewport,
    private readonly sound: LifeSoundSink,
  ) {
    // Blowing sand over the open beach: between the dunes and the wet sand.
    const w = WORLD_WIDTH;
    const h = SAND_BOTTOM - SAND_TOP;
    this.sandCanvas = new PixelCanvas(w, h);
    this.sandImage = this.sandCanvas.ctx.createImageData(w, h);
    this.sandTexture = createNearestTexture(this.sandCanvas.canvas);
    this.sandSprite = new Sprite(this.sandTexture);
    this.sandSprite.position.set(0, SAND_TOP);
    shore.sandFx.addChild(this.sandSprite);
    const idx: number[] = [];
    const phase: number[] = [];
    const lane: number[] = [];
    const dither: number[] = [];
    for (let y = 0; y < h; y++) {
      const wy = SAND_TOP + y + 0.5;
      for (let x = 0; x < w; x++) {
        const { depth, s } = shoreCoords(x + 0.5, wy);
        const dunes = -290 - 50 * Math.sin(depth * 1.9 + 0.5);
        if (s > -60 || s < dunes + 30) continue;
        const along = depth * 120;
        idx.push(y * w + x);
        // Streamers run with the wind (across the view), each one a thin wandering lane up the beach.
        phase.push((x - beachPlane.vanishX) / 140 + valueNoise(x, wy, 40, 811) * 0.6);
        lane.push(s / 5 + Math.sin((x + along) / 70) * 1.3 + valueNoise(x, wy, 25, 812) * 2);
        dither.push(bayer(x, y) * 0.8 + 0.1);
      }
    }
    this.sandIndex = Uint32Array.from(idx);
    this.sandPhase = Float32Array.from(phase);
    this.sandLane = Float32Array.from(lane);
    this.sandDither = Float32Array.from(dither);

    // Spray haze over the surf line.
    this.sprayTop = BEACH_HORIZON - 2;
    const sh = SAND_BOTTOM + 16 - this.sprayTop;
    this.sprayCanvas = new PixelCanvas(w, sh);
    this.sprayImage = this.sprayCanvas.ctx.createImageData(w, sh);
    this.sprayTexture = createNearestTexture(this.sprayCanvas.canvas);
    this.spraySprite = new Sprite(this.sprayTexture);
    this.spraySprite.position.set(0, this.sprayTop);
    shore.airLayer.addChild(this.spraySprite);

    // The far sand, ready to be bent by the heat.
    this.shimmerCanvas = new PixelCanvas(w, SHIMMER_ROWS);
    this.shimmerImage = this.shimmerCanvas.ctx.createImageData(w, SHIMMER_ROWS);
    this.shimmerTexture = createNearestTexture(this.shimmerCanvas.canvas);
    this.shimmerSprite = new Sprite(this.shimmerTexture);
    this.shimmerSprite.position.set(0, SHIMMER_TOP);
    this.shimmerSprite.visible = false;
    shore.shimmerLayer.addChild(this.shimmerSprite);
    const src = new Uint32Array(shore.farGround.data.buffer);
    this.far = src.slice(SHIMMER_TOP * w, (SHIMMER_TOP + SHIMMER_ROWS) * w);

    shore.airLayer.addChild(this.gfx);
    for (const size of [2, 3, 4, 5]) this.nutTexture.push(drawCoconut(size).toTexture());
  }

  get sandStrength(): number {
    return this.drift;
  }

  get shimmerLevel(): number {
    return this.shimmer;
  }

  get coconutCount(): number {
    return this.coconuts.length;
  }

  /** Drop a coconut now (for the gallery and tests). */
  /** Called where a coconut thumps down (world px). */
  onCoconut: ((x: number, y: number) => void) | null = null;

  dropCoconut(): void {
    this.coconutTimer = 0;
  }

  update(dt: number, env: Environment): void {
    const { weather, lighting } = env;
    const wind = weather.wind ?? 0.2;
    this.drift += (sandDrift(wind, weather.precipitation) - this.drift) * Math.min(1, dt * 0.4);
    const tint = lerpColor(lighting.ambient, 0xffffff, 0.1);
    this.sandSprite.tint = tint;
    this.spraySprite.tint = lerpColor(lerpColor(lighting.skyHorizon, 0xffffff, 0.5), lighting.ambient, 0.4);
    this.sandSprite.visible = this.drift > 0.02;
    this.sandTimer -= dt;
    if (this.sandSprite.visible && this.sandTimer <= 0) {
      this.sandTimer = 1 / (SAND_FPS * Math.max(0.5, quality.scale));
      this.drawSand(env.time, wind);
    }
    this.sprayTimer -= dt;
    if (this.sprayTimer <= 0) {
      this.sprayTimer = 1 / (SPRAY_FPS * Math.max(0.5, quality.scale));
      this.drawSpray(env.time, wind, sprayHaze(this.shore.seaEnergy, wind));
    }
    this.shimmer += (heatShimmer(lighting.hours, weather.cloudCover, weather.precipitation, wind) - this.shimmer) * Math.min(1, dt * 0.2);
    this.shimmerSprite.visible = this.shimmer > 0.05;
    this.shimmerTimer -= dt;
    if (this.shimmerSprite.visible && this.shimmerTimer <= 0) {
      this.shimmerTimer = 1 / 10;
      this.drawShimmer(env.time);
    }
    this.shimmerSprite.tint = lighting.ambient;
    this.updateGrains(dt, env, wind);
    this.updateCoconuts(dt, env, wind);
  }

  private drawSand(time: number, wind: number): void {
    const data = new Uint32Array(this.sandImage.data.buffer);
    data.fill(0);
    const dir = wind < 0 ? -1 : 1;
    // Streamers race downwind; the lanes themselves wander slowly.
    const run = dir * time * (0.4 + Math.abs(wind) * 0.6);
    const wander = time * 0.05;
    const k = this.drift;
    const { sandIndex, sandPhase, sandLane, sandDither } = this;
    for (let i = 0; i < sandIndex.length; i++) {
      const lane = sinWaves((sandLane[i] + wander) / (Math.PI * 2));
      if (lane < 0.5) continue;
      const crest = sinWaves(sandPhase[i] - run);
      if (crest < 0) continue;
      const along = sinWaves(sandPhase[i] * 0.37 - run * 0.31);
      const level = (lane - 0.5) * 2 * crest * (0.4 + 0.6 * Math.max(0, along)) * k * 3.4;
      const step = Math.floor(level + sandDither[i] - 0.4);
      if (step > 0) data[sandIndex[i]] = SAND_STEPS[step > 3 ? 3 : step];
    }
    this.sandCanvas.ctx.putImageData(this.sandImage, 0, 0);
    this.sandTexture.source.update();
  }

  private drawSpray(time: number, wind: number, level: number): void {
    const data = new Uint32Array(this.sprayImage.data.buffer);
    data.fill(0);
    const w = WORLD_WIDTH;
    const h = this.sprayCanvas.height;
    const drift = time * (4 + Math.abs(wind) * 14) * (wind < 0 ? -1 : 1);
    for (let y = 0; y < h; y++) {
      const wy = this.sprayTop + y;
      const depth = beachPlane.depthAtY(Math.max(BEACH_HORIZON + 0.6, wy + 4));
      const shoreX = shoreXAtY(wy + 4);
      // The haze lies over the breakers and the swash, lifted a little off the water.
      const from = Math.max(0, Math.floor(shoreX - 30 / depth));
      const to = Math.min(w, Math.ceil(shoreX + (BREAK_S + 70) / depth));
      const row = y * w;
      const far = Math.min(1, (wy - BEACH_HORIZON) / 40);
      for (let x = from; x < to; x++) {
        const s = (x - shoreX) * depth;
        // Thickest just inshore of the break, thinning both ways.
        const t = (s - (BREAK_S - 10)) / (s < BREAK_S - 10 ? 45 : 70);
        const profile = Math.max(0, 1 - t * t);
        if (profile <= 0) continue;
        const n = valueNoise(x + drift, wy * 2.4, 22, 830) * 0.65 + valueNoise(x + drift * 1.7, wy * 3, 9, 831) * 0.35;
        const v = profile * level * (0.5 + far * 0.5) * (0.3 + n * 1.2) * 4.2 + bayer(x, y) * 0.7 - 0.6;
        const step = Math.floor(v);
        if (step > 0) data[row + x] = SPRAY_STEPS[step > 4 ? 4 : step];
      }
    }
    this.sprayCanvas.ctx.putImageData(this.sprayImage, 0, 0);
    this.sprayTexture.source.update();
  }

  private drawShimmer(time: number): void {
    const data = new Uint32Array(this.shimmerImage.data.buffer);
    const w = WORLD_WIDTH;
    for (let y = 0; y < SHIMMER_ROWS; y++) {
      // Each row slides a pixel this way and that, rippling up through the hot air; nearer rows less.
      const fade = 1 - y / SHIMMER_ROWS;
      const wobble = Math.sin(time * 5.3 + y * 1.7) * 0.6 + Math.sin(time * 8.1 - y * 2.9) * 0.5;
      const shift = Math.round(wobble * this.shimmer * (0.4 + fade));
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const sx = Math.min(w - 1, Math.max(0, x + shift));
        const c = this.far[row + sx];
        // Where the shifted pixel is empty but this one isn't, leave this one as it is (by showing nothing).
        data[row + x] = c >>> 24 && this.far[row + x] >>> 24 ? c : 0;
      }
    }
    this.shimmerCanvas.ctx.putImageData(this.shimmerImage, 0, 0);
    this.shimmerTexture.source.update();
  }

  private updateGrains(dt: number, env: Environment, wind: number): void {
    const dir = wind < 0 ? -1 : 1;
    // Grains skipping over the sand: little hops downwind.
    if (this.drift > 0.05) {
      for (let n = 0; n < Math.floor(dt * 90 * this.drift + Math.random()); n++) {
        if (this.grains.length > 140) break;
        const y = r(SAND_TOP + 20, SAND_BOTTOM - 6);
        const { depth } = shoreCoords(0, y);
        const s = r(-280, -70);
        const p = shorePoint(depth, s);
        this.grains.push({ x: p.x, y: p.y, vx: dir * r(40, 90) * (0.4 + Math.abs(wind)) * p.scale, vy: -r(8, 22) * p.scale, ground: p.y, hops: Math.floor(r(1, 4)) });
      }
    }
    // A scrap of feather or a wisp of dry weed bowling past now and then.
    this.drifterTimer -= dt;
    if (this.drifterTimer <= 0 && Math.abs(wind) > 0.25 && env.weather.precipitation < 0.1) {
      this.drifterTimer = r(15, 50) / Math.abs(wind);
      const feather = Math.random() < 0.5;
      this.drifters.push({ x: dir > 0 ? -4 : WORLD_WIDTH + 4, y: r(250, 336), vx: dir * r(25, 50) * (0.5 + Math.abs(wind)), phase: Math.random() * 6, color: feather ? 0xf4f2ec : 0xb8a070, size: Math.random() < 0.5 ? 2 : 1, life: 0 });
    }
    const g = this.gfx;
    g.clear();
    const grainColor = multiplyColor(0xf4e8cc, env.lighting.ambient);
    for (let i = this.grains.length - 1; i >= 0; i--) {
      const q = this.grains[i];
      q.vy += 120 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.y >= q.ground) {
        q.y = q.ground;
        if (--q.hops <= 0) {
          this.grains.splice(i, 1);
          continue;
        }
        q.vy = -Math.abs(q.vy) * 0.7;
      }
      g.rect(Math.round(q.x), Math.round(q.y) - 1, 1, 1).fill({ color: grainColor, alpha: 0.75 });
    }
    for (let i = this.drifters.length - 1; i >= 0; i--) {
      const d = this.drifters[i];
      d.life += dt;
      d.x += d.vx * dt * (0.7 + 0.3 * Math.sin(d.life * 2.3 + d.phase));
      // Tumbling: up in a gust, skipping down again.
      d.y += Math.sin(d.life * 3.1 + d.phase) * dt * 10 + Math.sin(d.life * 0.7) * dt * 3;
      if (d.x < -10 || d.x > WORLD_WIDTH + 10 || d.life > 60) {
        this.drifters.splice(i, 1);
        continue;
      }
      g.rect(Math.round(d.x), Math.round(d.y), d.size, 1).fill({ color: multiplyColor(d.color, env.lighting.ambient), alpha: 0.9 });
    }
  }

  private updateCoconuts(dt: number, env: Environment, wind: number): void {
    this.coconutTimer -= dt;
    if (this.coconutTimer <= 0) {
      // Rare in a calm, more often in a blow.
      this.coconutTimer = r(240, 900) / (0.5 + Math.abs(wind) * 1.5);
      const crowns = this.shore.palmCrowns();
      const c = crowns[Math.floor(Math.random() * crowns.length)];
      if (c && this.coconuts.length < 4) {
        const size = Math.max(2, Math.min(5, Math.round(5 * c.scale)));
        const sprite = new Sprite({ texture: this.nutTexture[size - 2], anchor: { x: 0.5, y: 1 } });
        const ground = c.ground + r(0, 6) * c.scale;
        this.shore.palmLayer.addChild(sprite);
        this.coconuts.push({ sprite, x: c.x + r(-3, 3) * c.scale, y: c.y + 3 * c.scale, vx: wind * 6 * c.scale, vy: 0, ground, bounces: 2, rest: r(240, 600), pan: this.viewport.worldXToStereo(c.x) });
      }
    }
    for (let i = this.coconuts.length - 1; i >= 0; i--) {
      const n = this.coconuts[i];
      if (n.bounces >= 0) {
        n.vy += 260 * dt;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.y >= n.ground) {
          n.y = n.ground;
          if (n.bounces === 2) {
            this.sound('coconut-thud', n.pan, 0.55);
            this.onCoconut?.(n.x, n.y);
          }
          n.vy = -n.vy * 0.28;
          n.vx = n.vx * 0.5 + r(-6, 6);
          n.bounces--;
        }
      } else {
        // Rolling to a stop, then lying there a while before it's gone.
        n.vx *= Math.max(0, 1 - dt * 3);
        n.x += n.vx * dt;
        n.rest -= dt;
      }
      n.sprite.position.set(Math.round(n.x), Math.round(n.y));
      n.sprite.zIndex = n.ground + 0.5;
      n.sprite.tint = env.lighting.ambient;
      n.sprite.alpha = Math.min(1, n.rest / 10);
      if (n.rest <= 0) {
        n.sprite.destroy();
        this.coconuts.splice(i, 1);
      }
    }
  }
}

/** A coconut: a round brown husk, lit on top, dark beneath. */
export function drawCoconut(size: number): PixelBuffer {
  const p = new PixelBuffer(size + 2, size + 2);
  const c = (size + 1) / 2;
  for (let y = 0; y < size + 2; y++) {
    for (let x = 0; x < size + 2; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      if (dx * dx + dy * dy > (size / 2) ** 2 + 0.3) continue;
      const light = -dx * 0.5 - dy * 0.8 + (pixelHash(x, y, size) - 0.5) * 0.4;
      p.set(x, y, light > 0.6 ? 0x9a7a4a : light > -0.2 ? 0x6e5030 : 0x4a3420);
    }
  }
  p.outline(0x2a1e14);
  return p;
}
