import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid } from './raster';

const TURTLE_PALETTE = [0, 0x1e2a1a, 0x4a6a3a, 0x6a8a4a, 0x8aa86a, 0x8a7a50, 0xb0a070, 0x0c0c0c];

/** A sea turtle hauling itself up the sand, seen from the side (20×10). */
export function drawTurtle(frame: 0 | 1 | 2): PixelGrid {
  const g = new PixelGrid(20, 10);
  // Flippers sweep forward and back as it crawls.
  const front = [[14, 8, 18, 9], [13, 8, 15, 9], [14, 7, 17, 7]][frame];
  const back = [[4, 8, 2, 9], [5, 8, 4, 9], [4, 7, 1, 8]][frame];
  g.line(front[0], front[1], front[2], front[3], 5, 2);
  g.line(back[0], back[1], back[2], back[3], 5, 2);
  // Domed shell with plates.
  g.ellipse(10, 6, 7.5, 4, (_u, v, x) => (v < -0.4 ? 4 : x % 4 === 0 ? 2 : 3));
  g.rect(3, 7, 14, 1, 5);
  // Head.
  g.ellipse(17.5, 6.2, 2.4, 1.7, 6);
  g.set(18, 5, 7);
  g.outline(1);
  return g;
}

export class TurtleSprites {
  private readonly frames = ([0, 1, 2] as const).map((f) => gridToTexture(drawTurtle(f), TURTLE_PALETTE));

  frame(i: number): Texture {
    return this.frames[((i % 3) + 3) % 3];
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
