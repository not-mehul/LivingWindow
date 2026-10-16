import { PixelBuffer } from '../core/pixelBuffer';
import { pixelHash } from '../sprites/raster';
import type { WoodPalette } from './palette';

export { PixelBuffer };

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
