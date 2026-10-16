import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../../config';
import { channels, lerpColor, multiplyColor, pack } from '../../core/color';
import { Emitter } from '../../core/Emitter';
import { lerp } from '../../core/math';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import { quality } from '../../core/quality';
import { createRng } from '../../core/random';
import type { Ledge } from '../../life/types';
import { BEACH_HORIZON, beachPlane, BREAK_S, SHALLOWS_S, shorePoint, shoreXAtY } from '../../sim/shore';
import { WaveModel, type BreakEvent } from '../../sim/waves';
import { pixelHash } from '../../sprites/raster';
import { bayer } from '../common/paint';
import { DayNightSprite, type NightGrade } from '../common/night';
import { SwayMesh } from '../common/SwayMesh';
import type { Environment } from '../Environment';
import { Sky } from '../sky/Sky';
import type { WorldScene } from '../WorldScene';
import { generateBeach, type BeachLayout } from './beachGenerator';

export { BEACH_HORIZON };

/** Moonlit grades for the beach's layers, after the night drawing. */
const NIGHT: Record<'land' | 'sand' | 'scrub' | 'props', NightGrade> = {
  land: { desaturate: 0.5, tint: [0.3, 0.36, 0.46], lift: [8, 10, 22] },
  // Sand glows a pale lavender grey under the moon.
  sand: { desaturate: 0.85, tint: [0.52, 0.52, 0.6], lift: [12, 12, 24] },
  scrub: { desaturate: 0.55, tint: [0.36, 0.42, 0.46], lift: [6, 8, 14] },
  props: { desaturate: 0.7, tint: [0.56, 0.56, 0.64], lift: [8, 8, 16] },
};
const NIGHT_PLANTS = 0x4c5c66;

const WATER_TOP = BEACH_HORIZON + 1;
const WATER_HEIGHT = WORLD_HEIGHT - WATER_TOP;
/** Rebuild the water texture at this rate (it's the heaviest per-frame work). */
const WATER_FPS = 30;
/** Wet sand dries back this fast (ground px per second). */
const DRY_RATE = 1.6;
/** Old run-up figures were screen px at the shore; across the shore they are this many ground px. */
const RUN_UP_SCALE = 2.4;
/** Swells first show this far out (ground px). */
const SWELL_START = 820;

export interface BeachEvents {
  break: BreakEvent & { pan: number };
}

/**
 * Scene 3: the beach, after the reference drawing. Palms lean in over a dune
 * path on the left; the beach runs away to a wooded point on the horizon;
 * the sea lies to the right, its swells rolling in parallel to the curving
 * shore, breaking, washing up the sand (leaving it wet to dry slowly), with a
 * glitter path under the sun or moon.
 */
export class BeachScene extends Emitter<BeachEvents> implements WorldScene {
  readonly container = new Container({ label: 'beach-scene' });
  readonly sky = new Sky({ horizonY: BEACH_HORIZON, seed: 909, milkyWay: true });
  readonly horizonY = BEACH_HORIZON;
  readonly groundY = [BEACH_HORIZON + 10, 340] as const;
  readonly weatherBack = new Container({ label: 'weather-back' });
  readonly weatherFront = new Container({ label: 'weather-front' });
  readonly birdsFar = new Container({ label: 'birds-far' });
  readonly birdsMid = new Container({ label: 'birds-mid' });
  readonly birdsNear = new Container({ label: 'birds-near' });
  /** Fish under the shallows, dolphins at the horizon, splashes. */
  readonly fishLayer = new Graphics();
  readonly horizonLayer = new Container({ label: 'horizon-life' });
  readonly splashLayer = new Graphics();
  /** Turtles and shorebirds on the sand, sorted by depth. */
  readonly shoreLayer = new Container({ label: 'shore-life', sortableChildren: true });
  readonly ledges: Ledge[];
  readonly waves: WaveModel;
  readonly layout: BeachLayout;

  private readonly land: DayNightSprite;
  private readonly sand: DayNightSprite;
  private readonly scrub: DayNightSprite;
  private readonly props: DayNightSprite;
  private readonly dune: DayNightSprite;
  private readonly water: Sprite;
  private readonly waterCanvas = new PixelCanvas(WORLD_WIDTH, WATER_HEIGHT);
  private readonly waterImage: ImageData;
  private readonly waterTexture: Texture;
  /** Per world row (along the beach): how far up the sand is still wet, in ground px. */
  private readonly wetLine = new Float32Array(WATER_HEIGHT);
  private readonly palms: Array<{ sway: SwayMesh; haze: number }> = [];
  private readonly palmLayer = new Container({ label: 'palms', sortableChildren: true });
  private readonly tufts: SwayMesh[] = [];
  private readonly tuftLayer = new Container({ label: 'tufts' });
  private waterTimer = 0;
  private tick = 0;
  private readonly splashes: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

