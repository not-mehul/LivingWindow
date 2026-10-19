import { describe, expect, it } from 'vitest';
import { drawOutcrop, poolShapes } from './rocks';

describe('the rocky point', () => {
  const outcrop = drawOutcrop((c) => c);

  it('stands in clusters with perches on top and spray off the seaward faces', () => {
    expect(outcrop.clusters.length).toBe(2);
    for (const c of outcrop.clusters) {
      expect(c.art.width).toBeGreaterThan(10);
      expect(c.baseY).toBeGreaterThan(c.y);
      expect(c.baseY).toBeLessThanOrEqual(c.y + c.art.height);
    }
    expect(outcrop.ledges.length).toBeGreaterThan(1);
    expect(outcrop.spray.every((p) => p.s > 20)).toBe(true);
    expect(outcrop.feet.length).toBeGreaterThan(outcrop.spray.length - 1);
  });

  it('keeps its pools up the sand, in front of the boulders', () => {
    for (const p of poolShapes()) {
      expect(p.s).toBeLessThan(0);
      expect(p.hw).toBeGreaterThan(p.hh);
      expect(p.hh).toBeGreaterThan(1);
    }
  });
});
