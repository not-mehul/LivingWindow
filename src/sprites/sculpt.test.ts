import { describe, expect, it } from 'vitest';
import { furGrain, Sculpt, smoothPath } from './sculpt';
import { PixelGrid } from './raster';

const count = (s: Sculpt, part?: number) => {
  let n = 0;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (part === undefined ? s.partAt(x, y) : s.partAt(x, y) === part) n++;
  return n;
};

describe('sculpted forms', () => {
  it('runs a smooth curve through its points', () => {
    const path = smoothPath([[0, 0], [10, 10], [20, 0]], false, 4);
    expect(path[0]).toEqual([0, 0]);
    expect(path[path.length - 1]).toEqual([20, 0]);
    expect(path.some(([x, y]) => Math.abs(x - 10) < 0.01 && Math.abs(y - 10) < 0.01)).toBe(true);
  });

  it('sweeps a tube that is as wide as asked along its length', () => {
    const s = new Sculpt(60, 30);
    s.sweep(1, [[5, 15], [30, 15], [55, 15]], [16, 8, 2]);
    const across = (x: number) => {
      let n = 0;
      for (let y = 0; y < 30; y++) if (s.partAt(x, y)) n++;
      return n;
    };
    expect(across(5)).toBeGreaterThanOrEqual(14);
    expect(across(30)).toBeGreaterThanOrEqual(7);
    expect(across(30)).toBeLessThanOrEqual(10);
    expect(across(54)).toBeLessThanOrEqual(3);
  });

  it('fills an outline and shades it lit on the upper left, shadowed lower right', () => {
    const s = new Sculpt(40, 40);
    s.outline(1, [[5, 5], [35, 8], [33, 34], [8, 30]]);
    expect(count(s)).toBeGreaterThan(500);
    const g = new PixelGrid(40, 40);
    const ramp = [1, 2, 3, 4, 5] as const;
    s.paint(g, () => ramp, { dither: false });
    expect(g.get(9, 9)).toBeGreaterThan(g.get(31, 30));
  });

  it('casts a shadow on the part beneath along the join', () => {
    const shade = (withLump: boolean) => {
      const s = new Sculpt(40, 40);
      s.outline(1, [[2, 2], [38, 2], [38, 38], [2, 38]], { sharp: true });
      if (withLump) s.ellipse(2, 20, 15, 6, 6);
      const g = new PixelGrid(40, 40);
      s.paint(g, () => [1, 2, 3, 4, 5] as const, { dither: false });
      return g.get(20, 21);
    };
    // Just below the lump the body is darker than it is without the lump there.
    expect(shade(true)).toBeLessThan(shade(false));
  });

  it('roughens a furry edge into tufts', () => {
    const smooth = new Sculpt(40, 40);
    const furry = new Sculpt(40, 40);
    smooth.ellipse(1, 20, 20, 12, 12);
    furry.ellipse(1, 20, 20, 12, 12, 0, { fur: { amount: 1, dir: [0, 1] } });
    expect(count(furry)).not.toBe(count(smooth));
  });

  it('lays a fur grain along the strands', () => {
    // Along the strands it changes slowly; across them, quickly.
    const along = Math.abs(furGrain(10, 10, Math.PI / 2) - furGrain(10, 11, Math.PI / 2));
    const across = Math.abs(furGrain(10, 10, Math.PI / 2) - furGrain(11.5, 10, Math.PI / 2));
    expect(along).toBeLessThan(across + 0.3);
  });
});
