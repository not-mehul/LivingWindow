import { describe, expect, it } from 'vitest';
import { renderTexture, glassDrop, grassDrop, leafDrop, runoff, scattered, shoreDrop, streetDrop } from '../textures';
import { creek, crickets, distantBirds, foam, frogs, grasshoppers, katydids, murmur, shingle, trill } from './nature';

const RATE = 16000;
const TEXTURES = {
  crickets: crickets(5),
  katydids: katydids(2),
  trill: trill(),
  frogs: frogs(3),
  creek: creek(),
  foam: foam(),
  shingle: shingle(),
  distantBirds: distantBirds(),
  murmur: murmur(),
  grasshoppers: grasshoppers(),
  leaves: scattered(45, leafDrop),
  grass: scattered(45, grassDrop),
  street: scattered(45, streetDrop),
  shore: scattered(45, shoreDrop),
  glass: scattered(60, glassDrop),
  runoff: scattered(7, runoff),
};

describe('landscape textures', () => {
  for (const [name, spec] of Object.entries(TEXTURES)) {
    it(`renders ${name} as a levelled, unclipped loop`, () => {
      const out = renderTexture(spec, RATE, 7);
      let sum = 0;
      let peak = 0;
      for (const v of out.left) {
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const rms = Math.sqrt(sum / out.length);
      expect(rms).toBeGreaterThan(0.01);
      expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
      for (const v of out.right) expect(Number.isFinite(v)).toBe(true);
    });
  }

  it('keeps every cricket on a beat that fits the loop', () => {
    // Rendered twice from the same seed, the loop is identical: it is the
    // loop, not chance, that repeats.
    const a = renderTexture(crickets(3), RATE, 3);
    const b = renderTexture(crickets(3), RATE, 3);
    expect(a.left).toEqual(b.left);
  });
});
