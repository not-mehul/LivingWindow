import { bayer4 as bayer, valueNoise as kitValueNoise } from '../../sprites/kit';

/** Ordered-dither threshold for a pixel, in 0..1. */
export { bayer };

/**
 * Smooth value noise (0..1): random values on a grid of `cell`-px squares,
 * blended smoothly between. Good for soft patches of light and colour.
 */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  return kitValueNoise(x / cell, y / cell, seed);
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
