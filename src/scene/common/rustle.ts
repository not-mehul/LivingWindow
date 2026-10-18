import type { Texture } from 'pixi.js';
import { PixelBuffer } from '../../core/pixelBuffer';
import { pixelHash } from '../../sprites/raster';

/**
 * Stirred copies of a piece of leafy art, for a SwayMesh to flick between as
 * the wind moves through it: in each copy a scatter of leaves has turned over
 * (taken its neighbour's shade, so highlights and shadows shift by a pixel),
 * and a few at the edges have lifted away or stuck out. Only colours `isLeaf`
 * says are leaves change, so trunks and branches stay put. Frame 0 is the art
 * itself.
 */
export function rustleFrames(art: PixelBuffer, count: number, seed: number, isLeaf: (color: number) => boolean, amount = 0.12): PixelBuffer[] {
  const frames = [art];
  const w = art.width;
  const h = art.height;
  const NEIGHBOURS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let f = 1; f < count; f++) {
    const out = new PixelBuffer(w, h);
    out.data.set(art.data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const roll = pixelHash(x, y, seed + f * 101);
        if (roll >= amount) continue;
        const [dx, dy] = NEIGHBOURS[Math.floor(pixelHash(x, y, seed + f * 103) * 4)];
        const here = art.isSet(x, y);
        const there = art.isSet(x + dx, y + dy);
        if (here) {
          const c = art.get(x, y);
          if (!isLeaf(c)) continue;
          if (there) {
            const n = art.get(x + dx, y + dy);
            if (isLeaf(n)) out.set(x, y, n);
          } else if (roll < amount * 0.3) out.set(x, y, 0, 0);
        } else if (there && roll < amount * 0.25) {
          // A leaf flipping out past the edge.
          const n = art.get(x + dx, y + dy);
          if (isLeaf(n)) out.set(x, y, n);
        }
      }
    }
    frames.push(out);
  }
  return frames;
}

/** `rustleFrames` for a piece whose leaves are the given colours, as textures (frame 0 is the art itself). */
export function rustleTextures(art: PixelBuffer, leaves: readonly number[], seed: number, count = 4): Texture[] {
  const set = new Set(leaves);
  return rustleFrames(art, count, seed, (c) => set.has(c)).map((f) => f.toTexture());
}
