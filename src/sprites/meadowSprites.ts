import type { Texture } from 'pixi.js';
import { gridToTexture } from './birdSprites';
import { PixelGrid, pixelHash } from './raster';

// --- Cows ---------------------------------------------------------------

export type CowPose = 'walk-1' | 'walk-2' | 'walk-3' | 'walk-4' | 'graze-1' | 'graze-2' | 'stand' | 'lie';
export const COW_WALK: readonly CowPose[] = ['walk-1', 'walk-2', 'walk-3', 'walk-4'];
export type CowCoat = 'holstein' | 'jersey' | 'brown';

const COW_PALETTES: Record<CowCoat, number[]> = {
  holstein: [0, 0x1e1a18, 0xf2f0ea, 0xd8d4cc, 0x24221f, 0xe8a8a0, 0x0c0a0a, 0xc8bca0, 0x3a3632],
  jersey: [0, 0x2a1a10, 0xc8925a, 0xa8743e, 0x8a5a2e, 0xe0a890, 0x0c0a0a, 0xc8bca0, 0x5a3a20],
  brown: [0, 0x1e120a, 0x7a4a2a, 0x5e3820, 0x4a2a16, 0xd8a090, 0x0c0a0a, 0xc8bca0, 0x2e1c10],
};

const enum W {
  Outline = 1,
  Coat = 2,
  Shade = 3,
  Patch = 4,
  Pink = 5,
  Eye = 6,
  Horn = 7,
  Hoof = 8,
}

/** A cow in profile facing right, (1.5·H)×H, hooves on the bottom row. Authored in a 60×40 box. */
export function drawCow(coat: CowCoat, pose: CowPose, height: number): PixelGrid {
  const width = Math.round(height * 1.5);
  const g = new PixelGrid(width, height);
  const s = height / 40;
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  const detailed = height >= 16;
  const patchy = coat === 'holstein';
  const coatColor = (_u: number, v: number, x: number, y: number) => {
    if (patchy && detailed && pixelHash(Math.floor(x / Math.max(2, 4 * s)), Math.floor(y / Math.max(2, 4 * s)), 13) < 0.35) return W.Patch;
    if (!patchy && detailed && v > 0.5) return W.Shade;
    return W.Coat;
  };

  if (pose === 'lie') {
    // Lying down: a low loaf with legs folded under, head up and chewing.
    g.ellipse(28 * s, 32 * s, 20 * s, 7.5 * s, coatColor);
    g.line(...P(12, 37), ...P(44, 38), W.Shade, Math.max(1, 2 * s));
    g.ellipse(48 * s, 24 * s, 5.5 * s, 4.5 * s, coatColor);
    g.ellipse(53 * s, 26 * s, 3 * s, 2.6 * s, W.Pink);
    if (detailed) g.set(Math.floor(49 * s), Math.floor(23 * s), W.Eye);
    g.line(...P(45, 20), ...P(43, 18), W.Horn, Math.max(1, 1.2 * s));
    g.line(...P(9, 30), ...P(5, 36), W.Shade, Math.max(1, 1.4 * s));
  } else {
    const phase = pose.startsWith('walk') ? (Number(pose.slice(-1)) - 1) * (Math.PI / 2) : 0;
    const swing = (o: number) => (pose.startsWith('walk') ? Math.sin(phase + o) * 3 : 0);
    const leg = (x: number, o: number) => {
      g.line(...P(x, 24), ...P(x + swing(o), 37.5), W.Coat, Math.max(1, 3 * s));
      g.rect(Math.floor((x + swing(o) - 1) * s), Math.floor(38 * s), Math.max(1, Math.round(2.5 * s)), Math.max(1, Math.round(1.5 * s)), W.Hoof);
    };
    leg(42, Math.PI);
    leg(15, 0);
    // Barrel of a body, with an udder.
    g.ellipse(29 * s, 21 * s, 20 * s, 9 * s, coatColor);
    g.ellipse(20 * s, 29.5 * s, 3.5 * s, 2.2 * s, W.Pink);
    leg(45, 0);
    leg(12, Math.PI);
    // Tail.
    g.line(...P(9, 15), ...P(7, 30), W.Coat, Math.max(1, 1.2 * s));
    g.ellipse(7 * s, 31 * s, 1.4 * s, 2 * s, W.Patch);
    // Head: lowered to the grass when grazing.
    const grazing = pose.startsWith('graze');
    const hx = grazing ? 52 : 52;
    const hy = grazing ? (pose === 'graze-1' ? 33 : 34) : 14;
    g.line(...P(46, 16), ...P(hx - 2, hy), W.Coat, Math.max(1, 6 * s));
    g.ellipse(hx * s, hy * s, 5 * s, 5.5 * s, coatColor, grazing ? 0.4 : 0);
    g.ellipse((hx + (grazing ? 2 : 3.5)) * s, (hy + (grazing ? 4 : 2.5)) * s, 3 * s, 2.6 * s, W.Pink);
    if (detailed) g.set(Math.floor((hx + 1) * s), Math.floor((hy - 1.5) * s), W.Eye);
    // Ear and horn.
    g.polygon([P(hx - 4, hy - 3), P(hx - 8, hy - 4), P(hx - 4, hy - 1)], W.Coat);
    g.line(...P(hx - 1, hy - 5), ...P(hx - 2, hy - 8), W.Horn, Math.max(1, 1.2 * s));
  }
  if (detailed) g.outline(W.Outline);
  return g;
}

