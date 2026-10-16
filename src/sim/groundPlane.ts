import { WORLD_WIDTH } from '../config';

/** Field of view, as a focal length in world px (≈ 62° across the 840 px panorama). */
export const FOCAL = 700;

export interface GroundPoint {
  /** World x, y of the point on the ground (y = feet / base). */
  x: number;
  y: number;
  /** Size multiplier: 1 at depth 1, halving as depth doubles. */
  scale: number;
}

/**
 * A pinhole camera looking out over flat ground, for laying scenery and
 * creatures out in true perspective rather than on horizontal lanes.
 *
 * Ground positions are `(gx, depth)`: `gx` is sideways distance measured in
 * world px *at depth 1*, and `depth` is distance from the viewer in units of
 * the focal length (`FOCAL`). Depth 1 lands `eye` px below the horizon. Any
 * object's apparent size is its size at depth 1 times `1 / depth`, so a
 * walker heading away shrinks and slows exactly as it should.
 */
export class GroundPlane {
  constructor(
    /** World y of the eye level (where the ground plane would vanish). */
    readonly horizonY: number,
    /** How far below the horizon depth 1 sits (the viewer's height, in px at depth 1). */
    readonly eye: number,
    /** World x of the vanishing point. */
    readonly vanishX = WORLD_WIDTH / 2,
  ) {}

  project(gx: number, depth: number): GroundPoint {
    const scale = 1 / depth;
    return { x: this.vanishX + gx * scale, y: this.horizonY + this.eye * scale, scale };
  }

  /** Depth of the ground seen at world row `y` (∞ at or above the horizon). */
  depthAtY(y: number): number {
    return y <= this.horizonY ? Number.POSITIVE_INFINITY : this.eye / (y - this.horizonY);
  }

  scaleAtY(y: number): number {
    return Math.max(0, (y - this.horizonY) / this.eye);
  }

  unproject(x: number, y: number): { gx: number; depth: number } {
    const depth = this.depthAtY(y);
    return { gx: (x - this.vanishX) * depth, depth };
  }

  /** Sideways ground extent visible across the whole panorama at `depth` (half-width). */
  halfWidthAt(depth: number): number {
    return (WORLD_WIDTH / 2) * depth;
  }
}
