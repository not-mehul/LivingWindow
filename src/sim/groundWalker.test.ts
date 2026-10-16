import { describe, expect, it } from 'vitest';
import { createRng } from '../core/random';
import { GroundPlane } from './groundPlane';
import { GroundWalker, type WalkArea } from './groundWalker';

describe('GroundPlane', () => {
  const plane = new GroundPlane(200, 140);

  it('puts depth 1 eye px below the horizon, centred on the vanishing point', () => {
    expect(plane.project(0, 1)).toEqual({ x: 420, y: 340, scale: 1 });
  });

  it('shrinks and converges things with distance', () => {
    const near = plane.project(100, 1);
    const far = plane.project(100, 2);
    expect(far.scale).toBe(0.5);
    expect(far.y).toBe(270);
    expect(far.x - 420).toBe((near.x - 420) / 2);
  });

  it('round-trips through unproject', () => {
    const p = plane.project(-80, 2.5);
    const back = plane.unproject(p.x, p.y);
    expect(back.depth).toBeCloseTo(2.5);
    expect(back.gx).toBeCloseTo(-80);
    expect(plane.depthAtY(150)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('GroundWalker', () => {
  const plane = new GroundPlane(200, 140);
  const area: WalkArea = { minDepth: 1.2, maxDepth: 3, halfWidth: (d) => 300 * d };

  it('stays inside its area while wandering', () => {
    const w = new GroundWalker(plane, area, 0, 2, 0, createRng(9));
    w.speed = 25;
    for (let i = 0; i < 20000; i++) {
      w.update(1 / 30);
      expect(w.depth).toBeGreaterThanOrEqual(1.2);
      expect(w.depth).toBeLessThanOrEqual(3);
      expect(Math.abs(w.gx)).toBeLessThanOrEqual(300 * w.depth + 1e-6);
    }
  });

  it('really moves in depth, not just sideways', () => {
    const w = new GroundWalker(plane, area, 0, 2, 0, createRng(4));
    w.speed = 25;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 6000; i++) {
      w.update(1 / 30);
      minY = Math.min(minY, w.point.y);
      maxY = Math.max(maxY, w.point.y);
    }
    expect(maxY - minY).toBeGreaterThan(20);
  });

  it('reaches a seek target', () => {
    const w = new GroundWalker(plane, area, -200, 1.5, 0, createRng(1));
    w.speed = 30;
    w.steering = { kind: 'seek', gx: 150, depth: 2.6 };
    for (let i = 0; i < 2000 && w.distanceTo(150, 2.6) > 5; i++) w.update(1 / 30);
    expect(w.distanceTo(150, 2.6)).toBeLessThanOrEqual(5);
  });

  it('leaves the panorama when exiting, and faces the way it goes', () => {
    const w = new GroundWalker(plane, area, 0, 2, Math.PI / 2, createRng(2));
    w.speed = 120;
    w.steering = { kind: 'exit', side: -1 };
    for (let i = 0; i < 600 && !w.gone; i++) w.update(1 / 30);
    expect(w.gone).toBe(true);
    expect(w.facing).toBe(-1);
  });
});
