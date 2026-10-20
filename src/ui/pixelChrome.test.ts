import { describe, expect, it } from 'vitest';
import { ALU, BEZEL } from '../window/SillTablet';
import { BEZEL_PIXELS, bezelPixels } from './pixelChrome';
import { ICON_ART, pixelIcon } from './pixelIcons';

describe('panel bezel', () => {
  const p = bezelPixels();
  const n = BEZEL_PIXELS * 2 + 1;

  it('is a 9-slice with the screen left empty', () => {
    expect([p.width, p.height]).toEqual([n, n]);
    expect(p.get(BEZEL_PIXELS, BEZEL_PIXELS)).toBe(-1);
    expect(p.get(BEZEL_PIXELS, BEZEL_PIXELS - 1)).toBe(BEZEL);
  });

  it('has stepped corners and the sprite’s lit and shaded aluminium edges', () => {
    expect(p.get(0, 0)).toBe(-1);
    expect(p.get(n - 1, n - 1)).toBe(-1);
    expect(p.get(0, BEZEL_PIXELS)).toBe(ALU.light);
    expect(p.get(n - 1, BEZEL_PIXELS)).toBe(ALU.dark);
    expect(p.get(BEZEL_PIXELS, 0)).toBe(ALU.base);
    expect(p.get(BEZEL_PIXELS, n - 1)).toBe(ALU.edge);
  });

  it('is symmetric in shape', () => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) expect(p.isSet(x, y)).toBe(p.isSet(n - 1 - x, n - 1 - y));
  });
});

describe('pixel icons', () => {
  it('are 12×12 and use only known colours', () => {
    for (const [name, rows] of Object.entries(ICON_ART)) {
      expect(rows.length, name).toBe(12);
      for (const row of rows) {
        expect(row.length, name).toBe(12);
        expect(row, name).toMatch(/^[.#socmdrlw]+$/);
      }
    }
  });

  it('render as crisp SVG, one rect per run', () => {
    const svg = pixelIcon('pause');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // Two bars across eight rows.
    expect(svg.match(/<rect /g)?.length).toBe(16);
    expect(svg).toContain('fill="currentColor"');
  });
});
