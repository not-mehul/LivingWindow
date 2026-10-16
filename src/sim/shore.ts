import { GroundPlane, type GroundPoint } from './groundPlane';

/**
 * The beach after the reference drawing: from the beach house you look along
 * a shoreline that sweeps from the lower right of the view away to a point on
 * the horizon left of centre, sea to its right and sand to its left.
 *
 * On the ground plane that shoreline is nearly a straight line running away
 * from the viewer, offset to the right, with a slight curve. Everything about
 * the sea is measured in *shore coordinates*:
 *  - `depth`: how far along the beach (the ground plane's depth), and
 *  - `s`: ground px across it from the still waterline; positive out to sea,
 *    negative up the sand.
 */

/** Eye level: the sea horizon. */
export const BEACH_HORIZON = 160;
/** Depth 1 lands at y = 340, the foot of the view. */
export const BEACH_EYE = 180;
export const beachPlane = new GroundPlane(BEACH_HORIZON, BEACH_EYE);

/** Waves break this far out from the still waterline (ground px). */
export const BREAK_S = 40;
/** Beyond the breakers the water deepens to open-sea colour by here. */
export const SHALLOWS_S = 150;

/** The still waterline's sideways position at a depth (ground px). */
export function shoreGx(depth: number): number {
  return 300 + 90 / depth;
}

/** Screen x of the still waterline on world row `y`. */
export function shoreXAtY(y: number): number {
  const depth = beachPlane.depthAtY(y);
  return beachPlane.vanishX + shoreGx(depth) / depth;
}

/** World position of a point `s` ground px across the shore at `depth`. */
export function shorePoint(depth: number, s: number): GroundPoint {
  return beachPlane.project(shoreGx(depth) + s, depth);
}

/** Shore coordinates of a world point (below the horizon). */
export function shoreCoords(x: number, y: number): { depth: number; s: number } {
  const depth = beachPlane.depthAtY(y);
  return { depth, s: (x - shoreXAtY(y)) * depth };
}
