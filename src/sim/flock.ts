import { FOCAL, type GroundPlane } from './groundPlane';

export interface GroundSpot {
  gx: number;
  depth: number;
}

export interface FlockSpread {
  /** How far either side of the flock's middle a sheep may graze (ground px at depth 1). */
  gx: number;
  /** How far nearer or further (depth units). */
  depth: number;
  /** The closest two sheep may graze, measured on screen (world px). */
  apart: number;
}

/** A loose flock at its ease, scattered up and down the grass. */
export const LOOSE: FlockSpread = { gx: 190, depth: 0.7, apart: 12 };
/** Bunched up ahead of the dog. */
export const BUNCHED: FlockSpread = { gx: 45, depth: 0.14, apart: 5 };

/**
 * Somewhere for one sheep to graze near the flock's middle. The row is
 * picked evenly on screen (not in depth), so the flock spreads up and down
 * the field as much as across it, and spots too near another sheep on screen
 * are passed over (if every spot is crowded, the roomiest is taken). Null
 * when every try was blocked.
 */
export function flockSpot(
  plane: GroundPlane,
  centre: GroundSpot,
  others: readonly GroundSpot[],
  spread: FlockSpread,
  bounds: { depth0: number; depth1: number },
  blocked: (gx: number, depth: number) => boolean = () => false,
  rng: () => number = Math.random,
): GroundSpot | null {
  const d0 = Math.max(bounds.depth0, centre.depth - spread.depth);
  const d1 = Math.min(bounds.depth1, centre.depth + spread.depth);
  const near = plane.project(0, d0).y;
  const far = plane.project(0, d1).y;
  let best: GroundSpot | null = null;
  let bestGap = -1;
  for (let tries = 0; tries < 24; tries++) {
    const depth = plane.depthAtY(far + rng() * (near - far));
    const gx = centre.gx + (rng() * 2 - 1) * spread.gx;
    if (blocked(gx, depth)) continue;
    const gap = screenGap(plane, { gx, depth }, others);
    if (gap >= spread.apart) return { gx, depth };
    if (gap > bestGap) {
      bestGap = gap;
      best = { gx, depth };
    }
  }
  return best;
}

/** On-screen distance from a spot to the nearest of the others (∞ if there are none). */
export function screenGap(plane: GroundPlane, spot: GroundSpot, others: readonly GroundSpot[]): number {
  const p = plane.project(spot.gx, spot.depth);
  let gap = Number.POSITIVE_INFINITY;
  for (const o of others) {
    const q = plane.project(o.gx, o.depth);
    gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y));
  }
  return gap;
}

/** Ground distance between two spots (px at depth 1, depth scaled by the focal length). */
export function groundDistance(a: GroundSpot, b: GroundSpot): number {
  return Math.hypot(a.gx - b.gx, (a.depth - b.depth) * FOCAL);
}
