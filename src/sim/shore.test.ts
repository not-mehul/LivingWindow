import { describe, expect, it } from 'vitest';
import { BEACH_HORIZON, beachPlane, shoreCoords, shorePoint, shoreXAtY } from './shore';

describe('shoreline geometry', () => {
  it('sweeps from the lower right to a point on the horizon left of centre', () => {
    // Near the right of a 16:9 view at the bottom...
    expect(shoreXAtY(330)).toBeGreaterThan(760);
    expect(shoreXAtY(300)).toBeGreaterThan(680);
    // ...crossing the middle of the view...
    expect(shoreXAtY(220)).toBeGreaterThan(480);
    expect(shoreXAtY(220)).toBeLessThan(600);
    // ...to vanish just right of centre at the horizon.
    expect(shoreXAtY(BEACH_HORIZON + 2)).toBeGreaterThan(420);
    expect(shoreXAtY(BEACH_HORIZON + 2)).toBeLessThan(470);
  });

  it('curves: the waterline flattens out near the viewer', () => {
    const slope = (y: number) => shoreXAtY(y + 1) - shoreXAtY(y);
    expect(slope(300)).toBeGreaterThan(slope(200));
  });

  it('round-trips between shore coordinates and the world', () => {
    const p = shorePoint(2.2, -35);
    const back = shoreCoords(p.x, p.y);
    expect(back.depth).toBeCloseTo(2.2);
    expect(back.s).toBeCloseTo(-35);
    // Sea is to the right of the waterline, sand to the left.
    expect(shoreCoords(shoreXAtY(250) + 10, 250).s).toBeGreaterThan(0);
    expect(shoreCoords(shoreXAtY(250) - 10, 250).s).toBeLessThan(0);
    expect(shorePoint(2, 0).y).toBe(beachPlane.project(0, 2).y);
  });
});
