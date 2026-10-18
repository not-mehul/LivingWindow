import { describe, expect, it } from 'vitest';
import { CITY_HORIZON, projectPoint } from '../../sim/cityGeometry';
import { generateCity, poolFalloff, POOL_REACH } from './cityGenerator';

const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);

describe('poolFalloff', () => {
  it('is brightest at the source and fades to nothing at its reach', () => {
    expect(poolFalloff(10, 2, 10, 2, 60)).toBe(1);
    expect(poolFalloff(70, 2, 10, 2, 60)).toBe(0);
    let last = 1;
    for (let d = 0; d <= 60; d += 5) {
      const f = poolFalloff(10 + d, 2, 10, 2, 60);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });
});

describe('generateCity light pools', () => {
  const city = generateCity();
  it('gives every night stall and lamp short of the skybridge its own pool', () => {
    city.stallSpots.forEach((spot, i) => {
      if (spot.shift === 'night' && spot.depth < 5) expect(city.pools.some((p) => p.source === 'stall' && p.index === i)).toBe(true);
      if (spot.shift === 'day') expect(city.pools.some((p) => p.source === 'stall' && p.index === i)).toBe(false);
    });
    city.lamps.forEach((lamp, i) => {
      if (lamp.depth < 5) expect(city.pools.some((p) => p.source === 'lamp' && p.index === i)).toBe(true);
    });
  });

  it('lights the street brightest at the source', () => {
    for (const pool of city.pools) {
      const at =
        pool.source === 'lamp'
          ? { gx: city.lamps[pool.index].gx, depth: city.lamps[pool.index].depth }
          : { gx: city.stallSpots[pool.index].gx * 0.8, depth: city.stallSpots[pool.index].depth };
      // Further off a pool is only a few pixels deep.
      if (at.depth > 2.6) continue;
      const sample = (gx: number, depth: number) => {
        const p = projectPoint(gx, depth);
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, lum(Math.max(0, pool.art.get(Math.round(p.x) - pool.x + dx, Math.round(p.y) - pool.y + dy))));
        return best;
      };
      const heart = sample(at.gx, at.depth);
      // Hidden behind our own parapet.
      if (heart === 0) continue;
      const reach = POOL_REACH[pool.source];
      expect(heart, `${pool.source} ${pool.index} along`).toBeGreaterThan(sample(at.gx, at.depth + reach / 700));
      expect(heart, `${pool.source} ${pool.index} across`).toBeGreaterThan(sample(at.gx - reach * 0.8, at.depth));
    }
  });

  it('keeps the light down on the street, mostly on the paving', () => {
    let lit = 0;
    let paving = 0;
    for (const pool of city.pools) {
      for (let y = 0; y < pool.art.height; y++) {
        for (let x = 0; x < pool.art.width; x++) {
          if (!pool.art.isSet(x, y)) continue;
          lit++;
          expect(pool.y + y).toBeGreaterThan(CITY_HORIZON);
          if (city.streetMask[(pool.y + y) * city.over.width + pool.x + x]) paving++;
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(paving / lit).toBeGreaterThan(0.6);
  });
});

describe('city screens', () => {
  const city = generateCity();
  it('puts every billboard in the world, each showing its ad on some of its pixels', () => {
    expect(city.billboards.length).toBeGreaterThanOrEqual(8);
    for (const b of city.billboards) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(840);
      expect(b.y + b.h).toBeLessThanOrEqual(360);
      const shown = b.map.filter((a) => a >= 0);
      expect(shown.length, b.ad).toBeGreaterThan(b.w * b.h * 0.3);
      for (const a of shown) expect(a).toBeLessThan(b.artW * b.artH);
    }
  });

  it('keeps exactly one worn-out neon sign', () => {
    expect(city.signs.filter((s) => s.broken).length).toBe(1);
  });
});
