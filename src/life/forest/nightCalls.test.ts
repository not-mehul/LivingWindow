import { describe, expect, it } from 'vitest';
import { ravenActivity, stagRut, wolfActivity } from '../../sim/wildlife';
import { drawWolf } from '../../sprites/wildSprites';

describe('the forest at night', () => {
  it('brings the wolves only on moonlit nights', () => {
    expect(wolfActivity(23, 0.8)).toBeGreaterThan(0.5);
    expect(wolfActivity(23, 0)).toBe(0);
    expect(wolfActivity(14, 1)).toBe(0);
  });

  it('has stags bugling at dawn in the autumn rut, and ravens about by day', () => {
    expect(stagRut(9, 6.5)).toBe(true);
    expect(stagRut(9, 14)).toBe(false);
    expect(stagRut(4, 6.5)).toBe(false);
    expect(ravenActivity(11)).toBe(1);
    expect(ravenActivity(23)).toBe(0);
  });

  it('draws a wolf walking, sitting and howling', () => {
    for (const h of [6, 12, 20, 30]) {
      for (const pose of ['walk-1', 'walk-2', 'walk-3', 'walk-4', 'sit', 'howl'] as const) {
        const { grid } = drawWolf(pose, h);
        expect(grid.height).toBe(h);
        expect(grid.isEmpty()).toBe(false);
      }
    }
    expect(Array.from(drawWolf('sit', 24).grid.data).join()).not.toBe(Array.from(drawWolf('howl', 24).grid.data).join());
  });
});
