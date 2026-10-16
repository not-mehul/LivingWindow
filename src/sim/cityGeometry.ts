import { FOCAL, GroundPlane } from './groundPlane';

/**
 * The city after the reference drawing: from high on a rooftop you look
 * straight down a street canyon in one-point perspective. Everything in it
 * (the street, the buildings either side, the rooftops below, a skybridge,
 * the skyline beyond) is a box on the ground plane, and each pixel of the
 * view is found by casting a ray from the eye into those boxes.
 *
 * Coordinates are the ground plane's: `gx` sideways and heights in world px
 * at depth 1, `depth` in units of the focal length. A point at height `h`
 * shows at y = horizon + (eye − h) / depth, so roofs below eye level show
 * their tops and taller buildings rise above the horizon.
 */

/** Eye level: where the street vanishes. */
export const CITY_HORIZON = 160;
/** How high above the street the eye is; depth 1 at the street lands at y 360. */
export const CITY_EYE = 200;
/** The street runs away to a vanishing point a little left of centre, as in the drawing. */
export const CITY_VANISH_X = 400;
export const cityPlane = new GroundPlane(CITY_HORIZON, CITY_EYE, CITY_VANISH_X);

/** The building lines either side of the street (ground px from its centre). */
export const STREET_HALF = 80;
/** Where people walk: the market lane between the stalls. */
export const LANE_HALF = 52;

/** A box standing on (or above) the ground, possibly turned about the vertical. */
export interface Box {
  /** Centre on the ground: sideways (ground px) and depth (focal lengths). */
  gx: number;
  depth: number;
  /** Half-sizes in ground px: across (u) and along the view (w) before turning. */
  halfU: number;
  halfW: number;
  /** Bottom and top heights. */
  h0: number;
  h1: number;
  /** Turn about the vertical, radians (0 = square on to the view). */
  angle?: number;
}

/** Which face of a box a ray met: its near (front) face, a side, or the top. */
export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Hit {
  /** Depth along the ray where it meets the box. */
  depth: number;
  face: Face;
  /** Where on the box, in its own frame: across (u), along (w), height (h). */
  u: number;
  w: number;
  h: number;
}

/** An axis-aligned box from ranges. */
export function boxFrom(gx0: number, gx1: number, d0: number, d1: number, h0: number, h1: number): Box {
  return { gx: (gx0 + gx1) / 2, depth: (d0 + d1) / 2, halfU: Math.abs(gx1 - gx0) / 2, halfW: (Math.abs(d1 - d0) * FOCAL) / 2, h0, h1 };
}

/** A box with its turn worked out, ready for casting many rays. */
export interface PreparedBox {
  box: Box;
  cos: number;
  sin: number;
  uB: number;
  wB: number;
}

export function prepareBox(box: Box): PreparedBox {
  const cos = Math.cos(box.angle ?? 0);
  const sin = Math.sin(box.angle ?? 0);
  const cz = box.depth * FOCAL;
  return { box, cos, sin, uB: -(cos * box.gx + sin * cz), wB: sin * box.gx - cos * cz };
}

/**
 * Cast the ray through screen offset (a, b) from the vanishing point
 * (a = x − vanishX, b = y − horizon) into a box. Along the ray every
 * coordinate is linear in depth (gx = a·d, z = FOCAL·d, h = eye − b·d), so
 * this is the classic slab test in the box's own (turned) frame.
 */
export function castBox(box: Box | PreparedBox, a: number, b: number, eye = CITY_EYE): Hit | null {
  const p = 'box' in box ? box : prepareBox(box);
  const d = castDepth(p, a, b, eye);
  if (d < 0) return null;
  const uA = p.cos * a + p.sin * FOCAL;
  const wA = -p.sin * a + p.cos * FOCAL;
  return { depth: d, face: lastFace, u: uA * d + p.uB, w: wA * d + p.wB, h: eye - b * d };
}

/** The face the last `castDepth` met (kept outside the hot path to avoid allocating). */
let lastFace: Face = 'front';

/**
 * Just the depth at which a ray meets a box (−1 if it misses); the face it
 * met is left in `lastCastFace()`. Allocation-free, for casting a ray
 * through every pixel.
 */
export function castDepth(p: PreparedBox, a: number, b: number, eye = CITY_EYE): number {
  const { halfU, halfW, h0, h1 } = p.box;
  let enter = 0.01;
  let exit = Number.POSITIVE_INFINITY;
  let face: Face = 'front';
  // Each slab: lo ≤ k·d + c ≤ hi.
  let k = p.cos * a + p.sin * FOCAL;
  let c = p.uB;
  if (Math.abs(k) < 1e-9) {
    if (c < -halfU || c > halfU) return -1;
  } else {
    const t0 = (-halfU - c) / k;
    const t1 = (halfU - c) / k;
    const lo = t0 < t1 ? t0 : t1;
    const hi = t0 < t1 ? t1 : t0;
    if (lo > enter) {
      enter = lo;
      face = t0 < t1 ? 'left' : 'right';
    }
    if (hi < exit) exit = hi;
  }
  k = -p.sin * a + p.cos * FOCAL;
  c = p.wB;
  if (Math.abs(k) < 1e-9) {
    if (c < -halfW || c > halfW) return -1;
  } else {
    const t0 = (-halfW - c) / k;
    const t1 = (halfW - c) / k;
    const lo = t0 < t1 ? t0 : t1;
    const hi = t0 < t1 ? t1 : t0;
    if (lo > enter) {
      enter = lo;
      face = t0 < t1 ? 'front' : 'back';
    }
    if (hi < exit) exit = hi;
    if (enter > exit) return -1;
  }
  if (Math.abs(b) < 1e-9) {
    if (eye < h0 || eye > h1) return -1;
  } else {
    const t0 = (h0 - eye) / -b;
    const t1 = (h1 - eye) / -b;
    const lo = t0 < t1 ? t0 : t1;
    const hi = t0 < t1 ? t1 : t0;
    if (lo > enter) {
      enter = lo;
      face = t0 < t1 ? 'bottom' : 'top';
    }
    if (hi < exit) exit = hi;
  }
  if (enter > exit) return -1;
  lastFace = face;
  return enter;
}

export function lastCastFace(): Face {
  return lastFace;
}

/** Screen position of a point on or above the ground. */
export function projectPoint(gx: number, depth: number, h = 0, eye = CITY_EYE): { x: number; y: number } {
  return { x: CITY_VANISH_X + gx / depth, y: CITY_HORIZON + (eye - h) / depth };
}
