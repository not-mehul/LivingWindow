import { describe, expect, it } from 'vitest';
import { FOCAL } from './groundPlane';
import { meadowCreek, meadowPath, meadowPlane, PATH_END_Y, shadowCast } from './meadowGeometry';

describe('meadow path', () => {
  it('comes in from the lower left, swings right and winds away to the tree line', () => {
    expect(meadowPath.centreX(300)).toBeLessThan(200);
    expect(meadowPath.centreX(236)).toBeGreaterThan(380);
    expect(meadowPath.centreX(210)).toBeGreaterThan(meadowPath.centreX(195));
    expect(meadowPath.contains(meadowPath.centreX(PATH_END_Y - 2), PATH_END_Y - 2)).toBe(false);
  });

  it('keeps its width on the ground, so it narrows into the distance', () => {
    const screenWidth = (y: number) => {
      let n = 0;
      for (let x = 0; x < 840; x++) if (meadowPath.contains(x, y)) n++;
      return n;
    };
    expect(screenWidth(300)).toBeGreaterThan(screenWidth(250));
    expect(screenWidth(250)).toBeGreaterThan(screenWidth(205));
    expect(screenWidth(205)).toBeGreaterThan(0);
  });

  it('round-trips between path coordinates and the world', () => {
    for (const [depth, across] of [
      [1.5, 20],
      [3, -30],
      [6, 10],
    ]) {
      const p = meadowPath.point(depth, across);
      expect(meadowPlane.depthAtY(p.y)).toBeCloseTo(depth);
      expect(meadowPath.offset(p.x, p.y)).toBeCloseTo(across);
    }
  });
});

describe('meadow creek', () => {
  it('never meets the path', () => {
    for (let y = 192; y < 350; y++) {
      const gap = (meadowCreek.centreX(y) - meadowPath.centreX(y)) * meadowPlane.depthAtY(y);
      expect(gap).toBeGreaterThan(meadowCreek.halfWidth + meadowPath.halfWidth + 40);
    }
  });

  it('meanders: in to the left, then back out to the right', () => {
    expect(meadowCreek.centreX(248)).toBeLessThan(meadowCreek.centreX(290));
    expect(meadowCreek.centreX(248)).toBeLessThan(meadowCreek.centreX(214));
  });

  it('is fenced off for walkers along its length', () => {
    const obstacles = meadowCreek.obstacles(1.4, 4, 10);
    expect(obstacles.length).toBeGreaterThan(10);
    for (let i = 1; i < obstacles.length; i++) {
      const a = obstacles[i - 1];
      const b = obstacles[i];
      // Consecutive circles overlap, so there is no gap to slip through.
      expect(Math.hypot(a.gx - b.gx, (a.depth - b.depth) * FOCAL)).toBeLessThan(a.r + b.r);
    }
  });
});

describe('tree shadows', () => {
  it('fall away from the sun and lengthen as it sinks', () => {
    expect(shadowCast(0.15, 0.4).shift).toBeGreaterThan(0);
    expect(shadowCast(0.85, 0.4).shift).toBeLessThan(0);
    expect(Math.abs(shadowCast(0.5, 1).shift)).toBeLessThan(0.05);
    expect(shadowCast(0.1, 0.2).stretch).toBeGreaterThan(shadowCast(0.3, 0.7).stretch);
  });
});
