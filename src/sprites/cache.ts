import { CanvasSource, Texture } from 'pixi.js';
import type { Drawn } from './kit';
import type { PixelGrid } from './raster';

/** Upload an indexed grid as a crisp, nearest-sampled texture. */
export function gridToTexture(grid: PixelGrid, colors: readonly number[]): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(grid.toRGBA(colors) as Uint8ClampedArray<ArrayBuffer>, grid.width, grid.height), 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest', resolution: 1 }) });
}

/** Drawn textures by key: each drawn once, the first time it's asked for. */
export class DrawnCache {
  private readonly cache = new Map<string, Texture>();

  get(key: string, draw: () => Drawn): Texture {
    let t = this.cache.get(key);
    if (!t) {
      const { grid, palette } = draw();
      t = gridToTexture(grid, palette.colors);
      this.cache.set(key, t);
    }
    return t;
  }

  get size(): number {
    return this.cache.size;
  }

  /** Drop (and free) every texture whose key starts with `prefix`. */
  forget(prefix: string): void {
    for (const [key, t] of this.cache) {
      if (!key.startsWith(prefix)) continue;
      t.destroy(true);
      this.cache.delete(key);
    }
  }
}