export class CowSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: CowCoat, pose: CowPose, height: number): Texture {
    const key = `${coat}:${pose}:${height}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawCow(coat, pose, height), COW_PALETTES[coat]);
      this.cache.set(key, t);
    }
    return t;
  }
}

export function cowPalette(coat: CowCoat): number[] {
  return COW_PALETTES[coat];
}

// --- Chickens -----------------------------------------------------------

export type ChickenPose = 'stand' | 'peck' | 'walk' | 'flap';
export type ChickenCoat = 'white' | 'brown' | 'black';

const CHICKEN_PALETTES: Record<ChickenCoat, number[]> = {
  white: [0, 0x5a5048, 0xf2eee4, 0xd8d0c0, 0xd83a2a, 0xe8a830, 0x0c0a0a],
  brown: [0, 0x3a2414, 0xb06a32, 0x8a4e22, 0xd83a2a, 0xe8a830, 0x0c0a0a],
  black: [0, 0x0c0c10, 0x2a2a32, 0x1a1a20, 0xd83a2a, 0xe8a830, 0x8a8a40],
};

const CHICKEN_FRAMES: Record<ChickenPose, string[]> = {
  stand: ['....4...', '...221..', '...2652.', '.1.222..', '1222222.', '12322221', '.122221.', '...5.5..', '..55.55.'],
  peck: ['........', '........', '.1......', '1222....', '123222..', '12322241', '.1222225', '...5.5..', '..55.55.'],
  walk: ['....4...', '...221..', '...2652.', '.1.222..', '1222222.', '12322221', '.122221.', '...5..5.', '..55..55'],
  flap: ['.33..4..', '3333221.', '.333.2652', '.1.222..', '1222222.', '1222222.', '.122221.', '...5.5..', '...5.5..'],
};

export function drawChicken(pose: ChickenPose): PixelGrid {
  const rows = CHICKEN_FRAMES[pose];
  const g = new PixelGrid(9, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.set(x, y, Number(row[x]));
  });
  return g;
}

export class ChickenSpriteCache {
  private readonly cache = new Map<string, Texture>();

  get(coat: ChickenCoat, pose: ChickenPose): Texture {
    const key = `${coat}:${pose}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawChicken(pose), CHICKEN_PALETTES[coat]);
      this.cache.set(key, t);
    }
    return t;
  }
}