  constructor() {
    super();
    this.layout = generateBeach();
    this.ledges = this.layout.ledges;
    this.waves = new WaveModel(createRng(31));
    this.land = new DayNightSprite(this.layout.land, NIGHT.land);
    this.sand = new DayNightSprite(this.layout.sand, NIGHT.sand);
    this.scrub = new DayNightSprite(this.layout.scrub, NIGHT.scrub);
    this.props = new DayNightSprite(this.layout.props, NIGHT.props);
    this.dune = new DayNightSprite(this.layout.dune, NIGHT.sand);

    this.waterImage = this.waterCanvas.ctx.createImageData(WORLD_WIDTH, WATER_HEIGHT);
    this.waterTexture = createNearestTexture(this.waterCanvas.canvas);
    this.water = new Sprite(this.waterTexture);
    this.water.y = WATER_TOP;

    for (const palm of this.layout.palms) {
      const sway = new SwayMesh(palm.art.toTexture(), { anchor: 'bottom', amplitude: 2 + palm.art.height / 70, frequency: 0.8 });
      sway.mesh.position.set(palm.x, palm.y);
      sway.mesh.zIndex = palm.baseY;
      this.palmLayer.addChild(sway.mesh);
      this.palms.push({ sway, haze: Math.max(0, 0.6 - beachPlane.scaleAtY(palm.baseY)) });
    }
    for (const tuft of this.layout.tufts) {
      const sway = new SwayMesh(tuft.art.toTexture(), { anchor: 'bottom', amplitude: 1 + tuft.art.height / 10, frequency: 1.6 });
      sway.mesh.position.set(Math.round(tuft.x), Math.round(tuft.y));
      this.tufts.push(sway);
      // The front dune bank's tufts sit on it; the dunes' plants sort among the palms.
      if (tuft.baseY >= 286) this.tuftLayer.addChild(sway.mesh);
      else {
        sway.mesh.zIndex = tuft.baseY;
        this.palmLayer.addChild(sway.mesh);
      }
    }

    this.container.addChild(
      this.sky.container,
      this.land.container,
      this.sand.container,
      this.scrub.container,
      this.water,
      this.fishLayer,
      this.horizonLayer,
      this.birdsFar,
      this.shoreLayer,
      this.props.container,
      this.palmLayer,
      this.birdsMid,
      this.splashLayer,
      this.weatherBack,
      this.dune.container,
      this.tuftLayer,
      this.birdsNear,
      this.weatherFront,
    );
  }

  /** How far the water has run up the sand at a depth along the beach (ground px, ≥ 0). */
  reachAt(depth: number): number {
    const y = beachPlane.project(0, depth).y;
    return this.waves.runUp(Math.round(y * 3)) * RUN_UP_SCALE;
  }

  /** World position of the water's edge right now at a depth along the beach, offset `up` ground px up the sand. */
  edgePoint(depth: number, up = 0): { x: number; y: number; scale: number } {
    return shorePoint(depth, -this.reachAt(depth) - up);
  }

