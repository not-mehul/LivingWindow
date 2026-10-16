/**
 * Geometry of a two-sash casement window whose sashes swing outward on hinges
 * at the jambs, seen by a viewer standing in the room. All values are in frame
 * art pixels, in the window's own coordinates.
 *
 * Each sash is a flat rectangle in the wall plane when closed. Opening rotates
 * it about its hinge line, carrying its free stile away from the viewer, and a
 * pinhole projection from the viewer's eye maps it back onto the screen. The
 * free stile therefore looks shorter and slides toward the middle of the
 * view, like the hand-drawn reference.
 */

export interface Point {
  x: number;
  y: number;
}

/** A projected sash, in screen orientation (as seen when closed). */
export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface CasementGeometry {
  /** Left edge of the left sash's hinge line. */
  left: number;
  /** Top of the sashes (they tuck a little under the head). */
  top: number;
  /** Width of one sash, hinge to meeting stile. */
  sashWidth: number;
  sashHeight: number;
  /** Viewer's eye, in the wall plane's coordinates. */
  eyeX: number;
  eyeY: number;
  /** Distance from the eye to the wall plane. */
  distance: number;
  /** Angle the sashes rest at when fully open (radians). */
  openAngle: number;
}

/** Art pixels each sash extends under the jambs, head and sill when closed. */
export const SASH_TUCK = 3;
/** Where the two hinges sit along each sash's height. */
export const HINGE_FRACTIONS = [0.16, 0.84] as const;

/** The angle in the reference drawing: about 72° outward. */
export const BASE_OPEN_ANGLE = (72 * Math.PI) / 180;
const MAX_OPEN_ANGLE = (88 * Math.PI) / 180;
/** Eye distance as a multiple of the sash width (matches the reference's foreshortening). */
const DISTANCE_PER_SASH_WIDTH = 4.4;
/** The eye sits low in the opening, so the sash tops converge more than their bottoms. */
const EYE_HEIGHT = 0.75;
/** An open sash may cover at most this fraction of the opening's height, measured across. */
const MAX_OPEN_WIDTH_PER_HEIGHT = 0.3;

/**
 * Lay out a pair of sashes filling `width` × `height` (the clear opening plus
 * any tuck under the frame), starting at (`left`, `top`).
 */
export function casementGeometry(left: number, top: number, width: number, height: number): CasementGeometry {
  const sashWidth = width / 2;
  const geometry: CasementGeometry = {
    left,
    top,
    sashWidth,
    sashHeight: height,
    eyeX: left + width / 2,
    eyeY: top + height * EYE_HEIGHT,
    distance: sashWidth * DISTANCE_PER_SASH_WIDTH,
    openAngle: BASE_OPEN_ANGLE,
  };
  // Very wide sashes (ultrawide screens) swing open further, so they don't
  // hide too much of the view.
  const limit = height * MAX_OPEN_WIDTH_PER_HEIGHT;
  if (projectedOpenWidth(geometry, BASE_OPEN_ANGLE) > limit) {
    let lo = BASE_OPEN_ANGLE;
    let hi = MAX_OPEN_ANGLE;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (projectedOpenWidth(geometry, mid) > limit) lo = mid;
      else hi = mid;
    }
    geometry.openAngle = hi;
  }
  return geometry;
}

/** Project a point on a sash, `depth` behind the wall plane, onto the screen. */
function project(g: CasementGeometry, x: number, y: number, depth: number): Point {
  const k = g.distance / (g.distance + depth);
  return { x: g.eyeX + (x - g.eyeX) * k, y: g.eyeY + (y - g.eyeY) * k };
}

/** How wide a sash looks on screen at `angle`, hinge to free stile. */
export function projectedOpenWidth(g: CasementGeometry, angle: number): number {
  const quad = sashQuad(g, 'left', angle);
  return Math.max(quad.topRight.x, quad.bottomRight.x) - quad.topLeft.x;
}

/** The projected outline of one sash, opened by `angle` (0 = closed). */
export function sashQuad(g: CasementGeometry, side: 'left' | 'right', angle: number): Quad {
  const { sashWidth: w, sashHeight: h, top } = g;
  const bottom = top + h;
  const reach = w * Math.cos(angle);
  const depth = w * Math.sin(angle);
  if (side === 'left') {
    const hinge = g.left;
    const free = hinge + reach;
    return {
      topLeft: { x: hinge, y: top },
      bottomLeft: { x: hinge, y: bottom },
      topRight: project(g, free, top, depth),
      bottomRight: project(g, free, bottom, depth),
    };
  }
  const hinge = g.left + w * 2;
  const free = hinge - reach;
  return {
    topLeft: project(g, free, top, depth),
    bottomLeft: project(g, free, bottom, depth),
    topRight: { x: hinge, y: top },
    bottomRight: { x: hinge, y: bottom },
  };
}

/** Even-odd point-in-polygon test for a quad. */
export function quadContains(quad: Quad, x: number, y: number): boolean {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
