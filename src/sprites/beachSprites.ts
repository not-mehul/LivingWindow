import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid } from './raster';

const TURTLE_PALETTE = [0, 0x1e2a1a, 0x4a6a3a, 0x6a8a4a, 0x8aa86a, 0x8a7a50, 0xb0a070, 0x0c0c0c];

/** A sea turtle hauling itself up the sand, seen from the side (`width`×`width/2`, authored at 20×10). */
export function drawTurtle(frame: 0 | 1 | 2, width = 20): PixelGrid {
  const k = width / 20;
  const g = new PixelGrid(Math.max(4, Math.round(20 * k)), Math.max(2, Math.round(10 * k)));
  const S = (v: number) => v * k;
  // Flippers sweep forward and back as it crawls.
  const front = [[14, 8, 18, 9], [13, 8, 15, 9], [14, 7, 17, 7]][frame];
  const back = [[4, 8, 2, 9], [5, 8, 4, 9], [4, 7, 1, 8]][frame];
  g.line(S(front[0]), S(front[1]), S(front[2]), S(front[3]), 5, Math.max(1, 2 * k));
  g.line(S(back[0]), S(back[1]), S(back[2]), S(back[3]), 5, Math.max(1, 2 * k));
  // Domed shell with plates.
  g.ellipse(S(10), S(6), S(7.5), S(4), (_u, v, x) => (v < -0.4 ? 4 : x % Math.max(2, Math.round(4 * k)) === 0 ? 2 : 3));
  g.rect(S(3), S(7), S(14), Math.max(1, k), 5);
  // Head.
  g.ellipse(S(17.5), S(6.2), S(2.4), S(1.7), 6);
  if (width >= 12) g.set(Math.floor(S(18)), Math.floor(S(5)), 7);
  if (width >= 12) g.outline(1);
  return g;
}

export class TurtleSprites {
  private readonly cache = new Map<string, Texture>();

  /** A crawl frame at a width (rounded to even sizes so the cache stays small). */
  frame(i: number, width = 20): Texture {
    const f = (((i % 3) + 3) % 3) as 0 | 1 | 2;
    const w = Math.max(6, Math.round(width / 2) * 2);
    const key = `${f}:${w}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawTurtle(f, w), TURTLE_PALETTE);
      this.cache.set(key, t);
    }
    return t;
  }
}

const DOLPHIN_PALETTE = [0, 0x3a4a5a, 0x6a7a8a, 0xdfe8ee];

const DOLPHIN_FRAMES = [
  // Fin breaking the surface.
  ['....11...', '...111...', '.122221..'],
  // Arching out of the water.
  ['...1111..', '.112222..', '12.....21', '1.......1'],
  // Nose down, tail up.
  ['1........', '21.......', '.2211....', '...22211.'],
  // Splash where it went in.
  ['.3.3.3...', '..333....', '.33333...'],
];

/** A dolphin breaching, far out near the horizon (tiny, 9 px wide). */
export function drawDolphin(frame: number): PixelGrid {
  const rows = DOLPHIN_FRAMES[frame];
  const g = new PixelGrid(9, 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c !== '.') g.set(x, y + (4 - rows.length), Number(c));
    }
  });
  return g;
}

export class DolphinSprites {
  readonly frames = DOLPHIN_FRAMES.map((_, i) => gridToTexture(drawDolphin(i), DOLPHIN_PALETTE));
}
