import { GroundPlane, type GroundPoint } from './groundPlane';

/**
 * The beach after the reference drawing: from the beach house you look along
 * a shoreline that sweeps from the lower right of the view away to a point on
 * the horizon left of centre, sea to its right and sand to its left.
 *
 * It is a bay: on screen the waterline is a smooth arc, entering at the lower
 * right, sweeping up and to the left, and curling round to run along the
 * horizon under the far headland. On the ground plane that is a beach running
 * straight away from the viewer that turns across the view in the distance.
 * The arc is set by a few screen points joined by a monotone cubic.
 * Everything about the sea is measured in *shore coordinates*:
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

/** Screen points (y, x) on the still waterline, from the horizon to below the view. */
const ARC: ReadonlyArray<readonly [y: number, x: number]> = [
  [161, 296],
  [163, 310],
  [170, 350],
  [180, 398],
  [190, 437],
  [200, 471],
  [220, 530],
  [250, 603],
  [280, 665],
  [300, 702],
  [330, 750],
  [345, 772],
];

/** Fritsch–Carlson tangents, so the arc never wiggles between its points. */
const TANGENTS = ((): number[] => {
  const n = ARC.length;
  const d = ARC.slice(1).map(([y, x], i) => (x - ARC[i][1]) / (y - ARC[i][0]));
  const m = ARC.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
})();

let memoY = Number.NaN;
let memoX = 0;

/** Screen x of the still waterline on world row `y`. */
export function shoreXAtY(y: number): number {
  // Scenery is painted row by row: the same row is asked for many times running.
  if (y === memoY) return memoX;
  memoY = y;
  memoX = arcX(y);
  return memoX;
}

function arcX(y: number): number {
  const last = ARC.length - 1;
  if (y <= ARC[0][0]) return ARC[0][1] - (ARC[0][0] - y) * 2;
  if (y >= ARC[last][0]) return ARC[last][1] + (y - ARC[last][0]) * TANGENTS[last];
  let i = 0;
  while (y > ARC[i + 1][0]) i++;
  const [y0, x0] = ARC[i];
  const [y1, x1] = ARC[i + 1];
  const h = y1 - y0;
  const t = (y - y0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * x0 + (t3 - 2 * t2 + t) * h * TANGENTS[i] + (-2 * t3 + 3 * t2) * x1 + (t3 - t2) * h * TANGENTS[i + 1];
}

/** The still waterline's sideways position at a depth (ground px). */
export function shoreGx(depth: number): number {
  return (shoreXAtY(beachPlane.project(0, depth).y) - beachPlane.vanishX) * depth;
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
