import { FOCAL, GroundPlane, type GroundPoint } from './groundPlane';
import type { Obstacle } from './groundWalker';

/**
 * The meadows after the reference drawing: a sunny pasture rolling away to a
 * wooded tree line on the horizon. A two-track dirt path comes in from the
 * lower left, swings right across the field and winds away over a rise; a
 * creek meanders across the right of the pasture towards us.
 *
 * Both are laid out as smooth curves through a few screen points (one x per
 * world row), then read back on the ground plane, so their widths are
 * constant on the ground and converge properly with distance.
 */

/** Eye level: where the tree line meets the sky. */
export const MEADOW_HORIZON = 180;
/** Depth 1 lands at y = 350, just below the sill. */
export const MEADOW_EYE = 170;
export const meadowPlane = new GroundPlane(MEADOW_HORIZON, MEADOW_EYE);

/** Half-widths on the ground (ground px at depth 1). */
export const PATH_HALF = 58;
export const CREEK_HALF = 30;

type Points = ReadonlyArray<readonly [y: number, x: number]>;

/** A smooth curve x(y) through screen points (Catmull–Rom tangents, extended straight past its ends). */
function curve(points: Points): (y: number) => number {
  const n = points.length;
  const m = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  });
  return (y: number) => {
    // Points run from the near end (large y) to the far end (small y).
    if (y >= points[0][0]) return points[0][1] + (y - points[0][0]) * m[0];
    if (y <= points[n - 1][0]) return points[n - 1][1] + (y - points[n - 1][0]) * m[n - 1];
    let i = 0;
    while (y < points[i + 1][0]) i++;
    const [y0, x0] = points[i];
    const [y1, x1] = points[i + 1];
    const h = y1 - y0;
    const t = (y - y0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * x0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * x1 + (t3 - t2) * h * m[i + 1];
  };
}

/** Where the path's centre line crosses each row, from the lower left away to the tree line. */
export const PATH_END_Y = 190;
const pathX = curve([
  [350, -40],
  [300, 110],
  [272, 230],
  [252, 330],
  [236, 420],
  [222, 478],
  [210, 505],
  [201, 492],
  [195, 470],
  [PATH_END_Y, 456],
]);

/** Where the creek's centre line crosses each row, from the right edge in front back to the trees. */
export const CREEK_END_Y = 189;
const creekX = curve([
  [330, 850],
  [300, 780],
  [280, 694],
  [262, 636],
  [248, 606],
  [236, 618],
  [224, 660],
  [214, 694],
  [205, 708],
  [196, 702],
  [CREEK_END_Y, 696],
]);

/** A curve on the ground, defined by its screen x on each row. */
export class GroundCurve {
  constructor(
    private readonly xAtY: (y: number) => number,
    readonly halfWidth: number,
    /** The row where it disappears into the distance. */
    readonly endY: number,
    private readonly plane: GroundPlane = meadowPlane,
  ) {}

  /** Screen x of the centre line on world row `y`. */
  centreX(y: number): number {
    return this.xAtY(y);
  }

  /** Ground x of the centre line at a depth. */
  gxAt(depth: number): number {
    return (this.xAtY(this.plane.project(0, depth).y) - this.plane.vanishX) * depth;
  }

  /**
   * Ground px across the curve from its centre line for a world point
   * (signed, positive to the right), measured square to the curve.
   */
  offset(x: number, y: number): number {
    const depth = this.plane.depthAtY(y);
    const across = (x - this.xAtY(y)) * depth;
    return across * this.cosine(depth);
  }

  /** Is a world point on it? */
  contains(x: number, y: number, margin = 0): boolean {
    return y > this.endY && Math.abs(this.offset(x, y)) < this.halfWidth + margin;
  }

  /** World position of a point `across` ground px from the centre line at a depth. */
  point(depth: number, across: number): GroundPoint {
    return this.plane.project(this.gxAt(depth) + across / this.cosine(depth), depth);
  }

  /** The curve's screen direction at a depth, as radians from +x (pointing away from the viewer). */
  screenAngle(depth: number): number {
    const a = this.point(depth, 0);
    const b = this.point(depth * 1.02, 0);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Circles along it, for walkers to keep out of. */
  obstacles(fromDepth: number, toDepth: number, margin: number): Obstacle[] {
    const out: Obstacle[] = [];
    const r = this.halfWidth + margin;
    for (let depth = fromDepth; depth <= toDepth; depth += (r * 0.8) / FOCAL) out.push({ gx: this.gxAt(depth), depth, r });
    return out;
  }

  /** cos of the angle between the curve and straight-away, so offsets are square to it. */
  cosine(depth: number): number {
    const e = 0.01;
    const slope = (this.gxAt(depth + e) - this.gxAt(depth - e)) / (2 * e * FOCAL);
    return 1 / Math.hypot(1, slope);
  }
}

export const meadowPath = new GroundCurve(pathX, PATH_HALF, PATH_END_Y);
export const meadowCreek = new GroundCurve(creekX, CREEK_HALF, CREEK_END_Y);

/**
 * A tree's shadow on the grass for a sun position: the sideways shift of its
 * centre (screen px per px of crown radius; the sun in the east, at the left
 * of the view, throws shadows to the right) and how long it stretches.
 */
export function shadowCast(sunProgress: number, elevation: number): { shift: number; stretch: number } {
  const side = Math.max(-1, Math.min(1, (sunProgress - 0.5) * 2));
  const low = 1 / Math.max(0.18, elevation);
  return { shift: -side * Math.min(2.2, 0.35 * low), stretch: 1 + Math.abs(side) * Math.min(1.6, 0.25 * low) };
}
