/**
 * Small, fast, seedable PRNG (mulberry32). Used wherever procedural content
 * must be reproducible (e.g. placeholder skylines) while live simulation can
 * still use `Math.random`.
 */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function randomInt(rng: () => number, min: number, maxInclusive: number): number {
  return Math.floor(randomRange(rng, min, maxInclusive + 1));
}
