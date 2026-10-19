import { describe, expect, it } from 'vitest';
import { drawOwlInHollow, type HollowFace } from '../../sprites/owlSprites';
import { owlAtHome } from './OwlHollow';
import { drawWeb, webShine } from './Webs';

describe('the owl in the oak', () => {
  it('sleeps in by day, peers out at dusk and dawn, and is out hunting at night', () => {
    expect(owlAtHome(13)).toBe('asleep');
    expect(owlAtHome(19.5)).toBe('peering');
    expect(owlAtHome(23)).toBe('out');
    expect(owlAtHome(3)).toBe('out');
    expect(owlAtHome(5.8)).toBe('peering');
  });

  it('shows its face in the hole, and an empty hole when it is out', () => {
    const colours = (face: HollowFace) => new Set(drawOwlInHollow(7, face).grid.data.filter((c) => c !== 0)).size;
    expect(colours('empty')).toBeLessThanOrEqual(3);
    expect(colours('awake')).toBeGreaterThan(8);
    // Its eyes catch the light when it's awake, and are shut lids while it dozes.
    const glinting = (face: HollowFace) => {
      const { grid, palette } = drawOwlInHollow(7, face);
      return grid.data.some((c) => palette.colors[c] === 0xfff4e0);
    };
    expect(glinting('awake')).toBe(true);
    expect(glinting('sleep')).toBe(false);
  });
});

describe('spider webs', () => {
  it('glisten most in a low morning sun and all but vanish at night', () => {
    expect(webShine(7.5, true, 1)).toBeGreaterThan(webShine(13, true, 1));
    expect(webShine(23, false, 1)).toBeLessThan(0.1);
  });

  it('are spun with spokes and a spiral, and bead with dew', () => {
    const web = drawWeb(14, 3);
    let silk = 0;
    for (let y = 0; y < web.buffer.height; y++) for (let x = 0; x < web.buffer.width; x++) if (web.buffer.isSet(x, y)) silk++;
    expect(silk).toBeGreaterThan(80);
    expect(web.beads.length).toBeGreaterThan(5);
  });
});
