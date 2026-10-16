import { describe, expect, it } from 'vitest';
import { boxFrom, castBox, CITY_EYE, CITY_HORIZON, CITY_VANISH_X, cityPlane, projectPoint } from './cityGeometry';

const ray = (x: number, y: number) => [x - CITY_VANISH_X, y - CITY_HORIZON] as const;

describe('city camera', () => {
  it('puts the street at depth 1 along the bottom of the view', () => {
    expect(cityPlane.project(0, 1).y).toBe(360);
    expect(projectPoint(0, 1).y).toBe(360);
    // Something as tall as the eye sits on the horizon at any depth.
    expect(projectPoint(50, 3, CITY_EYE).y).toBeCloseTo(CITY_HORIZON);
  });
});

describe('casting rays into boxes', () => {
  const tower = boxFrom(-100, 100, 4, 5, 0, 600);
  const low = boxFrom(-100, 100, 2, 3, 0, 100);

  it('meets a box straight ahead on its front face', () => {
    const hit = castBox(tower, ...ray(CITY_VANISH_X, 150));
    expect(hit?.face).toBe('front');
    expect(hit?.depth).toBeCloseTo(4);
  });

  it('sees the top of a building below eye level, but never of one above it', () => {
    // Just above the low block's front edge on screen: its roof.
    const edge = projectPoint(0, 2, 100);
    expect(castBox(low, ...ray(CITY_VANISH_X, edge.y - 2))?.face).toBe('top');
    expect(castBox(low, ...ray(CITY_VANISH_X, edge.y + 2))?.face).toBe('front');
    for (let y = 0; y < 360; y += 5) expect(castBox(tower, ...ray(CITY_VANISH_X + 10, y))?.face).not.toBe('top');
  });

  it('sees the street-side walls of buildings along the street', () => {
    const left = boxFrom(-300, -80, 1.5, 6, 0, 300);
    // Looking at the left building line from the street.
    const p = projectPoint(-80, 3, 50);
    const hit = castBox(left, ...ray(p.x + 0.05, p.y));
    expect(hit?.face).toBe('right');
    expect(hit?.depth).toBeCloseTo(3, 1);
    expect(hit?.h).toBeCloseTo(50, 0);
  });

  it('turns boxes about the vertical', () => {
    const wall = { gx: 0, depth: 3, halfU: 200, halfW: 10, h0: 0, h1: 50, angle: Math.PI / 4 };
    const hit = castBox(wall, ...ray(CITY_VANISH_X, projectPoint(0, 3, 25).y));
    expect(hit).not.toBeNull();
    // Straight ahead it meets the wall's near face, just off its middle (the face is turned 45°).
    expect(hit?.face).toBe('front');
    expect(Math.abs(hit!.u)).toBeLessThan(15);
  });

  it('misses what is not in the way', () => {
    expect(castBox(tower, ...ray(10, 150))).toBeNull();
  });
});
