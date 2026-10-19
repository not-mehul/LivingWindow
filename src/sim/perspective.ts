/**
 * 2.5D depth: z = 0 is the windowsill, z = 1 the horizon. An entity's render
 * scale follows S(z) = S_min + (1 − S_min)(1 − z)², the curve from the design
 * document. Sprites are then *generated* at that pixel size rather than
 * scaled, so distant birds never shimmer.
 */

/** Height of a full-detail sprite on the sill, in art pixels. */
export const FULL_DETAIL_SIZE = 48;
/** Smallest scale: a 6 px silhouette at the horizon. */
export const MIN_SCALE = 6 / FULL_DETAIL_SIZE;

export function perspectiveScale(z: number): number {
  const d = 1 - Math.min(1, Math.max(0, z));
  return MIN_SCALE + (1 - MIN_SCALE) * d * d;
}

/** Sprite box size in pixels for a depth and a species' relative size. */
export function spriteSizeAt(z: number, relativeSize = 1): number {
  return Math.max(4, Math.round(FULL_DETAIL_SIZE * perspectiveScale(z) * relativeSize));
}

/**
 * The depth z at which S(z) equals `scale` (the inverse of `perspectiveScale`),
 * so perches laid out on a ground plane get matching bird sizes.
 */
export function depthForScale(scale: number): number {
  const s = Math.min(1, Math.max(MIN_SCALE, scale));
  return 1 - Math.sqrt((s - MIN_SCALE) / (1 - MIN_SCALE));
}
