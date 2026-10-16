import { describe, expect, it } from 'vitest';
import { casementGeometry, projectedOpenWidth, quadContains, sashQuad, BASE_OPEN_ANGLE } from './casement';

const height = (a: { y: number }, b: { y: number }) => Math.abs(b.y - a.y);

describe('casement sashes', () => {
  // A 16:9 screen at frame scale 3: 640 × 360 art px, minus the frame.
  const g = casementGeometry(12, 14, 616, 320);

  it('meet in the middle and tile the opening when closed', () => {
    const left = sashQuad(g, 'left', 0);
    const right = sashQuad(g, 'right', 0);
    expect(left.topLeft).toEqual({ x: 12, y: 14 });
    expect(left.topRight.x).toBeCloseTo(320);
    expect(right.topLeft.x).toBeCloseTo(320);
    expect(right.bottomRight).toEqual({ x: 628, y: 334 });
    expect(height(left.topRight, left.bottomRight)).toBeCloseTo(320);
  });

  it('swing their free stile away from the viewer: shorter and toward the middle', () => {
    const open = sashQuad(g, 'left', g.openAngle);
    const hingeHeight = height(open.topLeft, open.bottomLeft);
    const freeHeight = height(open.topRight, open.bottomRight);
    expect(freeHeight).toBeLessThan(hingeHeight);
    expect(freeHeight).toBeGreaterThan(hingeHeight * 0.7);
    // The free stile stays inside the opening, between the hinge and the middle.
    expect(open.topRight.x).toBeGreaterThan(open.topLeft.x);
    expect(open.topRight.x).toBeLessThan(g.eyeX);
    // The tops converge more than the bottoms (the eye sits low).
    expect(open.topRight.y - open.topLeft.y).toBeGreaterThan(open.bottomLeft.y - open.bottomRight.y);
  });

  it('mirrors the right sash', () => {
    const left = sashQuad(g, 'left', g.openAngle);
    const right = sashQuad(g, 'right', g.openAngle);
    expect(right.topLeft.x - g.eyeX).toBeCloseTo(g.eyeX - left.topRight.x);
    expect(right.topLeft.y).toBeCloseTo(left.topRight.y);
  });

  it('narrows steadily as it opens', () => {
    let previous = Infinity;
    for (let a = 0; a <= g.openAngle; a += 0.1) {
      const width = projectedOpenWidth(g, a);
      expect(width).toBeLessThan(previous);
      previous = width;
    }
  });

  it('keeps open sashes slim on ultrawide and portrait screens', () => {
    const ultrawide = casementGeometry(12, 14, 836, 320);
    expect(ultrawide.openAngle).toBeGreaterThan(BASE_OPEN_ANGLE);
    expect(projectedOpenWidth(ultrawide, ultrawide.openAngle)).toBeLessThanOrEqual(320 * 0.3 + 1e-6);
    const portrait = casementGeometry(10, 14, 214, 380);
    expect(portrait.openAngle).toBeCloseTo(BASE_OPEN_ANGLE);
    expect(projectedOpenWidth(portrait, portrait.openAngle)).toBeLessThan(214 / 4);
  });

  it('hit-tests the projected outline', () => {
    const open = sashQuad(g, 'left', g.openAngle);
    expect(quadContains(open, open.topLeft.x + 4, 160)).toBe(true);
    expect(quadContains(open, g.eyeX, 160)).toBe(false);
  });
});
