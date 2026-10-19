import { Graphics, Sprite, type Container, type Texture } from 'pixi.js';
import { WORLD_WIDTH } from '../../config';
import { multiplyColor } from '../../core/color';
import { createNearestTexture, PixelCanvas } from '../../core/pixelTexture';
import type { Environment } from '../../scene/Environment';
import { valueNoise } from '../../scene/common/paint';
import { BEACH_HORIZON, beachPlane, shoreXAtY } from '../../sim/shore';
import { lastHighWater, TIDE_RANGE } from '../../sim/tides';
import { pixelHash } from '../../sprites/raster';

/** Where the last high water left its line (ground px across the shore; up the sand is negative). */
export function wrackLineS(highWater: number): number {
  // The top of the tide, plus how far its biggest waves ran up beyond it.
  return -(highWater * TIDE_RANGE + 44);
}

/** What the wrack needs from the beach. */
export interface WrackShore {
  readonly sandFx: Container;
  readonly airLayer: Container;
  /** The tide's clock (hours since the epoch). */
  readonly tideHours: number;
}

const TOP = BEACH_HORIZON + 6;
const BOTTOM = 350;
const WEED = [0x2a2414, 0x3e3618, 0x54502a, 0x6a6434];
const SHELLS = [0xf4ece0, 0xe8c0b0, 0xd8d0c0];
const TWIG = [0x8a7c66, 0x6a5e4c];
const FAN = [0x9a4a7a, 0xc87a4a];

/**
 * The strandline: a ragged band of what the last high tide brought in and
 * left behind, high up the sand. Tangles of dark weed and kelp, shells, a
 * bleached twig, a dried sea fan; patchy, heaped here and thin there; it
 * moves up and down the beach with the tides. Over it on a warm day, clouds
 * of tiny kelp flies dance and settle.
 */
export class Wrack {
  private readonly canvas: PixelCanvas;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly texture: Texture;
  private readonly sprite: Sprite;
  private readonly flies = new Graphics();
  private drawnAt = Number.NaN;
  private checkTimer = 0;
  /** Heaps along the line, where the flies gather (world positions). */
  private heaps: Array<{ x: number; y: number; scale: number; phase: number }> = [];

  constructor(private readonly shore: WrackShore) {
    this.canvas = new PixelCanvas(WORLD_WIDTH, BOTTOM - TOP);
    this.image = this.canvas.ctx.createImageData(WORLD_WIDTH, BOTTOM - TOP);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture = createNearestTexture(this.canvas.canvas);
    this.sprite = new Sprite(this.texture);
    this.sprite.position.set(0, TOP);
    shore.sandFx.addChildAt(this.sprite, 0);
    shore.airLayer.addChild(this.flies);
  }

  /** Where the line lies now (ground px across the shore). */
  get lineS(): number {
    return this.drawnAt;
  }

  update(dt: number, env: Environment): void {
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 5;
      const s = wrackLineS(lastHighWater(this.shore.tideHours));
      if (!(Math.abs(s - this.drawnAt) < 1)) this.draw(s);
    }
    this.sprite.tint = env.lighting.ambient;
    this.updateFlies(env);
  }

  private draw(lineS: number): void {
    this.drawnAt = lineS;
    const px = this.pixels;
    px.fill(0);
    const w = WORLD_WIDTH;
    this.heaps = [];
    const put = (x: number, y: number, c: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y) - TOP;
      if (ix < 0 || ix >= w || iy < 0 || iy >= BOTTOM - TOP) return;
      px[iy * w + ix] = rgba(c);
    };
    for (let y = TOP; y < BOTTOM; y++) {
      const depth = beachPlane.depthAtY(y + 0.5);
      const k = 1 / depth;
      // Patchy along the beach: heaps, thin scatter, bare stretches.
      const along = depth * 60;
      const heap = valueNoise(along, 0, 3, 901) * 0.7 + valueNoise(along, 0, 0.9, 902) * 0.3;
      if (heap < 0.32) continue;
      const x = shoreXAtY(y + 0.5) + (lineS + (valueNoise(along, 1, 2, 903) - 0.5) * 14) * k;
      const band = Math.max(1, (2 + heap * 9) * k);
      const n = Math.max(1, Math.round(band * (heap > 0.6 ? 1 : 0.5)));
      for (let i = 0; i < n; i++) {
        const h = pixelHash(y, i, 904);
        const xx = x + (pixelHash(y, i, 905) - 0.5) * band * 2;
        if (h < 0.7) {
          // Weed: little dark tangles, heaped up.
          const c = WEED[Math.floor(pixelHash(y, i, 906) * WEED.length)];
          put(xx, y, c);
          if (k > 0.45 && heap > 0.55) put(xx + 1, y, WEED[Math.min(3, Math.floor(pixelHash(y, i, 907) * 4))]);
          if (k > 0.6 && heap > 0.7 && pixelHash(y, i, 908) < 0.4) put(xx, y - 1, WEED[2]);
        } else if (h < 0.85) put(xx, y, SHELLS[Math.floor(pixelHash(y, i, 909) * SHELLS.length)]);
        else if (h < 0.93 && k > 0.5) {
          // A strand of kelp lying along the line.
          const len = Math.round(3 + pixelHash(y, i, 910) * 5 * k);
          for (let j = 0; j < len; j++) put(xx + j, y + (j > len / 2 ? 1 : 0), WEED[1 + (j % 2)]);
        } else if (h < 0.97 && k > 0.55) {
          // A bleached twig.
          const len = Math.round(3 + pixelHash(y, i, 911) * 4 * k);
          for (let j = 0; j < len; j++) put(xx + j, y - Math.floor(j / 3), TWIG[j % 2]);
        } else if (k > 0.65) {
          // A dried sea fan.
          const c = FAN[Math.floor(pixelHash(y, i, 912) * 2)];
          put(xx, y, c);
          put(xx - 1, y - 1, c);
          put(xx + 1, y - 1, c);
          put(xx, y - 2, c);
        }
      }
      if (heap > 0.7 && k > 0.5 && pixelHash(y, 0, 913) < 0.08) this.heaps.push({ x, y, scale: k, phase: Math.random() * 6 });
    }
    this.canvas.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  private updateFlies(env: Environment): void {
    const g = this.flies;
    g.clear();
    const { lighting, weather } = env;
    // Warm, still daylight brings them out; a breeze or rain keeps them down in the weed.
    const out = (1 - lighting.darkness) * (weather.precipitation > 0.05 ? 0 : 1) * Math.max(0, 1 - Math.abs(weather.wind) * 1.6);
    if (out < 0.1) return;
    const color = multiplyColor(0x201c18, lighting.ambient);
    const t = env.time;
    for (const h of this.heaps) {
      const count = Math.round(6 * out * h.scale + 1);
      for (let i = 0; i < count; i++) {
        // Each one darts about over the heap, settling now and then.
        const a = t * (3 + i * 0.7) + h.phase + i * 2.1;
        const settle = Math.sin(t * 0.6 + i + h.phase) > 0.6;
        const x = h.x + Math.sin(a) * 4 * h.scale + Math.sin(a * 2.3) * 1.5;
        const y = h.y - (settle ? 0 : 2 + Math.abs(Math.sin(a * 1.7)) * 4 * h.scale);
        g.rect(Math.round(x), Math.round(y), 1, 1).fill({ color, alpha: 0.85 });
      }
    }
  }
}

function rgba(c: number): number {
  return ((255 << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
}
