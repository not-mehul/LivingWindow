import type { Texture } from 'pixi.js';
import { lerpColor } from '../../core/color';
import { PixelBuffer } from '../../core/pixelBuffer';
import { bayer } from './paint';

const cache = new Map<string, Texture>();

/**
 * A soft, dithered glow `radius` px round a hot core, to draw additively
 * (lamps, beacons, lanterns). `squash` flattens it vertically (a pool of
 * light on the ground). Shared and cached by size and colour.
 */
export function glowTexture(radius: number, color: number, squash = 1, core = true): Texture {
  const r = Math.max(1, Math.round(radius));
  const ry = Math.max(1, Math.round(r * squash));
  const key = `${r}:${ry}:${color}:${core}`;
  let texture = cache.get(key);
  if (texture) return texture;
  const p = new PixelBuffer(r * 2 + 1, ry * 2 + 1);
  for (let y = 0; y <= ry * 2; y++) {
    for (let x = 0; x <= r * 2; x++) {
      const d = Math.hypot((x - r) / (r + 0.5), (y - ry) / (ry + 0.5));
      if (d >= 1) continue;
      const level = (1 - d) ** 1.8 * 4;
      let step = Math.floor(level);
      if (level - step > bayer(x, y)) step++;
      if (step <= 0) continue;
      p.set(x, y, lerpColor(0x000000, color, Math.min(1, step / 4)));
    }
  }
  if (core) p.set(r, ry, lerpColor(color, 0xffffff, 0.6));
  texture = p.toTexture();
  cache.set(key, texture);
  return texture;
}
