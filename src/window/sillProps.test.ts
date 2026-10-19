import { describe, expect, it } from 'vitest';
import { curtainWidth, dishSize, nearness, plantSize, tabletSize } from './sillProps';

describe('sill props', () => {
  it('are full size on desktop and ultrawide views', () => {
    expect(nearness(640)).toBe(1);
    expect(nearness(860)).toBe(1);
    expect(dishSize(1).width).toBe(78);
    expect(plantSize(1).potHeight + plantSize(1).leavesHeight).toBeGreaterThan(110);
  });

  it('shrink on phones, but no further than the floor', () => {
    expect(nearness(234)).toBe(0.6);
    expect(nearness(100)).toBe(0.6);
    expect(dishSize(0.65).width).toBeLessThan(dishSize(1).width);
    expect(dishSize(0.65).width % 2).toBe(0);
  });

  it('quantise, so small resizes do not rebuild the art', () => {
    expect(nearness(500)).toBe(nearness(503));
    expect(Number.isInteger(nearness(431) * 20)).toBe(true);
  });

  it('leave a portrait phone enough sill for the cat to walk', () => {
    const view = 234;
    const k = nearness(view);
    // The tablet in the right-hand corner takes its strip of sill too.
    const usable = view - plantSize(k).reserve - (curtainWidth(view) - 6) - tabletSize(k).reserve;
    expect(usable).toBeGreaterThanOrEqual(100);
    // And the dish fits in it with room beside it for a bird.
    expect(dishSize(k).width + 2 * 24).toBeLessThan(usable);
  });

  it('give the tablet a strip of sill that grows with the view', () => {
    expect(tabletSize(1).reserve).toBeGreaterThan(tabletSize(1).width);
    expect(tabletSize(0.65).width).toBeLessThan(tabletSize(1).width);
    expect(tabletSize(0.65).width % 2).toBe(0);
  });
});
