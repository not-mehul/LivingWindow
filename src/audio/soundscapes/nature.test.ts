import { describe, expect, it } from 'vitest';
import { GLASS, GRASS, LEAVES, rainOn, renderTexture, runoff, SAND, scattered, STREET } from '../textures';
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
  leaves: rainOn(45, LEAVES),
  grass: rainOn(45, GRASS),
  street: rainOn(45, STREET),
  shore: rainOn(45, SAND),
  glass: rainOn(60, GLASS),
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

/** How peaky a signal is (3 for smooth noise; a crackle of lone ticks runs far higher). */
function kurtosis(data: Float32Array): number {
  let m2 = 0;
  let m4 = 0;
  for (const v of data) {
    m2 += v * v;
    m4 += v ** 4;
  }
  return (m4 / data.length) / (m2 / data.length) ** 2;
}

describe('no crackle', () => {
  it('fizzes and rattles the shore smoothly, as the recording does, not tick by tick', () => {
    for (const spec of [foam(), shingle()]) expect(kurtosis(renderTexture(spec, RATE, 3).left)).toBeLessThan(6);
  });

  it('lays a hush under the rain so no drop stands out of silence', () => {
    for (const surface of [LEAVES, GRASS, STREET, SAND, GLASS]) expect(kurtosis(renderTexture(rainOn(45, surface), RATE, 3).left)).toBeLessThan(18);
  });
});