  /** How far up the sand is still wet at a depth (ground px from the still waterline). */
  wetAt(depth: number): number {
    const y = Math.round(beachPlane.project(0, depth).y);
    return this.wetLine[Math.max(0, Math.min(WATER_HEIGHT - 1, y - WATER_TOP))];
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
    this.land.update(lerpColor(lighting.haze, lighting.ambient, 0.3), lighting);
    this.sand.update(lighting.ambient, lighting);
    this.scrub.update(lighting.ambient, lighting);
    this.props.update(lighting.ambient, lighting);
    this.dune.update(lighting.ambient, lighting);
    // By moonlight the palms and grasses are dark grey-green against pale sand.
    const plants = lerpColor(lighting.ambient, NIGHT_PLANTS, lighting.nightness * 0.85);
    this.tuftLayer.tint = plants;
    for (const palm of this.palms) {
      palm.sway.mesh.tint = lerpColor(plants, lighting.haze, palm.haze);
      palm.sway.update(time, weather.wind);
    }
    for (const g of this.tufts) {
      g.update(time * 1.2, weather.wind);
      if (g.mesh.parent === this.palmLayer) g.mesh.tint = plants;
    }

    const energy = Math.min(1, Math.abs(weather.wind) * 0.8 + weather.lightning * 0.6 + (weather.kind === 'rain' ? 0.15 : 0));
    for (const event of this.waves.update(dt, energy)) {
      // The sea is to the right: breaks sound from the right-hand side.
      this.emit('break', { ...event, pan: 0.15 + Math.random() * 0.6 });
    }
    for (let row = 0; row < WATER_HEIGHT; row++) {
      const reach = this.waves.runUp(Math.round((row + WATER_TOP) * 3)) * RUN_UP_SCALE;
      this.wetLine[row] = Math.max(reach, this.wetLine[row] - DRY_RATE * dt);
    }

    this.waterTimer -= dt;
    if (this.waterTimer <= 0) {
      this.waterTimer = 1 / (WATER_FPS * quality.scale);
      this.tick++;
      this.drawWater(env);
    }
    this.updateSplashes(dt, lighting.ambient);
  }

