import { describe, expect, it } from 'vitest';
import { BUNCHED, flockSpot, LOOSE, screenGap, type GroundSpot } from './flock';
import { meadowPlane } from './meadowGeometry';

/** A seeded generator, so the test is the same every run. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function place(spread: typeof LOOSE, n: number, seed: number): Array<{ x: number; y: number }> {
  const rng = seeded(seed);
  const centre = { gx: -250, depth: 2.3 };
  const spots: GroundSpot[] = [];
  for (let i = 0; i < n; i++) spots.push(flockSpot(meadowPlane, centre, spots, spread, { depth0: 1.5, depth1: 3.3 }, undefined, rng)!);
  return spots.map((s) => meadowPlane.project(s.gx, s.depth));
}

const spreadOf = (pts: Array<{ x: number; y: number }>) => ({
  across: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
  down: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)),
});

describe('flock spots', () => {
  it('scatter a loose flock up and down the field, not in a line', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = spreadOf(place(LOOSE, 6, seed));
      expect(s.across).toBeGreaterThan(50);
      expect(s.down).toBeGreaterThan(12);
    }
  });

  it('keep sheep apart on screen', () => {
    const pts = place(LOOSE, 6, 7);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(LOOSE.apart);
    }
  });

  it('bunch tighter ahead of the dog', () => {
    const loose = spreadOf(place(LOOSE, 6, 11));
    const tight = spreadOf(place(BUNCHED, 6, 11));
    expect(tight.across).toBeLessThan(loose.across);
    expect(tight.down).toBeLessThan(loose.down);
  });

  it('give up on blocked ground, and measure gaps on screen', () => {
    expect(flockSpot(meadowPlane, { gx: 0, depth: 2 }, [], LOOSE, { depth0: 1.5, depth1: 3 }, () => true)).toBeNull();
    expect(screenGap(meadowPlane, { gx: 0, depth: 2 }, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
