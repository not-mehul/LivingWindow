import { pixelHash } from '../../sprites/raster';

/** 4×4 ordered-dither thresholds (0–15). */
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Ordered-dither threshold for a pixel, in 0..1. */
export function bayer(x: number, y: number): number {
  return (BAYER[y & 3][x & 3] + 0.5) / 16;
}

/**
 * Smooth value noise (0..1): random values on a grid of `cell`-px squares,
 * blended smoothly between. Good for soft patches of light and colour.
 */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = pixelHash(x0, y0, seed);
  const b = pixelHash(x0 + 1, y0, seed);
  const c = pixelHash(x0, y0 + 1, seed);
  const d = pixelHash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Pick from a ramp of colours (dark → light) for a level in 0..1, dithering
 * between neighbouring steps so gradients stay pixel-crisp without banding.
 */
export function ditherRamp<T>(ramp: readonly T[], level: number, x: number, y: number): T {
  const scaled = Math.min(ramp.length - 1, Math.max(0, level * (ramp.length - 1)));
  const low = Math.floor(scaled);
  const step = scaled - low > bayer(x, y) ? 1 : 0;
  return ramp[Math.min(ramp.length - 1, low + step)];
}