  private drawWater(env: Environment): void {
    const { lighting } = env;
    const amb = lighting.ambient;
    // By moonlight: a deep navy sea with silvery crests and bright white foam, as in the night drawing.
    const n = lighting.nightness;
    const moon = n * lighting.moonlight;
    const seaFar = lerpColor(lerpColor(lighting.skyHorizon, multiplyColor(0x2a6496, amb), 0.55), 0x1a2450, n);
    const seaNear = lerpColor(lerpColor(lighting.skyHorizon, multiplyColor(0x2a8cae, amb), 0.12), 0x24366a, n);
    const shallow = lerpColor(multiplyColor(0x4ec6c2, amb), 0x3a5888, n);
    const crest = lerpColor(lerpColor(seaNear, multiplyColor(0xe2f2f4, amb), 0.6), 0x8a9ccc, moon);
    const ripple = lerpColor(lerpColor(seaNear, multiplyColor(0xbfe2ea, amb), 0.45), 0x5a6ca4, n);
    const foam = lerpColor(lerpColor(multiplyColor(0xf6f8f6, amb), 0xffffff, 0.15 + 0.2 * (1 - lighting.darkness)), 0xe4ecf8, moon);
    const sheet = lerpColor(lerpColor(multiplyColor(0xd8c08a, amb), multiplyColor(0x9ad4d4, amb), 0.6), 0x7686b0, n);
    const wet = lerpColor(multiplyColor(0x9a7c50, amb), 0x50506a, n);
    const surf = [0, 1, 2, 3].map((k) => lerpColor(shallow, foam, 0.95 - k * 0.16));

    // Glitter path under the sun (or the moon, faintly).
    const body = lighting.sun.visible && lighting.sun.elevation > 0.02 ? lighting.sun : lighting.moon.visible ? lighting.moon : null;
    const glintX = body ? lerp(70, WORLD_WIDTH - 70, body.progress) : -999;
    // The moon lays a broad silver path across the water.
    const glintStrength = body === lighting.sun ? body.glow * 1.2 + 0.2 : body ? body.glow * 1.6 : 0;
    const glint = body ? lerpColor(body.color, 0xffffff, body === lighting.sun ? 0.3 : 0.6) : 0xffffff;
    const glintWidth = body === lighting.moon ? 1.6 : 1;

    // The sea's colour steps from the horizon towards us, each with its shallows ramp.
    const SHADES = 6;
    const ramps: number[][] = [];
    const faces: number[] = [];
    for (let step = 0; step <= 5; step++) {
      const base = lerpColor(seaFar, seaNear, step / 5);
      const ramp: number[] = [];
      for (let i = 0; i < SHADES; i++) ramp.push(lerpColor(base, shallow, (i / (SHADES - 1)) * 0.85));
      ramps.push(ramp);
      faces.push(lerpColor(base, seaFar, 0.25));
    }

    const swells = this.waves.swells();
    const breakers = this.waves.breakers();
    const data = this.waterImage.data;
    data.fill(0);
    let k = 0;
    const put = (x: number, row: number, c: number, alpha = 255) => {
      k = (row * WORLD_WIDTH + x) * 4;
      data[k] = c >> 16;
      data[k + 1] = (c >> 8) & 255;
      data[k + 2] = c & 255;
      data[k + 3] = alpha;
    };

    for (let row = 0; row < WATER_HEIGHT; row++) {
      const y = row + WATER_TOP;
      const depth = beachPlane.depthAtY(y);
      const shoreX = shoreXAtY(y);
      const reach = this.waves.runUp(Math.round(y * 3)) * RUN_UP_SCALE;
      const wetTo = this.wetLine[row];
      const nearness = (y - WATER_TOP) / WATER_HEIGHT;
      const level = nearness ** 0.7 * 5;
      const x0 = Math.max(0, Math.floor(shoreX - (wetTo + 4) / depth));
      // Swell crest, surf line and breaker positions for this row, wobbling along the shore.
      const crests = swells.map((p) => lerp(SWELL_START, BREAK_S + 4, p ** 1.25) + Math.sin(depth * 6 + p * 9) * 5);
      const crestHalf = 0.8 * depth + 1.2;
      const lines = [0, 1, 2, 3].map((n) => 14 + n * 26 + Math.sin(depth * 5 + n * 2 + this.tick * 0.02) * 4);
      const lineHalf = [1.4, 0.9, 0.9, 0.9].map((h) => h * depth + 1.2);
      const fronts = breakers.map((b) => lerp(BREAK_S, -2, b.progress));
      const thicks = breakers.map((b) => 14 * (1 - b.progress) + 6);
      const glintHalf = (4 + (y - WATER_TOP) * 0.5) * glintWidth;
      for (let x = x0; x < WORLD_WIDTH; x++) {
        const s = (x - shoreX) * depth;
        const dither = bayer(x, y);
        if (s >= 0) {
          // Open sea: banded and dithered from the horizon towards us, greener in the shallows.
          const step = Math.min(5, Math.floor(level) + (level % 1 > dither ? 1 : 0));
          const shade = s < SHALLOWS_S ? Math.min(SHADES - 1, Math.floor((1 - s / SHALLOWS_S) * (SHADES - 1) + dither)) : 0;
          let color = ramps[step][shade];
          // Little wind ripples drifting across the open water.
          if (s > SHALLOWS_S && pixelHash(Math.floor((x + this.tick * 0.25) / 3), y, 5) > 0.975 - nearness * 0.02) color = ripple;
          // Swell crests rolling in, parallel to the shore, with a darker face behind.
          for (let i = 0; i < crests.length; i++) {
            const off = s - crests[i];
            if (off > -crestHalf && off < crestHalf) color = crest;
            else if (off > crestHalf && off < crestHalf + 4 * depth) color = faces[step];
          }
          // Lines of white surf lying parallel to the shore, shifting gently.
          if (s < SHALLOWS_S) {
            for (let n = 0; n < 4; n++) {
              const off = s - lines[n];
              if (off > -lineHalf[n] && off < lineHalf[n] && pixelHash(Math.floor(x / 2), y + n * 31, (this.tick >> 3) + n) > 0.2 + n * 0.14) color = surf[n];
            }
          }
          // Breakers churning into foam, trailing lace behind them.
          for (let i = 0; i < fronts.length; i++) {
            const off = s - fronts[i];
            const thick = thicks[i];
            const seed = Math.floor(breakers[i].seed);
            if (off > -thick && off < thick) {
              if (pixelHash(x, y + this.tick, seed) > 0.22 + (Math.abs(off) / thick) * 0.4) color = foam;
            } else if (off > thick && off < thick + 30 && pixelHash(x, y, seed + (this.tick >> 2)) > 0.9) color = foam;
          }
          // Sun or moon glitter: short sparkles fanning out towards us.
          if (glintStrength > 0.05 && row > 0) {
            const off = Math.abs(x - glintX);
            if (off < glintHalf && pixelHash(Math.floor(x / 3), y, this.tick) > 1 - 0.07 * glintStrength * (1 - off / glintHalf)) color = glint;
          }
          put(x, row, color);
        } else if (-s < reach) {
          // The thin sheet of a wave washing up the sand, edged with lacy foam.
          const atEdge = reach + s < 3 * depth;
          put(x, row, atEdge && pixelHash(x, y, this.tick >> 1) > 0.3 ? foam : sheet, atEdge ? 255 : 215);
        } else if (-s < wetTo) {
          // Darker wet sand, drying back from its top edge.
          if ((wetTo + s) / Math.max(1, wetTo) > dither * 0.5) put(x, row, wet, 225);
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


