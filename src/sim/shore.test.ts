import { describe, expect, it } from 'vitest';
import { BEACH_HORIZON, beachPlane, shoreCoords, shorePoint, shoreXAtY } from './shore';

describe('shoreline geometry', () => {
  it('sweeps from the lower right round to the far headland left of centre', () => {
    // Near the right of a 16:9 view at the bottom...
    expect(shoreXAtY(330)).toBeGreaterThan(730);
    expect(shoreXAtY(300)).toBeGreaterThan(670);
    // ...crossing the middle of the view...
    expect(shoreXAtY(220)).toBeGreaterThan(480);
    expect(shoreXAtY(220)).toBeLessThan(580);
    // ...and curling round along the horizon to end left of centre.
    expect(shoreXAtY(BEACH_HORIZON + 2)).toBeGreaterThan(300);
    expect(shoreXAtY(BEACH_HORIZON + 2)).toBeLessThan(380);
  });

  it('is a bay: the waterline bows inland of the chord between its ends', () => {
    const chord = (y: number) => shoreXAtY(330) + ((shoreXAtY(163) - shoreXAtY(330)) * (y - 330)) / (163 - 330);
    for (const y of [180, 200, 230, 260, 290]) expect(shoreXAtY(y)).toBeGreaterThan(chord(y) + 10);
  });

  it('curves smoothly: it flattens towards the horizon', () => {
    const slope = (y: number) => shoreXAtY(y + 1) - shoreXAtY(y);
    for (let y = 162; y < 335; y++) expect(slope(y)).toBeGreaterThanOrEqual(slope(y + 1) - 0.05);
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
