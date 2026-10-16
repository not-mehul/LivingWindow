import type { Texture } from 'pixi.js';
import { createNearestTexture } from './pixelTexture';

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

  /** Colour every empty pixel touching the drawing: an ink outline round its silhouette. */
  outline(color: string | number): void {
    const edge: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isSet(x, y)) continue;
        if (this.isSet(x - 1, y) || this.isSet(x + 1, y) || this.isSet(x, y - 1) || this.isSet(x, y + 1)) edge.push(x, y);
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.set(edge[i], edge[i + 1], color);
  }

  /** Read a pixel back as 0xRRGGBB (alpha ignored); -1 where empty. */
  get(x: number, y: number): number {
    if (!this.isSet(x, y)) return -1;
    const i = (y * this.width + x) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
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
