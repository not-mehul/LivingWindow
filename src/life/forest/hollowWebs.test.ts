import { describe, expect, it } from 'vitest';
import { owlAtHome, owlInHole } from './OwlHollow';
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
    const count = (b: ReturnType<typeof owlInHole>) => {
      const colours = new Set<number>();
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (b.isSet(x, y)) colours.add(b.get(x, y));
      return colours.size;
    };
    expect(count(owlInHole(7, 'empty'))).toBe(1);
    expect(count(owlInHole(7, 'awake'))).toBeGreaterThan(5);
    // Its eyes open gold when it's awake.
    const awake = owlInHole(7, 'awake');
    let gold = false;
    for (let y = 0; y < awake.height; y++) for (let x = 0; x < awake.width; x++) if (awake.get(x, y) === 0xf0c040) gold = true;
    expect(gold).toBe(true);
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
