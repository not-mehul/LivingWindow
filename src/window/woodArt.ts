import type { Texture } from 'pixi.js';
import { createNearestTexture } from '../core/pixelTexture';
import { pixelHash } from '../sprites/raster';
import type { WoodPalette } from './palette';

const parse = (color: string): number => Number.parseInt(color.slice(1), 16);

/**
 * A small RGBA pixel buffer for drawing large procedural pieces (the frame,
 * sill, sashes, curtain) pixel by pixel, then uploading them in one go.
 */
export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(Math.max(1, width * height * 4));
  }

  set(x: number, y: number, color: string | number, alpha = 255): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const c = typeof color === 'string' ? parse(color) : color;
    const i = (y * this.width + x) * 4;
    this.data[i] = c >> 16;
    this.data[i + 1] = (c >> 8) & 0xff;
    this.data[i + 2] = c & 0xff;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, color: string | number, alpha = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color, alpha);
  }

  hline(x: number, y: number, w: number, color: string | number): void {
    this.rect(x, y, w, 1, color);
  }

  vline(x: number, y: number, h: number, color: string | number): void {
    this.rect(x, y, 1, h, color);
  }

  isSet(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.data[(y * this.width + x) * 4 + 3] > 0;
  }

  toTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, this.width);
    canvas.height = Math.max(1, this.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported in this browser.');
    ctx.putImageData(new ImageData(this.data as Uint8ClampedArray<ArrayBuffer>, canvas.width, canvas.height), 0, 0);
    return createNearestTexture(canvas);
  }
}

export interface PlankOptions {
  /** Grain runs along the plank's length: vertical for jambs, horizontal for beams. */
  vertical: boolean;
  wood: WoodPalette;
  seed: number;
  /** Knots per 100 px of length. */
  knots?: number;
  /** Lighten (+) or darken (−) the whole plank, in palette steps. */
  tone?: -1 | 0 | 1;
}

/**
 * A weathered timber plank: wavy grain lines that break and resume, lighter
 * streaks, the odd crack and a few knots with rings.
 */
export function paintPlank(p: PixelBuffer, x0: number, y0: number, w: number, h: number, o: PlankOptions): void {
  const { wood, seed } = o;
  const ramp = [wood.shadow, wood.dark, wood.base, wood.light, wood.highlight];
  const baseIndex = 2 + (o.tone ?? 0);
  const across = o.vertical ? w : h;
  const along = o.vertical ? h : w;
  for (let a = 0; a < along; a++) {
    // Grain drifts sideways slowly along the plank.
    const wobble = Math.round(Math.sin(a / 23 + seed) * 1.2 + Math.sin(a / 61 + seed * 3) * 1.4);
    for (let c = 0; c < across; c++) {
      const lane = c + wobble;
      const kind = pixelHash(lane, 0, seed);
      const broken = pixelHash(lane, Math.floor(a / 7), seed + 1) < 0.22;
      let index = baseIndex;
      if (!broken) {
        if (kind < 0.16) index -= 1;
        else if (kind > 0.86) index += 1;
      }
      if (pixelHash(c, a, seed + 2) < 0.04) index += pixelHash(c, a, seed + 3) < 0.5 ? -1 : 1;
      const color = ramp[Math.max(0, Math.min(ramp.length - 1, index))];
      if (o.vertical) p.set(x0 + c, y0 + a, color);
      else p.set(x0 + a, y0 + c, color);
    }
  }
  // Knots: dark core, a lighter ring, and the grain bunching round them.
  const count = Math.max(0, Math.round(((o.knots ?? 0.6) * along) / 100));
  for (let k = 0; k < count; k++) {
    const pos = 6 + pixelHash(k, 7, seed) * Math.max(1, along - 12);
    const off = 2 + pixelHash(k, 9, seed) * Math.max(1, across - 4);
    const rx = o.vertical ? 1.6 : 3.2;
    const ry = o.vertical ? 3.2 : 1.6;
    const cx = o.vertical ? x0 + off : x0 + pos;
    const cy = o.vertical ? y0 + pos : y0 + off;
    for (let j = -5; j <= 5; j++) {
      for (let i = -5; i <= 5; i++) {
        const d = Math.hypot(i / rx, j / ry);
        const x = Math.round(cx + i);
        const y = Math.round(cy + j);
        if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) continue;
        if (d < 0.6) p.set(x, y, wood.shadow);
        else if (d < 1.1) p.set(x, y, wood.dark);
        else if (d < 1.55) p.set(x, y, wood.light);
        else if (d < 2) p.set(x, y, wood.dark);
      }
    }
  }
  // A couple of short cracks.
  const cracks = Math.round(along / 140);
  for (let k = 0; k < cracks; k++) {
    const pos = Math.floor(pixelHash(k, 11, seed) * along);
    const off = Math.floor(pixelHash(k, 13, seed) * across);
    const length = 4 + Math.floor(pixelHash(k, 17, seed) * 8);
    for (let a = 0; a < length; a++) {
      const c = off + Math.round(Math.sin(a * 0.7) * 0.6);
      if (c < 0 || c >= across || pos + a >= along) continue;
      if (o.vertical) p.set(x0 + c, y0 + pos + a, wood.outline);
      else p.set(x0 + pos + a, y0 + c, wood.outline);
    }
  }
}
