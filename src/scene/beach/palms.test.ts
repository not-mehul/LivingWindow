import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SwayMesh } from '../common/SwayMesh';
import { drawPalm, drawSeaOats, flattenPalm } from './beachGenerator';

describe('palms in parts', () => {
  const palm = drawPalm(300, 40, 7);

  it('cut the trunk, every frond and the coconuts out on their own', () => {
    expect(palm.fronds.length).toBeGreaterThanOrEqual(10);
    for (const part of [palm.trunk, palm.hub, ...palm.fronds]) {
      let set = 0;
      for (let y = 0; y < part.art.height; y++) for (let x = 0; x < part.art.width; x++) if (part.art.isSet(x, y)) set++;
      expect(set).toBeGreaterThan(4);
    }
    // The trunk runs from its base up to the crown.
    expect(palm.trunk.y).toBeLessThanOrEqual(palm.crown.y);
    expect(palm.trunk.y + palm.trunk.art.height).toBeGreaterThanOrEqual(palm.baseY);
  });

  it('hold each frond at the crown', () => {
    for (const f of palm.fronds) {
      expect(f.x + f.pivotX).toBe(palm.crown.x);
      expect(f.pivotX).toBeGreaterThanOrEqual(0);
      expect(f.pivotX).toBeLessThan(f.art.width);
      // It reaches the way it says.
      const centre = f.art.width / 2;
      if (f.side < 0) expect(f.pivotX).toBeGreaterThanOrEqual(centre - 4);
      else expect(f.pivotX).toBeLessThanOrEqual(centre + 4);
    }
  });

  it('go back together into one piece for the far ones', () => {
    const flat = flattenPalm(palm);
    expect(flat.width).toBe(palm.width);
    expect(flat.isSet(Math.round(palm.crown.x), Math.round(palm.crown.y))).toBe(true);
  });
});

describe('a frond held at its root', () => {
  it('stays put at the pivot and bobs on both sides of it', () => {
    const texture = new Texture({ source: new TextureSource({ width: 120, height: 40 }) });
    const frond = new SwayMesh(texture, { anchor: 'left', pivotX: 40, amplitude: 5, phase: 1 });
    frond.update(2.3, 0.8);
    expect(Math.abs(frond.offsetAt(40, 10).y)).toBeLessThan(0.3);
    expect(Math.abs(frond.offsetAt(119, 10).y)).toBeGreaterThan(1);
    expect(Math.abs(frond.offsetAt(0, 10).y)).toBeGreaterThan(0.2);
    expect(Math.abs(frond.offsetAt(119, 10).y)).toBeGreaterThan(Math.abs(frond.offsetAt(0, 10).y));
  });
});

describe('sea oats', () => {
  it('stand taller than they are wide, with seed heads up top', () => {
    let rng = 0.3;
    const next = () => (rng = (rng * 9301 + 0.49297) % 1);
    const art = drawSeaOats(next, 1.5);
    expect(art.height).toBeGreaterThan(art.width * 0.9);
    let high = 0;
    for (let y = 0; y < art.height * 0.4; y++) for (let x = 0; x < art.width; x++) if (art.isSet(x, y)) high++;
    expect(high).toBeGreaterThan(5);
  });
});