// --- Rabbits ------------------------------------------------------------

export type RabbitPose = 'sit' | 'hop-1' | 'hop-2' | 'peek';

const RABBIT_FRAMES: Record<RabbitPose, string[]> = {
  sit: ['.....11.', '....121.', '....22..', '...2223.', '.42222..', '4222222.', '.222222.', '..2..22.'],
  'hop-1': ['......11', '.....121', '.....22.', '..22223.', '422222..', '.22222..', '22....2.', '........'],
  'hop-2': ['........', '......11', '.....121', '2222223.', '422222..', '.2....22', '........', '........'],
  peek: ['........', '........', '.....11.', '....121.', '....22..', '...2223.', '........', '........'],
};

const RABBIT_PALETTE = [0, 0x6a5040, 0xa08468, 0x1a1210, 0xf4f0ea];

export function drawRabbit(pose: RabbitPose): PixelGrid {
  const rows = RABBIT_FRAMES[pose];
  const g = new PixelGrid(8, 8);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.set(x, y, Number(row[x]));
  });
  return g;
}

export class RabbitSprites {
  private readonly cache = new Map<RabbitPose, Texture>();

  get(pose: RabbitPose): Texture {
    let t = this.cache.get(pose);
    if (!t) {
      t = gridToTexture(drawRabbit(pose), RABBIT_PALETTE);
      this.cache.set(pose, t);
    }
    return t;
  }
}

// --- Stream fish --------------------------------------------------------

export type FishKind = 'trout' | 'minnow';

// --- Creek fish, seen from above ----------------------------------------

/** Headings the creek fish are drawn at (they turn crisply between them). */
export const TOP_FISH_HEADINGS = 16;

const TOP_FISH_PALETTES: Record<FishKind, number[]> = {
  // Dark backs against the creek bed, a paler flank and a glint.
  trout: [0, 0x22302a, 0x3e4e40, 0x5e6e58, 0xc8d8d0],
  minnow: [0, 0x2e3a3a, 0x4a5a5a, 0x6a7a78, 0xd8e4e4],
};

/**
 * A fish from above, head towards `heading` (one of TOP_FISH_HEADINGS steps
 * round from +x), its tail flicking between two frames.
 */
export function drawTopFish(kind: FishKind, heading: number, frame: 0 | 1): PixelGrid {
  const length = kind === 'trout' ? 11 : 6;
  const size = length + 3;
  const g = new PixelGrid(size, size);
  const a = (heading / TOP_FISH_HEADINGS) * Math.PI * 2;
  const c = size / 2;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Body: a slim spindle, darker along the spine.
  g.ellipse(c + ux * 0.5, c + uy * 0.5, length * 0.38, kind === 'trout' ? 1.7 : 1.1, (_u, v) => (Math.abs(v) < 0.45 ? 1 : 2), a);
  // Tail, flicking side to side.
  const flick = (frame === 0 ? 1 : -1) * (kind === 'trout' ? 1.4 : 0.9);
  const tx = c - ux * length * 0.42;
  const ty = c - uy * length * 0.42;
  g.line(tx, ty, tx - ux * 2 - uy * flick, ty - uy * 2 + ux * flick, 3);
  // A glint of light off its back.
  g.set(Math.floor(c + ux * length * 0.15), Math.floor(c + uy * length * 0.15), 4);
  return g;
}

export class TopFishSprites {
  private readonly cache = new Map<string, Texture>();

  get(kind: FishKind, heading: number, frame: 0 | 1): Texture {
    const h = ((Math.round(heading) % TOP_FISH_HEADINGS) + TOP_FISH_HEADINGS) % TOP_FISH_HEADINGS;
    const key = `${kind}:${h}:${frame}`;
    let t = this.cache.get(key);
    if (!t) {
      t = gridToTexture(drawTopFish(kind, h, frame), TOP_FISH_PALETTES[kind]);
      this.cache.set(key, t);
    }
    return t;
  }
}
