import { describe, expect, it } from 'vitest';
import { fungusCluster, fungusGlow, wispWeather } from './ForestGlow';

describe('lights in the dark wood', () => {
  it('lets the foxfire glow only in the dark, a little brighter in the damp', () => {
    expect(fungusGlow(0.2, 0)).toBe(0);
    expect(fungusGlow(0.95, 0)).toBeGreaterThan(0.6);
    expect(fungusGlow(0.95, 1)).toBeGreaterThan(fungusGlow(0.95, 0));
  });

  it('only brings out wisps on a deep, misty night', () => {
    expect(wispWeather(0.95, 0.2)).toBe(0);
    expect(wispWeather(0.5, 0.9)).toBe(0);
    expect(wispWeather(0.95, 0.8)).toBeGreaterThan(0.5);
  });

  it('draws a cluster of little glowing caps', () => {
    const p = fungusCluster(5, 3);
    let lit = 0;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (p.get(x, y) === 0x9affd8) lit++;
    expect(lit).toBeGreaterThan(2);
  });
});
